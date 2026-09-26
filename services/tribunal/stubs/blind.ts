import { BlindInput, BlindOutput } from '../../shared/step-functions';

export const handler = async (event: BlindInput): Promise<BlindOutput> => {
  return {
    caseId: event.caseId,
    blindedCaseFileS3Key: `panch-evidence/${event.caseId}/blinded.json`,
  };
};
