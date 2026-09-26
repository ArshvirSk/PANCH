import { AggregateInput, AggregateOutput } from '../../shared/step-functions';

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
  };
};
