import { PresidingInput, PresidingOutput } from '../../shared/step-functions';

export const handler = async (event: PresidingInput): Promise<PresidingOutput> => {
  return {
    caseId: event.caseId,
    presidingRulingS3Key: `panch-rulings/${event.caseId}/ruling.json`,
    // PRESIDING is payloadResponseOnly: pass the fields PUBLISH/SETTLE need straight through.
    payeeShareBps: event.medianPayeeShareBps,
    spreadBps: event.spreadBps,
    swapConsistent: event.swapConsistent,
    escalated: event.escalated,
    blindedCaseFileS3Key: event.blindedCaseFileS3Key,
    finalPanelOutputs: event.finalPanelOutputs,
  };
};
