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
  return respond(200, data.ruling);
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
