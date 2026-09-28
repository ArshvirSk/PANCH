import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, GetCommand, UpdateCommand, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SFNClient, GetExecutionHistoryCommand } from '@aws-sdk/client-sfn';
import * as crypto from 'crypto';
import { docClient, appendLedgerEntry, CaseStatus, LedgerEvent } from '../shared';
import { emitMetric } from '../shared/metrics';

const CASES_TABLE = process.env.CASES_TABLE || '';
const LEDGER_TABLE = process.env.LEDGER_TABLE || '';
const RULINGS_TABLE = process.env.RULINGS_TABLE || '';
const RULINGS_BUCKET = process.env.RULINGS_BUCKET || '';

// Mirror of web/lib/reviews.ts MAX_NOTE_LENGTH — the /reviews UI enforces this
// client-side; the API enforces it server-side so the published human ruling
// stays bounded.
const MAX_NOTE_LENGTH = 1000;

const s3 = new S3Client({});
const sfn = new SFNClient({});

function respond(statusCode: number, body: any): APIGatewayProxyResult {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) };
}

interface PanelRecord {
  judges?: Record<string, unknown>;
  swapOutputs?: Record<string, unknown>;
  aggregate?: { medianPayeeShareBps?: number; spreadBps?: number; swapConsistent?: boolean };
  escalationReason?: string;
  escalatedAt?: string;
  recoveredFromHistory?: boolean;
}

/**
 * Legacy rows escalated before the panel record was persisted (PR #11 era):
 * recover judges + aggregate from the case's Step Functions execution
 * history. Read-only; if the execution ARN is gone or the history is
 * truncated, the case still lists — with empty panel data and no lie.
 */
async function recoverPanelRecord(executionArn?: string): Promise<PanelRecord | undefined> {
  if (!executionArn || !executionArn.startsWith('arn:aws:states:')) return undefined;
  try {
    const hist = await sfn.send(new GetExecutionHistoryCommand({ executionArn, maxResults: 200 }));
    let record: PanelRecord = {};
    for (const ev of hist.events || []) {
      const exited = ev.stateExitedEventDetails;
      if (!exited) continue;
      let out: any;
      try { out = JSON.parse(exited.output || 'null'); } catch { continue; }
      if (!out) continue;
      if (exited.name === 'AGGREGATE') {
        record.judges = out.finalPanelOutputs ?? record.judges;
        record.swapOutputs = out.swapOutputs ?? record.swapOutputs;
        record.aggregate = {
          medianPayeeShareBps: out.medianPayeeShareBps,
          spreadBps: out.spreadBps,
          swapConsistent: out.swapConsistent,
        };
        record.escalationReason = out.escalationReason;
      }
    }
    if (record.judges && Object.keys(record.judges).length > 0) {
      record.recoveredFromHistory = true;
      return record;
    }
  } catch (err: any) {
    console.error('Panel-record recovery failed for', executionArn, err?.message);
  }
  return undefined;
}

export const getReviews = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    // The reviews page polls this list; counting it keeps /reviews usage on the dashboard.
    emitMetric('ReviewActions', 1, 'Count', { Action: 'ListReviewsPage' });
    // List Cases where status = ESCALATED
    const res = await docClient.send(new ScanCommand({
      TableName: CASES_TABLE,
      FilterExpression: '#st = :s',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: { ':s': CaseStatus.ESCALATED }
    }));

    const items = await Promise.all((res.Items || []).map(async (item) => {
      // Full panel record (TRD section 8.7): the ESCALATE task persists the
      // judges' outputs, per-judge swap runs, aggregate and reason on the row.
      // Older escalated rows predate the record — recover what the execution
      // history still holds rather than serving placeholder data.
      let panel = item.panelRecord as PanelRecord | undefined;
      if (!panel || !panel.judges || Object.keys(panel.judges).length === 0) {
        const recovered = await recoverPanelRecord(item.executionArn);
        if (recovered) {
          panel = { ...recovered, ...panel };
          // Backfill so the row heals itself for the next poll.
          try {
            await docClient.send(new UpdateCommand({
              TableName: CASES_TABLE,
              Key: { caseId: item.caseId },
              UpdateExpression: 'SET panelRecord = :p',
              ExpressionAttributeValues: { ':p': panel },
            }));
          } catch { /* best-effort backfill; the response is already correct */ }
        }
      }
      const { panelRecord, executionArn, ...publicCase } = item as Record<string, any>;
      return {
        ...publicCase,
        panelOutputs: {
          judges: panel?.judges ?? {},
          swapOutputs: panel?.swapOutputs ?? {},
          aggregate: panel?.aggregate ?? {},
          escalationReason: panel?.escalationReason,
          escalatedAt: panel?.escalatedAt,
          ...(panel?.recoveredFromHistory ? { recoveredFromHistory: true } : {}),
        },
      };
    }));
    return respond(200, items);
  } catch (err: any) { return respond(500, { error: err.message }); }
};

/**
 * Reads the case's ledger head (highest seq) the same way the AI settle path
 * (settle.ts) does, so a human settlement chains onto the real hash chain
 * instead of the fabricated seq 10 / 'MOCK_PREV' pair it used to write.
 */
async function readLedgerHead(caseId: string): Promise<{ seq: number; prevHash: string }> {
  const head = await docClient.send(new QueryCommand({
    TableName: LEDGER_TABLE,
    KeyConditionExpression: 'caseId = :caseId',
    ExpressionAttributeValues: { ':caseId': caseId },
    ScanIndexForward: false, // descending by seq
    Limit: 1,
  }));
  if (head.Items && head.Items.length > 0) {
    return { seq: head.Items[0].seq + 1, prevHash: head.Items[0].entryHash };
  }
  // No entries yet: same 64-zero genesis the ledger library's other caller
  // uses; verifyRuling accepts it as a chain origin.
  return { seq: 1, prevHash: '0'.repeat(64) };
}

export const postReview = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    emitMetric('ReviewActions', 1, 'Count', { Action: 'PostReview' });
    const caseId = event.pathParameters?.caseId!;
    const body = JSON.parse(event.body || '{}');
    const payeeShareBps = body.payeeShareBps;
    const note = typeof body.note === 'string' ? body.note.trim() : '';

    // payeeShareBps is basis points of the escrow going to the payee — it must
    // be an integer in [0, 10000]. Numbers are never parsed from free text.
    if (!Number.isInteger(payeeShareBps) || payeeShareBps < 0 || payeeShareBps > 10000) {
      return respond(400, { error: 'payeeShareBps must be an integer between 0 and 10000' });
    }
    // The reviewer's note is the human ruling's reasoning: it must be present
    // and bounded (the /reviews UI already refuses to submit without one).
    if (!note) return respond(400, { error: 'note is required' });
    if (note.length > MAX_NOTE_LENGTH) {
      return respond(400, { error: `note must be at most ${MAX_NOTE_LENGTH} characters` });
    }

    // Reviewer provenance: store the opaque Cognito sub, not a display name —
    // the ruling page is public.
    const claims: any = (event.requestContext as any)?.authorizer?.claims ?? {};
    const reviewerSub = typeof claims.sub === 'string' ? claims.sub : undefined;

    const res = await docClient.send(new GetCommand({ TableName: CASES_TABLE, Key: { caseId } }));
    if (!res.Item || res.Item.status !== CaseStatus.ESCALATED) {
      return respond(400, { error: 'Case must be ESCALATED' });
    }
    const caseItem = res.Item;
    const panel = (caseItem.panelRecord ?? {}) as PanelRecord;

    // Resolve via Ledger library, chained onto the real head. The conditional
    // status check inside appendLedgerEntry makes a second review of the same
    // case impossible: once resolved, status is no longer ESCALATED and the
    // transaction is rejected (double-settlement guard), surfacing as 409.
    let resolveRes: { entryHash: string };
    let releaseRes: { entryHash: string };
    try {
      const head = await readLedgerHead(caseId);
      resolveRes = await appendLedgerEntry({
        caseId,
        event: LedgerEvent.RESOLVE,
        amountCents: caseItem.amountCents,
        payeeBps: payeeShareBps,
        expectedStatus: CaseStatus.ESCALATED,
        newStatus: CaseStatus.RULED,
        seq: head.seq,
        prevHash: head.prevHash,
      });

      releaseRes = await appendLedgerEntry({
        caseId,
        event: LedgerEvent.RELEASE,
        amountCents: caseItem.amountCents,
        payeeBps: payeeShareBps,
        expectedStatus: CaseStatus.RULED,
        newStatus: CaseStatus.SETTLED,
        seq: head.seq + 1,
        prevHash: resolveRes.entryHash,
      });
    } catch (err: any) {
      if (err.message?.includes('double-entry') || err.message?.includes('status mismatch')
        || err.message?.includes('Double-resolve') || err.message?.includes('Illegal transition')) {
        return respond(409, { error: 'Case already reviewed and settled' });
      }
      throw err;
    }

    // The human ruling gets the same durable record as an AI ruling: the
    // published ruling body the public ruling page serves (rulingSha256
    // content-verified like any PUBLISH output), plus a Rulings table row so
    // the gallery lists it and /rulings/{id}/verify can run.
    const median = panel.aggregate?.medianPayeeShareBps;
    const publishedAt = new Date().toISOString();
    const rulingBody: Record<string, unknown> = {
      caseId,
      humanReviewed: true,
      reviewedBy: 'human-review',
      payeeShareBps,
      spreadBps: typeof median === 'number' ? Math.abs(payeeShareBps - median) : 0,
      findingsOfFact: [], // the reviewer's note is the reasoning; nothing is fabricated
      clausesRelied: [],
      reasoning: note,
      // The published-ruling contract (web/lib/ruling.ts parseRuling) requires a
      // numeric confidence; a human reviewer's determination is final, so 1.
      confidence: 1,
      uncertainties: [],
      publishedAt,
      entryHash: releaseRes.entryHash,
    };
    if (panel.aggregate?.swapConsistent !== undefined) rulingBody.swapConsistent = panel.aggregate.swapConsistent;
    if (reviewerSub) rulingBody.reviewerSub = reviewerSub;

    const rulingBodyJson = JSON.stringify(rulingBody);
    const rulingSha256 = crypto.createHash('sha256').update(rulingBodyJson).digest('hex');

    // S3 first: the Rulings row should not exist while the body it points at
    // 404s. A publish failure after settlement must not fail the request —
    // the escrow move is committed — so it degrades to a loud warning and the
    // ruling page reports match:false / 404 honestly until republished.
    let published = true;
    if (RULINGS_BUCKET) {
      try {
        await s3.send(new PutObjectCommand({
          Bucket: RULINGS_BUCKET,
          Key: `panch-rulings/${caseId}/ruling.json`,
          Body: rulingBodyJson,
          ContentType: 'application/json',
        }));
      } catch (err: any) {
        published = false;
        console.error(`Human-ruling publish to S3 failed for ${caseId} (settlement already committed):`, err?.message);
      }
    } else {
      published = false;
      console.warn(`RULINGS_BUCKET not configured; human ruling body for ${caseId} not published`);
    }

    if (RULINGS_TABLE) {
      try {
        await docClient.send(new PutCommand({
          TableName: RULINGS_TABLE,
          Item: {
            caseId,
            escalated: false,
            humanReviewed: true,
            reviewerSub: rulingBody.reviewerSub,
            payeeShareBps,
            spreadBps: rulingBody.spreadBps,
            ...(rulingBody.swapConsistent !== undefined ? { swapConsistent: rulingBody.swapConsistent } : {}),
            rulingKey: `panch-rulings/${caseId}/ruling.json`,
            rulingSha256,
            entryHash: releaseRes.entryHash,
            note,
            published,
            publishedAt,
          },
        }));
      } catch (err: any) {
        console.error(`Rulings row write failed for human review ${caseId} (settlement already committed):`, err?.message);
      }
    }

    return respond(200, { caseId, status: CaseStatus.SETTLED, entryHash: releaseRes.entryHash, published });
  } catch (err: any) { return respond(500, { error: err.message }); }
};
