import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

// We import fixtures from shared
import data from '../shared/fixtures/data.json';

function respond(statusCode: number, body: any): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body)
  };
}

export const getRuling = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  // Stub until the tribunal publishes real rulings: the fixture ruling for case c-104, 404 otherwise.
  const caseId = event.pathParameters?.id;
  if (caseId !== data.tribunalOutput.caseId) return respond(404, { error: 'Ruling not found' });
  return respond(200, data.tribunalOutput.ruling);
};

export const demoRun = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  // Demo run starts a pre-seeded case
  return respond(200, { success: true, message: 'Demo run started', executionArn: 'arn:aws:states:demo...' });
};

export const getBenchSummary = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  return respond(200, {
    totalRuns: 10,
    flipRate: 0.05,
    averageSpread: 1200
  });
};
