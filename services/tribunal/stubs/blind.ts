import { BlindInput, BlindOutput } from '../../shared/step-functions';

export function buildBlindedCaseFile(input: BlindInput): string {
  const summary = {
    caseId: input.caseId,
    parties: {
      claimant: 'Claimant',
      respondent: 'Respondent',
      claimantCountry: 'Claimant Country',
      respondentCountry: 'Respondent Country',
      claimantPlatform: 'Claimant Platform',
      respondentPlatform: 'Respondent Platform'
    },
    evidenceItems: input.evidenceItems.map((evidence) => ({
      ...evidence,
      party: evidence.party === 'claimant' ? 'Claimant' : 'Respondent'
    })),
    alert: 'Names, countries and platform identifiers have been blinded before tribunal review.'
  };

  return JSON.stringify(summary, null, 2);
}

export const handler = async (event: BlindInput): Promise<BlindOutput> => {
  const blindedCaseFile = buildBlindedCaseFile(event);
  const blindedCaseFileS3Key = `panch-evidence/${event.caseId}/blinded.json`;

  return {
    caseId: event.caseId,
    blindedCaseFileS3Key
  };
};
