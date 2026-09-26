import { PresidingInput, PresidingOutput } from '../../shared/step-functions';

export const handler = async (event: PresidingInput): Promise<PresidingOutput> => {
  return {
    caseId: event.caseId,
    presidingRulingS3Key: `panch-rulings/${event.caseId}/ruling.json`,
  };
};
