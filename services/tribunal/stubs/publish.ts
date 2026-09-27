import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { PublishInput, PublishOutput } from '../../shared/step-functions';
import { JudgeOutput } from '../../shared/schemas';
import { emitMetric } from '../../shared/metrics';

const s3 = new S3Client({});
const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const BUCKET = process.env.RULINGS_BUCKET || process.env.BUCKET || '';
const RULINGS_TABLE = process.env.RULINGS_TABLE || '';

export const handler = async (event: PublishInput): Promise<PublishOutput> => {
  // Fallback path: the Catch -> FAILED lambda has already cached a fallback ruling for demo cases.
  if (event.fallback) {
    return {
      caseId: event.caseId,
      publishedUrl: `https://panch.example/rulings/${event.caseId}`,
    };
  }

  // Presiding synthesis first: publish the presiding arbitrator's ruling body
  // (same fields the ruling page validates) when the synthesis produced one.
  // Median fallback keeps the Catch -> FAILED path publishable for demo cases.
  const entries = Object.entries(event.finalPanelOutputs ?? {});
  const sorted = [...entries].sort((a, b) => a[1].payeeShareBps - b[1].payeeShareBps);
  const median: JudgeOutput | undefined = sorted.length > 0 ? sorted[Math.floor((sorted.length - 1) / 2)][1] : undefined;
  const ruling: JudgeOutput | undefined = event.ruling ?? median;

  const body = {
    caseId: event.caseId,
    // The ruling body's own award wins so the published number always matches
    // the published reasoning; event.payeeShareBps covers legacy/absent bodies.
    payeeShareBps: ruling?.payeeShareBps ?? event.payeeShareBps ?? 0,
    spreadBps: event.spreadBps ?? 0,
    swapConsistent: event.swapConsistent ?? true,
    findingsOfFact: ruling?.findingsOfFact ?? [],
    clausesRelied: ruling?.clausesRelied ?? [],
    reasoning: ruling?.reasoning ?? '',
    confidence: ruling?.confidence ?? 0,
    uncertainties: ruling?.uncertainties ?? [],
    finalPanelOutputs: event.finalPanelOutputs ?? {},
    publishedAt: new Date().toISOString(),
  };

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: `panch-rulings/${event.caseId}/ruling.json`,
    Body: JSON.stringify(body, null, 2),
    ContentType: 'application/json',
  }));

  // Cost tracking (PRD: log token counts and cost per case in the Rulings
  // table). Usage is the real per-model sum of the panel's Bedrock Converse
  // responses; costUsd is priced from the SSM table and stays undefined when
  // a model has no price entry — tokens are real, the cost is then unknown.
  if (RULINGS_TABLE) {
    try {
      await docClient.send(new PutCommand({
        TableName: RULINGS_TABLE,
        Item: {
          caseId: event.caseId,
          escalated: false,
          payeeShareBps: body.payeeShareBps,
          spreadBps: body.spreadBps,
          swapConsistent: body.swapConsistent,
          rulingKey: `panch-rulings/${event.caseId}/ruling.json`,
          tokens: event.usage?.totalTokens ?? 0,
          inputTokens: event.usage?.inputTokens ?? 0,
          outputTokens: event.usage?.outputTokens ?? 0,
          perModelUsage: event.usage?.perModel ?? {},
          costUsd: event.costUsd,
          usageSource: 'bedrock-converse',
          publishedAt: body.publishedAt,
        },
        // Republishing (retry after a transient failure, or a FAILED ->
        // resubmit run reaching PUBLISH again) must not clobber the original
        // ruling or cost record.
        ConditionExpression: 'attribute_not_exists(caseId)',
      }));
    } catch (err: any) {
      // The ruling record already exists — that is success for a retry, not
      // a failure. Fail everything else loudly (the old swallow-everything
      // pattern is how a failed SETTLE once looked like a green run).
      if (err?.name === 'ConditionalCheckFailedException') {
        console.log(`Ruling record for ${event.caseId} already exists; keeping the original`);
      } else {
        throw err;
      }
    }
    emitMetric('BedrockTokens', event.usage?.totalTokens ?? 0, 'Count', { Stage: 'PUBLISH', Model: 'all', CaseId: event.caseId, Judge: 'panel' });
  }

  return {
    caseId: event.caseId,
    publishedUrl: `panch-rulings/${event.caseId}/ruling.json`,
  };
};
