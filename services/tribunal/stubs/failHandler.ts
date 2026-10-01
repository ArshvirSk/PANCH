import { S3Client, CopyObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { CaseStatus } from '../../shared/types';

const s3 = new S3Client({});
const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const CASES_TABLE = process.env.CASES_TABLE || '';
// Source of the cached fallback: BUCKET (evidence). Destination: the rulings
// bucket (CloudFront OAC) — RULINGS_BUCKET — since that is what the ruling
// page actually serves. Falls back to BUCKET when unset (unit tests).
const BUCKET = process.env.BUCKET || '';
const RULINGS_BUCKET = process.env.RULINGS_BUCKET || BUCKET;

export const handler = async (event: any) => {
  const caseId = event.caseId || (event[0] && event[0].caseId);
  if (!caseId) return;

  // Mark FAILED
  await docClient.send(new UpdateCommand({
    TableName: CASES_TABLE,
    Key: { caseId },
    UpdateExpression: 'SET #st = :newStatus',
    ExpressionAttributeNames: { '#st': 'status' },
    ExpressionAttributeValues: { ':newStatus': CaseStatus.FAILED }
  }));

  // Fallback for demo cases: copy the pre-seeded cached ruling into the
  // rulings bucket so the public ruling page still serves a valid body after
  // a failure. Best-effort by design — the FAILED marking above must succeed
  // regardless, and a missing seed object is not itself a workflow failure.
  //
  // Never overwrite an already-published ruling: a later failed re-run used to
  // copy the placeholder over a real, verified award and left /verify
  // reporting a content mismatch (LOG.md phase 24, item 2). The published
  // ruling belongs to the run that produced it; this run failed.
  if (caseId.startsWith('demo-')) {
    const key = `panch-rulings/${caseId}/ruling.json`;
    let publishedRulingExists = false;
    try {
      await s3.send(new HeadObjectCommand({ Bucket: RULINGS_BUCKET, Key: key }));
      publishedRulingExists = true;
    } catch (err: any) {
      // 404/NotFound: nothing published yet, so the seed copy is correct.
      // Any other error (permissions, network): skip the copy rather than risk
      // replacing a real ruling we could not check for.
      const status = err?.$metadata?.httpStatusCode;
      const notFound = err?.name === 'NotFound' || err?.name === 'NoSuchKey' || status === 404;
      if (!notFound) {
        console.error('Fallback copy skipped: could not check for a published ruling', err);
        return { caseId, status: CaseStatus.FAILED };
      }
    }
    if (publishedRulingExists) {
      console.log(`Fallback copy skipped for ${caseId}: a ruling is already published at ${key}`);
      return { caseId, status: CaseStatus.FAILED };
    }
    try {
      await s3.send(new CopyObjectCommand({
        Bucket: RULINGS_BUCKET,
        CopySource: `${BUCKET}/bench/demo/${caseId}/fallback-ruling.json`,
        Key: key
      }));
    } catch {
      // Missing seed (non-demo seed layout or older demo case): the ruling
      // page then 404s, which is the honest outcome for a case with no ruling.
    }
  }

  return { caseId, status: CaseStatus.FAILED };
};
