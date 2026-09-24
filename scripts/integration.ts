import fetch from 'node-fetch';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient, AdminCreateUserCommand, AdminSetUserPasswordCommand, AdminInitiateAuthCommand } from '@aws-sdk/client-cognito-identity-provider';
import * as fs from 'fs';
import * as path from 'path';

const apiUrl = process.env.API_URL;
if (!apiUrl) throw new Error('API_URL required');

const evidenceTableName = process.env.EVIDENCE_TABLE;
const userPoolId = process.env.USER_POOL_ID;
const clientId = process.env.CLIENT_ID;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cognito = new CognitoIdentityProviderClient({});

async function getAuthToken() {
  const username = `test-${Date.now()}@example.com`;
  const password = 'Password123!';
  
  await cognito.send(new AdminCreateUserCommand({
    UserPoolId: userPoolId,
    Username: username,
    MessageAction: 'SUPPRESS',
    TemporaryPassword: password
  }));
  
  await cognito.send(new AdminSetUserPasswordCommand({
    UserPoolId: userPoolId,
    Username: username,
    Password: password,
    Permanent: true
  }));

  const auth = await cognito.send(new AdminInitiateAuthCommand({
    UserPoolId: userPoolId,
    ClientId: clientId,
    AuthFlow: 'ADMIN_NO_SRP_AUTH',
    AuthParameters: { USERNAME: username, PASSWORD: password }
  }));
  
  return auth.AuthenticationResult?.IdToken!;
}

async function run() {
  let token = '';
  if (userPoolId && clientId) {
    console.log('0. Authenticating with Cognito...');
    token = await getAuthToken();
  } else {
    console.warn('Skipping auth, USER_POOL_ID or CLIENT_ID not provided.');
  }

  const headers = { 'Authorization': token, 'Content-Type': 'application/json' };

  console.log('1. Creating case...');
  let res = await fetch(`${apiUrl}cases`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ amountCents: 5000, respondentEmail: 'test@example.com' })
  });
  console.log('Create case status:', res.status);
  let text = await res.text();
  console.log('Create case body:', text);
  let data = JSON.parse(text);
  const caseId = data.caseId;
  console.log(`Created case: ${caseId}`);

  console.log('2. Funding case...');
  res = await fetch(`${apiUrl}cases/${caseId}/fund`, { method: 'POST', headers });
  console.log('Fund case status:', res.status);
  text = await res.text();
  console.log('Fund case body:', text);
  data = JSON.parse(text);
  console.log(`Fund status: ${data.newStatus}`);

  console.log('3. Disputing case...');
  res = await fetch(`${apiUrl}cases/${caseId}/dispute`, { method: 'POST', headers });
  data = await res.json() as any;
  console.log(`Dispute status: ${data.newStatus}`);

  console.log('4. Getting upload URL...');
  res = await fetch(`${apiUrl}cases/${caseId}/evidence`, { 
    method: 'POST',
    headers,
    body: JSON.stringify({ contentType: 'text/plain', contentLength: 12 })
  });
  data = await res.json() as any;
  const uploadUrl = data.uploadUrl;
  const evidenceId = data.evidenceId;

  console.log(`5. Uploading file to S3...`);
  const fileContent = 'Hello World!';
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    body: fileContent,
    headers: { 'Content-Type': 'text/plain' }
  });
  console.log(`Upload status: ${putRes.status}`);

  if (!evidenceTableName) {
    console.log('EVIDENCE_TABLE not set, skipping DB verification');
    return;
  }

  console.log(`6. Waiting 5s for S3 event lambda to process...`);
  await new Promise(r => setTimeout(r, 5000));

  console.log(`7. Verifying Evidence item and hash...`);
  const getRes = await ddb.send(new GetCommand({
    TableName: evidenceTableName,
    Key: { caseId, evidenceId }
  }));

  if (!getRes.Item) {
    throw new Error('Evidence item not found in DynamoDB');
  }
  console.log(`Evidence found:`, getRes.Item);
  
  // Hash of 'Hello World!' is 7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069
  if (getRes.Item.sha256 !== '7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069') {
    throw new Error(`Hash mismatch! Got ${getRes.Item.sha256}`);
  }
  
  console.log('Integration test passed successfully!');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
