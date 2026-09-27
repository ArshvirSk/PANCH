import { AggregateInput, AggregateOutput } from '../../shared/step-functions';
import { accumulateModelUsage, computeCaseCostUsd, newCaseUsage } from '../../shared/cost';
import { emitMetric } from '../../shared/metrics';

export const handler = async (event: AggregateInput): Promise<AggregateOutput> => {
  const outputs = Object.values(event.finalPanelOutputs);
  if (outputs.length === 0) throw new Error("No panel outputs provided");

  const shares = outputs.map(o => o.payeeShareBps).sort((a, b) => a - b);
  const medianPayeeShareBps = shares[Math.floor(shares.length / 2)];
  
  const spreadBps = Math.max(...shares) - Math.min(...shares);
  
  // Basic swap logic: is the median of swapped outcomes roughly inverted?
  let swapConsistent = true;
  if (event.swapOutputs && Object.keys(event.swapOutputs).length > 0) {
    const swapShares = Object.values(event.swapOutputs).map(o => o.payeeShareBps).sort((a, b) => a - b);
    const swapMedian = swapShares[Math.floor(swapShares.length / 2)];
    // If it's consistent, the original payee share (e.g. 10000) should be 10000 - swapMedian (e.g. 0).
    const difference = Math.abs(medianPayeeShareBps - (10000 - swapMedian));
    if (difference > 3000) {
      swapConsistent = false;
    }
  }

  // 3000 bps = 30%. This comes from /panch/config/spread-threshold-bps conceptually.
  const escalated = spreadBps > 3000 || !swapConsistent;

  // --- Cost tracking (PRD: log token counts and cost per case) ---
  // Real Bedrock calls so far: 3 judges + 3 swap tests across three model
  // families (cross-exam is a pass-through and contributes no usage). Each
  // judge / swap output carries its own modelId and the Converse usage from
  // its call; bucket them per model so pricing is exact.
  const usage = newCaseUsage();
  for (const [judge, ju] of Object.entries(event.judgesUsage ?? {})) {
    accumulateModelUsage(usage, ju?.modelId, ju?.usage);
    emitMetric('BedrockTokens', ju?.usage?.totalTokens ?? 0, 'Count', { Stage: 'JUDGES', Model: ju?.modelId ?? 'unknown', CaseId: event.caseId, Judge: judge });
  }
  for (const [judge, st] of Object.entries(event.swapUsage ?? {})) {
    accumulateModelUsage(usage, st?.modelId, st?.usage);
    emitMetric('BedrockTokens', st?.usage?.totalTokens ?? 0, 'Count', { Stage: 'SWAP_TEST', Model: st?.modelId ?? 'unknown', CaseId: event.caseId, Judge: judge });
  }
  emitMetric('BedrockTokens', usage.totalTokens, 'Count', { Stage: 'AGGREGATE', Model: 'all', CaseId: event.caseId, Judge: 'panel' });
  const costUsd = await computeCaseCostUsd(usage);

  return {
    caseId: event.caseId,
    medianPayeeShareBps,
    spreadBps,
    swapConsistent,
    escalated,
    escalationReason: escalated ? "High spread or swap inconsistency" : undefined,
    // Threaded through so PRESIDING/PUBLISH/SETTLE keep their inputs after
    // the payloadResponseOnly AGGREGATE task.
    blindedCaseFileS3Key: event.blindedCaseFileS3Key,
    finalPanelOutputs: event.finalPanelOutputs,
  // Real per-model token totals and the SSM-priced USD cost for the case.
  // costUsd is null (never undefined) when unpriced: the value must exist in
  // the state JSON for '$.costUsd' to resolve in the PRESIDING merge.
  usage,
  costUsd: costUsd ?? null,
  };
};
