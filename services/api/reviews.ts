import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SFNClient, GetExecutionHistoryCommand } from '@aws-sdk/client-sfn';
import { docClient, appendLedgerEntry, CaseStatus, LedgerEvent } from '../shared';
import { emitMetric } from '../shared/metrics';

const CASES_TABLE = process.env.CASES_TABLE || '';

const sfn = new SFNClient({});

function respond(statusCode: number, body: any): APIGatewayProxyResult {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) };
}

interface PanelRecord {
  judges?: Record<string, unknown>;
  swapOutputs?: Record<string, unknown>;
  aggregate?: { medianPayeeShareBps?: number; spreadBps?: number; swapConsistent?: boolean };
  escalationReason?: string;
  escalatedAt?: string;
  recoveredFromHistory?: boolean;
}

/**
 * Legacy rows escalated before the panel record was persisted (PR #11 era):
 * recover judges + aggregate from the case's Step Functions execution
 * history. Read-only; if the execution ARN is gone or the history is
 * truncated, the case still lists — with empty panel data and no lie.
 */
async function recoverPanelRecord(executionArn?: string): Promise<PanelRecord | undefined> {
  if (!executionArn || !executionArn.startsWith('arn:aws:states:')) return undefined;
  try {
    const hist = await sfn.send(new GetExecutionHistoryCommand({ executionArn, maxResults: 200 }));
    let record: PanelRecord = {};
    for (const ev of hist.events || []) {
      const exited = ev.stateExitedEventDetails;
      if (!exited) continue;
      let out: any;
      try { out = JSON.parse(exited.output || 'null'); } catch { continue; }
      if (!out) continue;
      if (exited.name === 'AGGREGATE') {
        record.judges = out.finalPanelOutputs ?? record.judges;
        record.swapOutputs = out.swapOutputs ?? record.swapOutputs;
        record.aggregate = {
          medianPayeeShareBps: out.medianPayeeShareBps,
          spreadBps: out.spreadBps,
          swapConsistent: out.swapConsistent,
        };
        record.escalationReason = out.escalationReason;
      }
    }
    if (record.judges && Object.keys(record.judges).length > 0) {
      record.recoveredFromHistory = true;
      return record;
    }
  } catch (err: any) {
    console.error('Panel-record recovery failed for', executionArn, err?.message);
  }
  return undefined;
}

export const getReviews = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    // The reviews page polls this list; counting it keeps /reviews usage on the dashboard.
    emitMetric('ReviewActions', 1, 'Count', { Action: 'ListReviewsPage' });
    // List Cases where status = ESCALATED
    const res = await docClient.send(new ScanCommand({
      TableName: CASES_TABLE,
      FilterExpression: '#st = :s',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: { ':s': CaseStatus.ESCALATED }
    }));

    const items = await Promise.all((res.Items || []).map(async (item) => {
      // Full panel record (TRD section 8.7): the ESCALATE task persists the
      // judges' outputs, per-judge swap runs, aggregate and reason on the row.
      // Older escalated rows predate the record — recover what the execution
      // history still holds rather than serving placeholder data.
      let panel = item.panelRecord as PanelRecord | undefined;
      if (!panel || !panel.judges || Object.keys(panel.judges).length === 0) {
        const recovered = await recoverPanelRecord(item.executionArn);
        if (recovered) {
          panel = { ...recovered, ...panel };
          // Backfill so the row heals itself for the next poll.
          try {
            await docClient.send(new UpdateCommand({
              TableName: CASES_TABLE,
              Key: { caseId: item.caseId },
              UpdateExpression: 'SET panelRecord = :p',
              ExpressionAttributeValues: { ':p': panel },
            }));
          } catch { /* best-effort backfill; the response is already correct */ }
        }
      }
      const { panelRecord, executionArn, ...publicCase } = item as Record<string, any>;
      return {
        ...publicCase,
        panelOutputs: {
          judges: panel?.judges ?? {},
          swapOutputs: panel?.swapOutputs ?? {},
          aggregate: panel?.aggregate ?? {},
          escalationReason: panel?.escalationReason,
          escalatedAt: panel?.escalatedAt,
          ...(panel?.recoveredFromHistory ? { recoveredFromHistory: true } : {}),
        },
      };
    }));
    return respond(200, items);
  } catch (err: any) { return respond(500, { error: err.message }); }
};

export const postReview = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    emitMetric('ReviewActions', 1, 'Count', { Action: 'PostReview' });
    const caseId = event.pathParameters?.caseId!;
    const body = JSON.parse(event.body || '{}');
    const payeeShareBps = body.payeeShareBps;

    // payeeShareBps is basis points of the escrow going to the payee — it must
    // be an integer in [0, 10000]. Numbers are never parsed from free text.
    if (!Number.isInteger(payeeShareBps) || payeeShareBps < 0 || payeeShareBps > 10000) {
      return respond(400, { error: 'payeeShareBps must be an integer between 0 and 10000' });
    }

    const res = await docClient.send(new GetCommand({ TableName: CASES_TABLE, Key: { caseId } }));
    if (!res.Item || res.Item.status !== CaseStatus.ESCALATED) {
      return respond(400, { error: 'Case must be ESCALATED' });
    }

    // Resolve via Ledger library. The conditional status check inside
    // appendLedgerEntry makes a second review of the same case impossible:
    // once resolved, status is no longer ESCALATED and the transaction is
    // rejected (double-settlement guard), surfacing as 409 below.
    try {
      const resolveRes = await appendLedgerEntry({
        caseId,
        event: LedgerEvent.RESOLVE,
        amountCents: res.Item.amountCents,
        payeeBps: payeeShareBps,
        expectedStatus: CaseStatus.ESCALATED,
        newStatus: CaseStatus.RULED,
        seq: 10, // Mock seq
        prevHash: 'MOCK_PREV'
      });

      await appendLedgerEntry({
        caseId,
        event: LedgerEvent.RELEASE,
        amountCents: res.Item.amountCents,
        payeeBps: payeeShareBps,
        expectedStatus: CaseStatus.RULED,
        newStatus: CaseStatus.SETTLED,
        seq: 11,
        prevHash: resolveRes.entryHash
      });
    } catch (err: any) {
      if (err.message?.includes('double-entry') || err.message?.includes('status mismatch')) {
        return respond(409, { error: 'Case already reviewed and settled' });
      }
      throw err;
    }

    return respond(200, { caseId, status: CaseStatus.SETTLED });
  } catch (err: any) { return respond(500, { error: err.message }); }
};
