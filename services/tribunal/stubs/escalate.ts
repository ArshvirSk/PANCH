import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { CaseStatus } from '../../shared/types';

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const CASES_TABLE = process.env.CASES_TABLE || '';

/**
 * ESCALATE task (Route -> ESCALATED branch). Without this the escalation
 * branch ended in a Succeed state without touching the case row, so an
 * escalated case stayed DELIBERATING forever: invisible to GET /reviews
 * (which scans status = ESCALATED) and misleading on GET /cases/{id}.
 *
 * The flip is conditional on DELIBERATING (the only status a live execution
 * can be in) and idempotent on retry: if the conditional fails because the
 * row is already ESCALATED, that is success.
 */
export const handler = async (event: { caseId?: string }): Promise<{ caseId: string; escalated: boolean }> => {
  const caseId = event?.caseId;
  if (!caseId) throw new Error('ESCALATE: no caseId in input');

  try {
    await docClient.send(new UpdateCommand({
      TableName: CASES_TABLE,
      Key: { caseId },
      UpdateExpression: 'SET #st = :s',
      ConditionExpression: '#st = :expected',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: { ':s': CaseStatus.ESCALATED, ':expected': CaseStatus.DELIBERATING },
    }));
  } catch (err: any) {
    if (err.name === 'ConditionalCheckFailedException' || err.name === 'TransactionCanceledException') {
      const cur = await docClient.send(new GetCommand({ TableName: CASES_TABLE, Key: { caseId } }));
      if (cur.Item?.status === CaseStatus.ESCALATED) {
        console.log(`Case ${caseId} already ESCALATED (retry after partial failure); treating as success`);
        return { caseId, escalated: true };
      }
    }
    throw err;
  }
  return { caseId, escalated: true };
};
