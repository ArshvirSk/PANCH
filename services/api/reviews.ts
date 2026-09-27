import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, appendLedgerEntry, CaseStatus, LedgerEvent } from '../shared';
import { emitMetric } from '../shared/metrics';

const CASES_TABLE = process.env.CASES_TABLE || '';

function respond(statusCode: number, body: any): APIGatewayProxyResult {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) };
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
    // Returning dummy panel outputs since we don't have Rulings table query ready
    const items = (res.Items || []).map(item => ({
      ...item,
      panelOutputs: { spreadBps: 5000, judges: [] }
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
