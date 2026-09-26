import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, appendLedgerEntry, CaseStatus, LedgerEvent } from '../shared';

const CASES_TABLE = process.env.CASES_TABLE || '';

function respond(statusCode: number, body: any): APIGatewayProxyResult {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) };
}

export const getReviews = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
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
    const caseId = event.pathParameters?.caseId!;
    const body = JSON.parse(event.body || '{}');
    const payeeShareBps = body.payeeShareBps;
    
    const res = await docClient.send(new GetCommand({ TableName: CASES_TABLE, Key: { caseId } }));
    if (!res.Item || res.Item.status !== CaseStatus.ESCALATED) {
      return respond(400, { error: 'Case must be ESCALATED' });
    }
    
    // Resolve via Ledger library
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

    return respond(200, { caseId, status: CaseStatus.SETTLED });
  } catch (err: any) { return respond(500, { error: err.message }); }
};
