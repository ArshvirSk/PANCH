import { BlindInput, BlindOutput } from '../shared/step-functions';

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

export async function blind(input: BlindInput): Promise<BlindOutput> {
  const blindedCaseFile = buildBlindedCaseFile(input);
  const blindedCaseFileS3Key = `blinded/${input.caseId}/case-file.json`;

  return {
    caseId: input.caseId,
    blindedCaseFileS3Key
  };
}
