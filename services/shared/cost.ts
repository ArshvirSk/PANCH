import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({});

/**
 * Bedrock pricing, read from the SSM price table written by ObsStack.
 * Each parameter is the USD price per 1,000 tokens as a plain string
 * (SSM has no number type; parsing happens here, in one place).
 *
 * The price table keeps model prices configuration, not code — swap a judge
 * model in SSM, update its price parameter, nothing in Lambda changes.
 * Path: /panch/pricing/bedrock/<modelId-with-_> input|output
 * (SSM parameter names cannot contain ':' or '.', so model IDs are slugified.)
 */
export const PRICING_PARAM_PREFIX = '/panch/pricing/bedrock/';

export function pricingParamName(modelId: string, kind: 'input' | 'output'): string {
  const slug = modelId.replace(/[^a-zA-Z0-9]/g, '_');
  return `${PRICING_PARAM_PREFIX}${slug}-${kind}`;
}

/**
 * Token usage shape returned by Bedrock Converse. Handlers surface it with
 * their output so Step Functions threads real token counts through the
 * workflow payload (usage.$: '$...usage') for cost tracking — no guessing,
 * no free-text parsing.
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

export function addUsage(a: TokenUsage, b: TokenUsage | undefined | null): TokenUsage {
  if (!b) return a;
  return {
    inputTokens: a.inputTokens + (b.inputTokens ?? 0),
    outputTokens: a.outputTokens + (b.outputTokens ?? 0),
    totalTokens: a.totalTokens + (b.totalTokens ?? 0),
  };
}

/** Accumulated token usage bucketed per model — a panel spans three model families. */
export interface PerModelUsage {
  [modelId: string]: TokenUsage;
}

/** Everything cost tracking needs for one case, summed per model. */
export interface CaseUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  perModel: PerModelUsage;
}

export function newCaseUsage(): CaseUsage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, perModel: {} };
}

/** Accumulate one model call's usage into the per-model bucket. */
export function accumulateModelUsage(
  acc: CaseUsage,
  modelId: string | undefined,
  usage: TokenUsage | undefined | null
): void {
  if (!usage || (!usage.inputTokens && !usage.outputTokens)) return;
  const key = modelId || 'unknown';
  acc.inputTokens += usage.inputTokens ?? 0;
  acc.outputTokens += usage.outputTokens ?? 0;
  acc.totalTokens += usage.totalTokens ?? 0;
  acc.perModel[key] = addUsage(acc.perModel[key] ?? emptyUsage(), usage);
}

/**
 * Cost of one case, in USD, from the SSM price table: for every model that
 * served the panel, tokens/1000 x per-1k price. Prices are USD per 1,000
 * tokens. On any missing/malformed price entry this returns undefined so the
 * caller can record tokens without inventing a cost (never a fake number).
 */
export async function computeCaseCostUsd(usage: CaseUsage | undefined | null): Promise<number | undefined> {
  if (!usage || usage.totalTokens <= 0) return undefined;
  let cost = 0;
  let seenAnyPrice = false;
  for (const [modelId, mu] of Object.entries(usage.perModel)) {
    try {
      const [inRes, outRes] = await Promise.all([
        ssm.send(new GetParameterCommand({ Name: pricingParamName(modelId, 'input') })),
        ssm.send(new GetParameterCommand({ Name: pricingParamName(modelId, 'output') })),
      ]);
      const pricePerKIn = Number(inRes.Parameter?.Value);
      const pricePerKOut = Number(outRes.Parameter?.Value);
      if (!Number.isFinite(pricePerKIn) || !Number.isFinite(pricePerKOut)) continue;
      seenAnyPrice = true;
      cost += (mu.inputTokens / 1000) * pricePerKIn + (mu.outputTokens / 1000) * pricePerKOut;
    } catch {
      // Missing price entry for this model: skip it, do not invent a price.
    }
  }
  return seenAnyPrice ? cost : undefined;
}

/**
 * Single-call variant (kept for direct callers that invoke one model).
 */
export async function computeCallCostUsd(
  modelId: string,
  usage: TokenUsage | undefined | null
): Promise<number | undefined> {
  if (!usage || (!usage.inputTokens && !usage.outputTokens)) return undefined;
  try {
    const [inRes, outRes] = await Promise.all([
      ssm.send(new GetParameterCommand({ Name: pricingParamName(modelId, 'input') })),
      ssm.send(new GetParameterCommand({ Name: pricingParamName(modelId, 'output') })),
    ]);
    const pricePerKIn = Number(inRes.Parameter?.Value);
    const pricePerKOut = Number(outRes.Parameter?.Value);
    if (!Number.isFinite(pricePerKIn) || !Number.isFinite(pricePerKOut)) return undefined;
    return (usage.inputTokens / 1000) * pricePerKIn + (usage.outputTokens / 1000) * pricePerKOut;
  } catch {
    return undefined;
  }
}
