import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { CaseStatus } from '../shared';
import { emitMetric } from '../shared/metrics';

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sfnClient = new SFNClient({});
const s3Client = new S3Client({});
const CASES_TABLE = process.env.CASES_TABLE || '';
const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN || '';
const EVIDENCE_BUCKET = process.env.BUCKET || '';

// Fixed demo contract: its extracted text is seeded into the evidence bucket so
// the real tribunal judges have substantive terms to evaluate (delivery
// confirmed, payment clause 3.1, escalation clause 4.2 -> full payment due).
const DEMO_CONTRACT_TEXT = [
  'CONTRACT FOR FREELANCE SERVICES',
  '',
  'Parties: The Claimant (freelance designer) and the Respondent (client).',
  '',
  '1. Scope of work: The Claimant agrees to design and deliver a complete landing page for the Respondent.',
  '2. Delivery: The Claimant delivered the completed landing page on 3 March 2026. The Respondent confirmed receipt by email on the same day.',
  '3. Payment terms:',
  '   Clause 3.1: The Respondent shall pay the Claimant 500 USD within 7 days of confirmed delivery.',
  '   Clause 3.2: Payment shall be made in full to the Claimant unless the deliverable fails to conform to the agreed scope.',
  '4. Breach and remedy:',
  '   Clause 4.1: The Respondent may withhold payment only if the deliverable does not conform to the agreed scope and the Claimant fails to fix it within 14 days of written notice.',
  '   Clause 4.2: If the Respondent fails to pay within 7 days of confirmed delivery without a valid withholding reason, the full contracted amount becomes immediately due to the Claimant.',
  '5. Dispute resolution: Any dispute is resolved by a neutral tribunal applying this contract as written.',
  '',
  'Facts on the record: The Respondent confirmed receipt of the deliverable on 3 March 2026. The Respondent never gave written notice of non-conformity. As of the case filing date, 45 days have passed and no payment has been made.',
].join('\n');

function respond(statusCode: number, body: any): APIGatewayProxyResult {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) };
}

export const runDemo = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    // ObsStack dashboard: count every demo run attempt (EMF -> CloudWatch).
    emitMetric('DemoRuns', 1, 'Count', {});
    const caseId = `demo-${uuidv4().substring(0, 8)}`;
    const claimantId = 'demo-claimant';
    
    // DynamoDB Daily Cap (default 30/day)
    const today = new Date().toISOString().substring(0, 10); // YYYY-MM-DD
    const capRes = await docClient.send(new UpdateCommand({
      TableName: CASES_TABLE,
      Key: { caseId: `DEMO_CAP_${today}` },
      UpdateExpression: 'ADD #cnt :inc',
      ExpressionAttributeNames: { '#cnt': 'count' },
      ExpressionAttributeValues: { ':inc': 1 },
      ReturnValues: 'UPDATED_NEW'
    }));

    if (capRes.Attributes && capRes.Attributes.count > 30) {
      return respond(429, { error: 'Daily demo limit reached. Try again tomorrow.' });
    }

    // Auto-create, fund, dispute
    const item = { 
      caseId, 
      status: CaseStatus.DISPUTED, // Straight to disputed
      claimantId, 
      respondentId: 'demo-respondent', 
      amountCents: 50000, 
      currency: 'USD', 
      createdAt: new Date().toISOString(),
      // Marks this as the public demo path: GET /cases/{id} is readable without
      // auth (trimmed of party identifiers). Only set here, never for real cases.
      isDemo: true,
    };
    
    await docClient.send(new PutCommand({ TableName: CASES_TABLE, Item: item }));

    // Seed the demo contract text where intake expects the extracted evidence to
    // live (panch-evidence/{caseId}/extracted/e-1.txt) so the judges can rule on
    // the substance of the dispute rather than an empty record.
    if (EVIDENCE_BUCKET) {
      await s3Client.send(new PutObjectCommand({
        Bucket: EVIDENCE_BUCKET,
        Key: `panch-evidence/${caseId}/extracted/e-1.txt`,
        Body: DEMO_CONTRACT_TEXT,
        ContentType: 'text/plain',
      }));

      // Seed the cached fallback ruling. On failure the Catch -> FAILED lambda
      // copies bench/demo/{caseId}/fallback-ruling.json to
      // panch-rulings/{caseId}/ruling.json, so a failed demo still serves a
      // valid ruling page instead of a 404. Escrow is untouched: no RESOLVE or
      // RELEASE entry is ever written on this path.
      await s3Client.send(new PutObjectCommand({
        Bucket: EVIDENCE_BUCKET,
        Key: `bench/demo/${caseId}/fallback-ruling.json`,
        Body: JSON.stringify({
          caseId,
          payeeShareBps: 0,
          spreadBps: 0,
          swapConsistent: false,
          findingsOfFact: [],
          clausesRelied: [],
          reasoning: 'The tribunal could not complete deliberation for this demo case. Escrow is unaffected: no RESOLVE or RELEASE was recorded. Retry the demo or file the dispute normally.',
          confidence: 0,
          uncertainties: ['Tribunal failure — no ruling was reached'],
          fallback: true,
          publishedAt: new Date().toISOString(),
        }, null, 2),
        ContentType: 'application/json',
      }));
    }

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
