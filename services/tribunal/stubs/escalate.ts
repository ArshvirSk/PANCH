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
 *
 * TRD section 8.7: the escalation queue shows the FULL panel record, so the
 * judges' final outputs, the aggregate (median/spread/swapConsistent), the
 * escalation reason and the per-judge swap-test runs are persisted onto the
 * case row here — while the workflow state that holds them still exists.
 * GET /reviews reads this record; no execution-history archaeology needed
 * for anything escalated after this deploy.
 */
export const handler = async (event: {
  caseId?: string;
  finalPanelOutputs?: Record<string, unknown>;
  swapOutputs?: Record<string, unknown>;
  medianPayeeShareBps?: number;
  spreadBps?: number;
  swapConsistent?: boolean;
  escalationReason?: string;
}): Promise<{ caseId: string; escalated: boolean }> => {
  const caseId = event?.caseId;
  if (!caseId) throw new Error('ESCALATE: no caseId in input');

  // Panel record for the review queue (never shown raw to the reviewer:
  // the UI renders it; party identities stay blinded).
  const panelRecord: Record<string, unknown> = {
    judges: event.finalPanelOutputs ?? {},
    swapOutputs: event.swapOutputs ?? {},
    aggregate: {
      medianPayeeShareBps: event.medianPayeeShareBps,
      spreadBps: event.spreadBps,
      swapConsistent: event.swapConsistent,
    },
    escalationReason: event.escalationReason ?? 'High spread or swap inconsistency',
    escalatedAt: new Date().toISOString(),
  };

  try {
    await docClient.send(new UpdateCommand({
      TableName: CASES_TABLE,
      Key: { caseId },
      // The status flip stays conditional on DELIBERATING (idempotency +
      // safety); the panel record is written in the same update so the row
      // can never be ESCALATED without it.
      UpdateExpression: 'SET #st = :s, panelRecord = :p',
      ConditionExpression: '#st = :expected',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: {
        ':s': CaseStatus.ESCALATED,
        ':expected': CaseStatus.DELIBERATING,
        ':p': panelRecord,
      },
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
