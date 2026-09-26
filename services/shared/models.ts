import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { z } from 'zod';
import { judgeOutputSchema, crossExamOutputSchema } from './schemas';

const client = new BedrockRuntimeClient({});

export interface InvokeModelParams<T> {
  modelId: string;
  mode: 'tool' | 'json';
  prompt: string;
  schema: z.ZodType<T>;
  systemPrompt?: string;
}

export async function invokeModel<T>(
  modelId: string,
  mode: 'tool' | 'json',
  prompt: string,
  schema: z.ZodType<T>,
  systemPrompt: string = "You are a neutral arbitrator applying the contract as written."
): Promise<T> {
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
  while (retries >= 0) {
    try {
      if (mode === 'tool') {
        const cmd = new ConverseCommand({
          modelId,
          messages: [{ role: 'user', content: [{ text: prompt }] }],
          system: [{ text: systemPrompt }],
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
        const toolUse = res.output.message.content.find((c: any) => c.toolUse)?.toolUse;
        if (!toolUse || !toolUse.input) throw new Error("No tool use returned");
        return schema.parse(toolUse.input);
      } else {
        const jsonPrompt = `${prompt}\n\nYou must output ONLY valid JSON matching this schema: ${JSON.stringify(schemaObj)}. Do not include any other text or markdown wrapping.`;
        const cmd = new ConverseCommand({
          modelId,
          messages: [{ role: 'user', content: [{ text: jsonPrompt }] }],
          system: [{ text: systemPrompt }]
        });
        const res = await client.send(cmd);
        if (!res.output?.message?.content) throw new Error("No output content");
        let text = res.output.message.content.find((c: any) => c.text)?.text;
        if (!text) throw new Error("No text output");
        
        // Strip markdown if present
        text = text.trim();
        if (text.startsWith('```json')) text = text.slice(7);
        if (text.startsWith('```')) text = text.slice(3);
        if (text.endsWith('```')) text = text.slice(0, -3);
        
        return schema.parse(JSON.parse(text));
      }
    } catch (err) {
      if (retries === 0) throw err;
      retries--;
    }
  }
  throw new Error("Failed to invoke model");
}
