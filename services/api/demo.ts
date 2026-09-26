import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { CaseStatus } from '../shared';

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sfnClient = new SFNClient({});
const CASES_TABLE = process.env.CASES_TABLE || '';
const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN || '';

function respond(statusCode: number, body: any): APIGatewayProxyResult {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) };
}

export const runDemo = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const caseId = `demo-${uuidv4().substring(0, 8)}`;
    const claimantId = 'demo-claimant';
    
    // Auto-create, fund, dispute
    const item = { 
      caseId, 
      status: CaseStatus.DISPUTED, // Straight to disputed
      claimantId, 
      respondentId: 'demo-respondent', 
      amountCents: 50000, 
      currency: 'USD', 
      createdAt: new Date().toISOString() 
    };
    
    await docClient.send(new PutCommand({ TableName: CASES_TABLE, Item: item }));

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
    
    return respond(200, { success: true, caseId, status: CaseStatus.DELIBERATING });
  } catch (err: any) { return respond(500, { error: err.message }); }
};
