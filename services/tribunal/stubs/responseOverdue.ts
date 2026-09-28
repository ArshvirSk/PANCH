import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { CaseStatus } from '../../shared/types';
import { emitMetric } from '../../shared/metrics';

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
// Read lazily so unit tests can configure the table per test.
const casesTable = () => process.env.CASES_TABLE || '';

/**
 * Scheduled (EventBridge, hourly) sweep over non-terminal cases with an
 * evidenceDeadline. Enforcement policy is deliberately minimal and honest:
 * the deadline already blocks new evidence at the API (evidenceUrl), and this
 * sweep makes overdue visibility real — each overdue case gets a
 * responseOverdue flag plus an OverdueCases EMF metric for the dashboard
 * alarm. It does NOT adjudicate, settle or fail cases by itself; auto-rules
 * for silence are a product decision, not a cron default.
 *
 * Non-terminal statuses checked: FUNDED and DISPUTED (the evidence/response
 * window). DELIBERATING and beyond are already inside the tribunal or
 * resolved; ESCALATED waits on a human reviewer.
 */

const OVERDUE_STATUSES = [CaseStatus.FUNDED, CaseStatus.DISPUTED];

export const handler = async (): Promise<{ scanned: number; flagged: number }> => {
  const CASES_TABLE = casesTable();
  if (!CASES_TABLE) return { scanned: 0, flagged: 0 };

  const now = Date.now();
  const flagged: string[] = [];

  for (const status of OVERDUE_STATUSES) {
    // Scan with a filter: this sweep runs hourly, touches a handful of rows at
    // most (every open case with a deadline), and Cases has no status GSI.
    let cursor: Record<string, any> | undefined;
    for (;;) {
      const res = await docClient.send(new ScanCommand({
        TableName: CASES_TABLE,
        FilterExpression: '#st = :st AND attribute_type(evidenceDeadline, :t) AND evidenceDeadline < :now AND attribute_not_exists(responseOverdue)',
        ProjectionExpression: 'caseId, evidenceDeadline',
        ExpressionAttributeNames: { '#st': 'status' },
        ExpressionAttributeValues: { ':st': status, ':t': 'S', ':now': new Date().toISOString() },
        ...(cursor ? { ExclusiveStartKey: cursor } : {}),
      }));
      for (const item of res.Items || []) {
        try {
          // Conditional so a concurrent lifecycle move wins safely: if the case
          // left this status mid-sweep, the flag write simply does not happen.
          await docClient.send(new UpdateCommand({
            TableName: CASES_TABLE,
            Key: { caseId: item.caseId },
            UpdateExpression: 'SET responseOverdue = :true, overdueSince = :since',
            ConditionExpression: '#st = :st',
            ExpressionAttributeNames: { '#st': 'status' },
            ExpressionAttributeValues: { ':true': true, ':since': item.evidenceDeadline, ':st': status },
          }));
          flagged.push(item.caseId);
        } catch {
          // Lost the race with a status change — the case is no longer sitting
          // on its deadline; skipping it is correct.
        }
      }
      cursor = res.LastEvaluatedKey;
      if (!cursor) break;
    }
  }

  // One metric per flagged case keeps per-case alarms trivially correct, and
  // one total for the dashboard line.
  for (const caseId of flagged) {
    emitMetric('OverdueCases', 1, 'Count', { Action: 'ResponseOverdue', CaseId: caseId });
  }
  emitMetric('OverdueCases', flagged.length, 'Count', { Action: 'ResponseOverdueSweep' });

  return { scanned: OVERDUE_STATUSES.length, flagged: flagged.length };
};
