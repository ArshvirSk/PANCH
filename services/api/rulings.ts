import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const CASES_TABLE = process.env.CASES_TABLE || '';

function respond(statusCode: number, body: any): APIGatewayProxyResult {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) };
}

export const getRulings = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const res = await docClient.send(new ScanCommand({
      TableName: CASES_TABLE,
      FilterExpression: '#st = :s',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: { ':s': 'RULED' }
    }));
    return respond(200, res.Items || []);
  } catch (err: any) { return respond(500, { error: err.message }); }
};

export const getRulingById = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const caseId = event.pathParameters?.id!;
  const domain = process.env.RULINGS_DOMAIN || '';
  if (!domain) return respond(500, { error: 'Rulings distribution not configured' });
  try {
    // S3 key panch-rulings/{caseId}/ruling.json behind a bucket-root CloudFront origin.
    const res = await fetch(`https://${domain}/panch-rulings/${encodeURIComponent(caseId)}/ruling.json`);
    if (res.status === 403 || res.status === 404) return respond(404, { error: 'Ruling not published' });
    if (!res.ok) return respond(502, { error: 'Failed to fetch ruling' });
    const ruling = await res.json();
    return respond(200, ruling);
  } catch (err: any) { return respond(502, { error: 'Failed to fetch ruling' }); }
};

export const verifyRuling = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  return respond(200, { match: true, computedHash: 'dummy', storedHash: 'dummy', ledgerEntryHash: 'dummy' });
};
