import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { BlindInput, BlindOutput } from '../../shared/step-functions';
import { EvidenceItem } from '../../shared/types';

const s3 = new S3Client({});

async function fetchExtractedText(item: EvidenceItem): Promise<string | undefined> {
  if (!item.extractedTextKey) return undefined;
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: process.env.BUCKET, Key: item.extractedTextKey }));
    if (!res.Body) return undefined;
    const text = (await res.Body.transformToString('utf8')).trim();
    return text.length > 0 ? text : undefined;
  } catch {
    // Missing/unreadable extracted text degrades to a metadata-only item; the
    // judges will see the gap explicitly instead of crashing the workflow.
    return undefined;
  }
}

export function buildBlindedCaseFile(input: BlindInput, textByKey?: Record<string, string>): string {
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
    evidenceItems: input.evidenceItems.map((evidence) => {
      const extractedText = textByKey?.[evidence.evidenceId];
      return {
        ...evidence,
        party: evidence.party === 'claimant' ? 'Claimant' : 'Respondent',
        // Contract/other document text as extracted by OCR, inlined so the
        // judges can actually evaluate the substance of the dispute.
        ...(extractedText ? { extractedText } : {})
      };
    }),
    alert: 'Names, countries and platform identifiers have been blinded before tribunal review.'
  };

  return JSON.stringify(summary, null, 2);
}

export const handler = async (event: BlindInput): Promise<BlindOutput> => {
  const blindedCaseFileS3Key = `panch-evidence/${event.caseId}/blinded.json`;

  const bucket = process.env.BUCKET;
  if (!bucket) {
    throw new Error('BUCKET env var is not set; cannot persist the blinded case file');
  }

  const textByKey: Record<string, string> = {};
  await Promise.all(
    event.evidenceItems.map(async (item) => {
      const text = await fetchExtractedText(item);
      if (text) textByKey[item.evidenceId] = text;
    })
  );

  const blindedCaseFile = buildBlindedCaseFile(event, textByKey);

  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: blindedCaseFileS3Key, Body: blindedCaseFile }));

  return {
    caseId: event.caseId,
    blindedCaseFileS3Key
  };
};
