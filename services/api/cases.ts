import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SFNClient, StartExecutionCommand, DescribeExecutionCommand, GetExecutionHistoryCommand } from '@aws-sdk/client-sfn';
import { docClient, appendLedgerEntry, validateTransition, CaseStatus, LedgerEvent } from '../shared';

const s3Client = new S3Client({});
const sfnClient = new SFNClient({});
const CASES_TABLE = process.env.CASES_TABLE || '';
const EVIDENCE_BUCKET = process.env.EVIDENCE_BUCKET || '';
const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN || '';

function respond(statusCode: number, body: any): APIGatewayProxyResult {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) };
}

export const create = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const body = JSON.parse(event.body || '{}');
    const caseId = `c-${uuidv4().substring(0, 8)}`;
    const claimantId = event.requestContext.authorizer?.claims?.sub || 'test-user';
    const item = { caseId, status: CaseStatus.CREATED, claimantId, respondentId: body.respondentEmail || 'pending', amountCents: body.amountCents || 0, currency: body.currency || 'USD', createdAt: new Date().toISOString() };
    await docClient.send(new PutCommand({ TableName: CASES_TABLE, Item: item }));
    return respond(201, item);
  } catch (err: any) { return respond(500, { error: err.message }); }
};

export const fund = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const caseId = event.pathParameters?.id!;
    const res = await docClient.send(new GetCommand({ TableName: CASES_TABLE, Key: { caseId } }));
    if (!res.Item) return respond(404, { error: 'Not found' });
    const newStatus = validateTransition(res.Item.status as CaseStatus, LedgerEvent.FUND);
    const result = await appendLedgerEntry({ caseId, event: LedgerEvent.FUND, amountCents: res.Item.amountCents, expectedStatus: res.Item.status as CaseStatus, newStatus, seq: 1, prevHash: 'GENESIS' });
    return respond(200, { success: true, newStatus, entryHash: result.entryHash });
  } catch (err: any) { return respond(400, { error: err.message }); }
};

export const dispute = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const caseId = event.pathParameters?.id!;
    const res = await docClient.send(new GetCommand({ TableName: CASES_TABLE, Key: { caseId } }));
    if (!res.Item) return respond(404, { error: 'Not found' });
    const newStatus = validateTransition(res.Item.status as CaseStatus, LedgerEvent.DISPUTE);
    const result = await appendLedgerEntry({ caseId, event: LedgerEvent.DISPUTE, amountCents: res.Item.amountCents, expectedStatus: res.Item.status as CaseStatus, newStatus, seq: 2, prevHash: 'GENESIS' });
    return respond(200, { success: true, newStatus, entryHash: result.entryHash });
  } catch (err: any) { return respond(400, { error: err.message }); }
};

export const evidenceUrl = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const caseId = event.pathParameters?.id!;
    const body = JSON.parse(event.body || '{}');
    const evidenceId = `ev-${uuidv4().substring(0, 8)}`;
    const key = `${caseId}/${evidenceId}`;
    const command = new PutObjectCommand({ Bucket: EVIDENCE_BUCKET, Key: key, ContentType: body.contentType || 'application/pdf', ContentLength: body.contentLength });
    const url = await getSignedUrl(s3Client, command, { expiresIn: 300 });
    return respond(200, { uploadUrl: url, evidenceId, key });
  } catch (err: any) { return respond(500, { error: err.message }); }
};

export const submit = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const caseId = event.pathParameters?.id!;
    const res = await docClient.send(new GetCommand({ TableName: CASES_TABLE, Key: { caseId } }));
    if (!res.Item) return respond(404, { error: 'Not found' });
    if (res.Item.status !== CaseStatus.DISPUTED) return respond(400, { error: 'Must be DISPUTED to submit' });
    
    // Start Execution
    const startRes = await sfnClient.send(new StartExecutionCommand({
      stateMachineArn: STATE_MACHINE_ARN,
      input: JSON.stringify({ caseId }),
      name: `${caseId}-${Date.now()}`
    }));

    await docClient.send(new UpdateCommand({
      TableName: CASES_TABLE,
      Key: { caseId },
      UpdateExpression: 'SET #st = :s, executionArn = :arn',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: { ':s': CaseStatus.DELIBERATING, ':arn': startRes.executionArn }
    }));
    return respond(200, { success: true, status: CaseStatus.DELIBERATING, executionArn: startRes.executionArn });
  } catch (err: any) { return respond(500, { error: err.message }); }
};

export const getCase = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const caseId = event.pathParameters?.id!;
    const res = await docClient.send(new GetCommand({ TableName: CASES_TABLE, Key: { caseId } }));
    if (!res.Item) return respond(404, { error: 'Not found' });
    const caseItem = res.Item;

    if (caseItem.executionArn) {
      try {
        const desc = await sfnClient.send(new DescribeExecutionCommand({ executionArn: caseItem.executionArn }));
        caseItem.executionStatus = desc.status;
        
        // Fetch history to get stage
        const hist = await sfnClient.send(new GetExecutionHistoryCommand({ executionArn: caseItem.executionArn, maxResults: 100 }));
        let currentStage = 'PENDING';
        if (hist.events) {
          for (const ev of hist.events) {
            if (ev.type === 'TaskStateEntered' && ev.stateEnteredEventDetails) {
              currentStage = ev.stateEnteredEventDetails?.name ?? currentStage;
            }
          }
        }
        caseItem.currentStage = currentStage;
      } catch (e) {
        console.error("Could not fetch execution details", e);
      }
    }
    return respond(200, caseItem);
  } catch (err: any) { return respond(500, { error: err.message }); }
};
