import { S3Event } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../shared';
import * as crypto from 'crypto';

const s3Client = new S3Client({});
const EVIDENCE_TABLE = process.env.EVIDENCE_TABLE || '';

export const handler = async (event: S3Event) => {
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
    
    const parts = key.split('/');
    if (parts.length < 2) continue;
    const caseId = parts[0];
    const evidenceId = parts[1];

    // Read object to compute sha256
    const getObj = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const stream = getObj.Body as NodeJS.ReadableStream;
    
    const hash = crypto.createHash('sha256');
    for await (const chunk of stream) {
      hash.update(chunk);
    }
    const sha256 = hash.digest('hex');

    // Update Evidence table
    await docClient.send(new PutCommand({
      TableName: EVIDENCE_TABLE,
      Item: {
        caseId,
        evidenceId,
        s3Key: key,
        sha256,
        uploadedAt: new Date().toISOString()
      }
    }));
    
    console.log(`Processed evidence ${evidenceId} for case ${caseId} with hash ${sha256}`);
  }
};
