import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, appendLedgerEntry, validateTransition, CaseStatus, LedgerEvent } from '../shared';

const s3Client = new S3Client({});
const CASES_TABLE = process.env.CASES_TABLE || '';
const EVIDENCE_BUCKET = process.env.EVIDENCE_BUCKET || '';

function respond(statusCode: number, body: any): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body)
  };
}

export const create = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const body = JSON.parse(event.body || '{}');
    const caseId = `c-${uuidv4().substring(0, 8)}`;
    const claimantId = event.requestContext.authorizer?.claims?.sub || 'test-user';
    
    // In a real app we'd validate with Zod here
    // import { createDealRequestSchema } from '../shared'
    
    const item = {
      caseId,
      status: CaseStatus.CREATED,
      claimantId,
      respondentId: body.respondentEmail || 'pending',
      amountCents: body.amountCents || 0,
      currency: body.currency || 'USD',
      createdAt: new Date().toISOString()
    };

    await docClient.send(new PutCommand({
      TableName: CASES_TABLE,
      Item: item
    }));

    return respond(201, item);
  } catch (err: any) {
    return respond(500, { error: err.message });
  }
};

export const fund = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const caseId = event.pathParameters?.id!;
    // Assume we fetch the case to get the exact amount and prevHash
    const res = await docClient.send(new GetCommand({ TableName: CASES_TABLE, Key: { caseId } }));
    if (!res.Item) return respond(404, { error: 'Not found' });
    
    const newStatus = validateTransition(res.Item.status as CaseStatus, LedgerEvent.FUND);
    
    // Get last ledger entry for prevHash (simplified: assuming GENESIS for first)
    const prevHash = 'GENESIS'; // Typically query ledger table where seq = max
    
    const result = await appendLedgerEntry({
      caseId,
      event: LedgerEvent.FUND,
      amountCents: res.Item.amountCents,
      expectedStatus: res.Item.status as CaseStatus,
      newStatus,
      seq: 1,
      prevHash
    });

    return respond(200, { success: true, newStatus, entryHash: result.entryHash });
  } catch (err: any) {
    return respond(400, { error: err.message });
  }
};

export const dispute = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const caseId = event.pathParameters?.id!;
    const res = await docClient.send(new GetCommand({ TableName: CASES_TABLE, Key: { caseId } }));
    if (!res.Item) return respond(404, { error: 'Not found' });
    
    const newStatus = validateTransition(res.Item.status as CaseStatus, LedgerEvent.DISPUTE);
    
    // Get last entry (simplified for hackathon)
    const prevHash = 'GENESIS'; // Would query seq = 1
    
    const result = await appendLedgerEntry({
      caseId,
      event: LedgerEvent.DISPUTE,
      amountCents: res.Item.amountCents,
      expectedStatus: res.Item.status as CaseStatus,
      newStatus,
      seq: 2,
      prevHash
    });

    return respond(200, { success: true, newStatus, entryHash: result.entryHash });
  } catch (err: any) {
    return respond(400, { error: err.message });
  }
};

export const evidenceUrl = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const caseId = event.pathParameters?.id!;
    const body = JSON.parse(event.body || '{}');
    const evidenceId = `ev-${uuidv4().substring(0, 8)}`;
    
    const key = `${caseId}/${evidenceId}`;
    const command = new PutObjectCommand({
      Bucket: EVIDENCE_BUCKET,
      Key: key,
      ContentType: body.contentType || 'application/pdf',
      ContentLength: body.contentLength // We can enforce size later via limits or policies
    });
    
    const url = await getSignedUrl(s3Client, command, { expiresIn: 300 }); // 5 minutes
    
    return respond(200, { uploadUrl: url, evidenceId, key });
  } catch (err: any) {
    return respond(500, { error: err.message });
  }
};

export const submit = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const caseId = event.pathParameters?.id!;
    const res = await docClient.send(new GetCommand({ TableName: CASES_TABLE, Key: { caseId } }));
    if (!res.Item) return respond(404, { error: 'Not found' });
    
    if (res.Item.status !== CaseStatus.DISPUTED) {
      return respond(400, { error: 'Must be DISPUTED to submit' });
    }
    
    await docClient.send(new UpdateCommand({
      TableName: CASES_TABLE,
      Key: { caseId },
      UpdateExpression: 'SET #st = :s',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: { ':s': CaseStatus.DELIBERATING }
    }));
    
    // TODO: Start Step Functions Execution here
    
    return respond(200, { success: true, status: CaseStatus.DELIBERATING });
  } catch (err: any) {
    return respond(500, { error: err.message });
  }
};

export const getCase = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const caseId = event.pathParameters?.id!;
    const res = await docClient.send(new GetCommand({ TableName: CASES_TABLE, Key: { caseId } }));
    if (!res.Item) return respond(404, { error: 'Not found' });
    
    return respond(200, res.Item);
  } catch (err: any) {
    return respond(500, { error: err.message });
  }
};
