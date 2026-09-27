import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { z } from 'zod';
import { judgeOutputSchema, crossExamOutputSchema } from './schemas';
import { TokenUsage, emptyUsage, addUsage } from './cost';
export type { TokenUsage } from './cost';
import type { CallerIdentityExtensions } from './helpers';

const client = new BedrockRuntimeClient({});

let lastUsage: TokenUsage = emptyUsage();

export interface InvokeModelParams<T> {
  modelId: string;
  mode: 'tool' | 'json';
  prompt: string;
  schema: z.ZodType<T>;
  systemPrompt?: string;
}

/**
 * Last call's token usage. The Converse response carries real token counts;
 * recording them here (instead of only inside the return value) lets the
 * handler surface usage alongside its output so Step Functions can thread it
 * into the payload (usage.$: '$.modelOutput.usage') for cost tracking.
 */
export function getLastUsage(): TokenUsage {
  return lastUsage;
}

/**
 * Model-output normalization, applied before schema validation. Models
 * occasionally express confidence on a 0-100 scale even though the schema
 * says 0-1 (seen live: Llama 3.3 70B returned confidence 90 in json mode,
 * failing z.max(1) after 3 retries and failing the whole case). We interpret
 * values in (1, 100] as percentages and divide by 100; anything larger is
 * clamped to 1. This is numeric range coercion of a structured field, not
 * free-text parsing — the value still comes from the model's JSON output and
 * still passes the full schema check afterwards.
 */
function normalizeConfidence(value: unknown): unknown {
  if (typeof value === 'number' && Number.isFinite(value) && value > 1) {
    return value <= 100 ? Math.min(value / 100, 1) : 1;
  }
  return value;
}

/**
 * Parse with normalization for known model quirks, then validate. Keeps the
 * schema as the single source of truth for what a valid ruling looks like.
 */
function parseModelOutput<T>(schema: z.ZodType<T>, raw: unknown): T {
  if (raw && typeof raw === 'object' && 'confidence' in raw) {
    raw = { ...(raw as Record<string, unknown>), confidence: normalizeConfidence((raw as Record<string, unknown>).confidence) };
  }
  return schema.parse(raw);
}

export async function invokeModel<T>(
  modelId: string,
  mode: 'tool' | 'json',
  prompt: string,
  schema: z.ZodType<T>,
  systemPrompt: string = "You are a neutral arbitrator applying the contract as written.",
  callerIdentity?: CallerIdentityExtensions
): Promise<T> {
  // Inference extensions make each judge's calls attributable (CallerIdentity)
  // and prevent response caching from serving one judge's output to another
  // (Tolerations) — token counts in CloudWatch then line up with per-case costs.
  const callerFields: Record<string, unknown> = {};
  if (callerIdentity?.callerPersistentState) callerFields.callerPersistentState = callerIdentity.callerPersistentState;
  if (callerIdentity?.callerTolerations?.length) callerFields.callerTolerations = callerIdentity.callerTolerations;
  if (callerIdentity?.callerTraceParent) callerFields.callerTraceParent = callerIdentity.callerTraceParent;
  const isJudgeOutput = schema === judgeOutputSchema as any;
  const isCrossExamOutput = schema === crossExamOutputSchema as any;
  const schemaObj = isJudgeOutput 
    ? {
        type: "object",
        properties: {
          findingsOfFact: { type: "array", items: { type: "object", properties: { fact: { type: "string" }, evidenceIds: { type: "array", items: { type: "string" } } } } },
          clausesRelied: { type: "array", items: { type: "object", properties: { clauseRef: { type: "string" }, interpretation: { type: "string" } } } },
          payeeShareBps: { type: "integer" },
          reasoning: { type: "string" },
          confidence: { type: "number" },
          uncertainties: { type: "array", items: { type: "string" } }
        },
        required: ["findingsOfFact", "clausesRelied", "payeeShareBps", "reasoning", "confidence", "uncertainties"]
      }
    : {
        type: "object",
        properties: {
          critiques: { type: "array", items: { type: "object", properties: { targetJudge: { type: "string" }, type: { type: "string" }, claim: { type: "string" }, evidenceIds: { type: "array", items: { type: "string" } } } } },
          revisedRuling: { type: "object" },
          changed: { type: "boolean" }
        },
        required: ["critiques", "revisedRuling", "changed"]
      };

  let retries = 2;
  let lastError: unknown;
  // Bedrock Guardrail is applied on every Converse call: the workflow stack
  // injects the deployed guardrail id/version, so evidence (input) and model
  // output both pass through the content policy. Missing env (unit tests)
  // skips it rather than silently degrading to no guardrail in production —
  // production Lambdas always have it set.
  const guardrailId = process.env.GUARDRAIL_ID || '';
  const guardrailVersion = process.env.GUARDRAIL_VERSION || '';
  const guardrailConfig = guardrailId && guardrailVersion
    ? { guardrailIdentifier: guardrailId, guardrailVersion, trace: 'enabled' as const }
    : undefined;
  while (retries >= 0) {
    try {
      if (mode === 'tool') {
        const cmd = new ConverseCommand({
          modelId,
          messages: [{ role: 'user', content: [{ text: prompt }] }],
          system: [{ text: systemPrompt }],
          ...callerFields,
          ...(guardrailConfig ? { guardrailConfig } : {}),
          toolConfig: {
            tools: [{
              toolSpec: {
                name: "submit_ruling",
                description: "Submit the final JSON output.",
                inputSchema: { json: schemaObj as any }
              }
            }],
            toolChoice: { tool: { name: "submit_ruling" } }
          }
        });
        const res = await client.send(cmd);
        if (!res.output?.message?.content) throw new Error("No output content");
        lastUsage = addUsage(emptyUsage(), res.usage as TokenUsage | undefined);
        const toolUse = res.output.message.content.find((c: any) => c.toolUse)?.toolUse;
        if (!toolUse || !toolUse.input) throw new Error("No tool use returned");
        return parseModelOutput(schema, toolUse.input);
      } else {
        const jsonPrompt = `${prompt}\n\nYou must output ONLY valid JSON matching this schema: ${JSON.stringify(schemaObj)}. Do not include any other text or markdown wrapping.`;
        const cmd = new ConverseCommand({
          modelId,
          messages: [{ role: 'user', content: [{ text: jsonPrompt }] }],
          system: [{ text: systemPrompt }],
          ...callerFields,
          ...(guardrailConfig ? { guardrailConfig } : {}),
        });
        const res = await client.send(cmd);
        if (!res.output?.message?.content) throw new Error("No output content");
        lastUsage = addUsage(emptyUsage(), res.usage as TokenUsage | undefined);
        let text = res.output.message.content.find((c: any) => c.text)?.text;
        if (!text) throw new Error("No text output");
        
        // Strip markdown if present
        text = text.trim();
        if (text.startsWith('```json')) text = text.slice(7);
        if (text.startsWith('```')) text = text.slice(3);
        if (text.endsWith('```')) text = text.slice(0, -3);
        
        return parseModelOutput(schema, JSON.parse(text));
      }
    } catch (err) {
      lastError = err;
      if (retries === 0) throw err;
      retries--;
    }
  }
  throw new Error(
    `Failed to invoke model after retries: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
}
