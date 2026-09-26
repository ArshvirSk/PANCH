import { S3Client, CopyObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { CaseStatus } from '../../shared/types';

const s3 = new S3Client({});
const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const CASES_TABLE = process.env.CASES_TABLE || '';
const BUCKET = process.env.BUCKET || '';

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

  // Fallback for demo cases
  if (caseId.startsWith('demo-')) {
    try {
      await s3.send(new CopyObjectCommand({
        Bucket: BUCKET,
        CopySource: `${BUCKET}/bench/demo/${caseId}/fallback-ruling.json`,
        Key: `panch-rulings/${caseId}/ruling.json`
      }));
    } catch (e) {
      console.log('No fallback found for', caseId);
    }
  }

  return { caseId, status: CaseStatus.FAILED };
};
