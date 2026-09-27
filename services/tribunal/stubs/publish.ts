import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { PublishInput, PublishOutput } from '../../shared/step-functions';
import { JudgeOutput } from '../../shared/schemas';

const s3 = new S3Client({});
const BUCKET = process.env.RULINGS_BUCKET || process.env.BUCKET || '';

export const handler = async (event: PublishInput): Promise<PublishOutput> => {
  // Fallback path: the Catch -> FAILED lambda has already cached a fallback ruling for demo cases.
  if (event.fallback) {
    return {
      caseId: event.caseId,
      publishedUrl: `https://panch.example/rulings/${event.caseId}`,
    };
  }

  // Presiding synthesis first: publish the presiding arbitrator's ruling body
  // (same fields the ruling page validates) when the synthesis produced one.
  // Median fallback keeps the Catch -> FAILED path publishable for demo cases.
  const entries = Object.entries(event.finalPanelOutputs ?? {});
  const sorted = [...entries].sort((a, b) => a[1].payeeShareBps - b[1].payeeShareBps);
  const median: JudgeOutput | undefined = sorted.length > 0 ? sorted[Math.floor((sorted.length - 1) / 2)][1] : undefined;
  const ruling: JudgeOutput | undefined = event.ruling ?? median;

  const body = {
    caseId: event.caseId,
    // The ruling body's own award wins so the published number always matches
    // the published reasoning; event.payeeShareBps covers legacy/absent bodies.
    payeeShareBps: ruling?.payeeShareBps ?? event.payeeShareBps ?? 0,
    spreadBps: event.spreadBps ?? 0,
    swapConsistent: event.swapConsistent ?? true,
    findingsOfFact: ruling?.findingsOfFact ?? [],
    clausesRelied: ruling?.clausesRelied ?? [],
    reasoning: ruling?.reasoning ?? '',
    confidence: ruling?.confidence ?? 0,
    uncertainties: ruling?.uncertainties ?? [],
    finalPanelOutputs: event.finalPanelOutputs ?? {},
    publishedAt: new Date().toISOString(),
  };

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: `panch-rulings/${event.caseId}/ruling.json`,
    Body: JSON.stringify(body, null, 2),
    ContentType: 'application/json',
  }));

  return {
    caseId: event.caseId,
    publishedUrl: `panch-rulings/${event.caseId}/ruling.json`,
  };
};
