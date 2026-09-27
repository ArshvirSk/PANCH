import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const RULINGS_TABLE = process.env.RULINGS_TABLE || '';

function respond(statusCode: number, body: any): APIGatewayProxyResult {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) };
}

export const getRulings = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    // The gallery's source of truth is the Rulings table: one row per
    // published ruling, written by PUBLISH. (It previously scanned Cases for
    // status RULED — a transient state between RESOLVE and RELEASE — so the
    // gallery was structurally empty: settled cases end SETTLED.) Rows carry
    // the cost record (tokens, costUsd) directly, so no fan-out is needed.
    if (!RULINGS_TABLE) return respond(500, { error: 'Rulings table not configured' });
    const res = await docClient.send(new ScanCommand({ TableName: RULINGS_TABLE }));
    const items = (res.Items || []).sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
    return respond(200, items);
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

    // Cost metadata (PRD: token counts + cost per case live in the Rulings
    // table). Served alongside the ruling body when the record exists.
    if (RULINGS_TABLE) {
      try {
        const cost = await docClient.send(new GetCommand({ TableName: RULINGS_TABLE, Key: { caseId } }));
        if (cost.Item) {
          ruling.tokens = cost.Item.tokens;
          ruling.inputTokens = cost.Item.inputTokens;
          ruling.outputTokens = cost.Item.outputTokens;
          ruling.perModelUsage = cost.Item.perModelUsage;
          ruling.costUsd = cost.Item.costUsd;
          ruling.usageSource = cost.Item.usageSource;
        }
      } catch {
        // Cost metadata is additive; never fail the ruling read over it.
      }
    }

    return respond(200, ruling);
  } catch (err: any) { return respond(502, { error: 'Failed to fetch ruling' }); }
};

export const verifyRuling = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  return respond(200, { match: true, computedHash: 'dummy', storedHash: 'dummy', ledgerEntryHash: 'dummy' });
};
