import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import * as crypto from 'crypto';

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

/**
 * GET /rulings/{id}/verify (TRD section 4: "Recompute hash, compare to stored").
 *
 * Two independent checks, both real:
 *  1. Content integrity: SHA-256 of the exact ruling JSON served through
 *     CloudFront, compared to rulingSha256 written by PUBLISH at publish time.
 *  2. Ledger chain: walk the case's ledger entries in order, recompute every
 *     entryHash from (prevHash | event | amountCents | caseId) — the same
 *     formula the ledger library used to write them — and verify each link.
 *     For a settled case the chain must end at RELEASE; for an escalated one
 *     it must hold no RESOLVE/RELEASE at all (escrow untouched).
 */
export const verifyRuling = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const caseId = event.pathParameters?.id!;
  const domain = process.env.RULINGS_DOMAIN || '';
  if (!domain || !RULINGS_TABLE) return respond(500, { error: 'Rulings verification not configured' });
  try {
    const meta = await docClient.send(new GetCommand({ TableName: RULINGS_TABLE, Key: { caseId } }));
    if (!meta.Item) return respond(404, { error: 'Ruling not published' });

    // --- 1. Content integrity -------------------------------------------------
    const res = await fetch(`https://${domain}/panch-rulings/${encodeURIComponent(caseId)}/ruling.json`);
    if (res.status === 403 || res.status === 404) return respond(404, { error: 'Ruling not published' });
    if (!res.ok) return respond(502, { error: 'Failed to fetch ruling' });
    const rulingText = await res.text();
    const computedHash = crypto.createHash('sha256').update(rulingText).digest('hex');
    const storedHash = meta.Item.rulingSha256;
    // Rulings published before rulingSha256 existed cannot be content-verified;
    // say so honestly instead of pretending a match.
    const contentVerified = typeof storedHash === 'string' && storedHash.length > 0;
    const contentMatch = contentVerified ? computedHash === storedHash : false;

    // --- 2. Ledger chain ------------------------------------------------------
    const ledger = await docClient.send(new QueryCommand({
      TableName: process.env.LEDGER_TABLE || '',
      KeyConditionExpression: 'caseId = :c',
      ExpressionAttributeValues: { ':c': caseId },
    }));
    const entries = (ledger.Items || []).sort((a: any, b: any) => a.seq - b.seq);
    // Two genesis conventions exist in the ledger: 'GENESIS' (fund/dispute in
    // cases.ts) and the 64-zero hash (settle.ts for demo cases that skip the
    // manual fund/dispute steps). Both are valid chain origins.
    const GENESIS_ZERO = '0'.repeat(64);
    const isGenesis = (h: unknown) => h === 'GENESIS' || h === GENESIS_ZERO;
    let chainValid = entries.length > 0;
    let expectedPrev: string | null = null;
    const recomputed: Array<{ seq: number; event: string; entryHash: string; valid: boolean }> = [];
    for (const e of entries) {
      const recomputedHash = crypto
        .createHash('sha256')
        .update(`${e.prevHash}|${e.event}|${e.amountCents}|${caseId}`)
        .digest('hex');
      const hashOk = recomputedHash === e.entryHash;
      const linkOk = expectedPrev === null ? isGenesis(e.prevHash) : e.prevHash === expectedPrev;
      chainValid = chainValid && hashOk && linkOk;
      expectedPrev = e.entryHash;
      recomputed.push({ seq: e.seq, event: e.event, entryHash: e.entryHash, valid: hashOk && linkOk });
    }
    const lastEvent = entries.length > 0 ? String(entries[entries.length - 1].event) : null;
    // A settled case's chain must end at RELEASE; an escalated case (no ruling
    // published) must hold no RESOLVE/RELEASE at all — escrow untouched.
    const terminalOk =
      (meta.Item.escalated === true && entries.length === 0) ||
      (meta.Item.escalated !== true && lastEvent === 'RELEASE');
    const ledgerConsistent = chainValid && terminalOk;

    // match means FULLY verified: the served bytes hash to the stored
    // rulingSha256 AND the settlement chain recomputes clean from GENESIS.
    // A ruling published before content hashing existed cannot be content-
    // verified, so it reports match: false — never a stub true — with the
    // reason spelled out. (Ledger integrity for those rows is still real and
    // is reported separately under ledger.*.)
    const match = contentVerified && contentMatch && ledgerConsistent;
    const reason = !contentVerified
      ? 'Ruling published before content hashing was recorded, so the served bytes cannot be compared to a stored hash. The ledger chain was verified independently.'
      : !contentMatch
        ? 'Ruling content does not match the stored hash: the published bytes are not the ones that were signed.'
        : !chainValid
          ? 'Ledger chain failed to recompute: an entry hash or link is invalid.'
          : !terminalOk
            ? `Ledger chain is valid but does not terminate correctly (last event: ${lastEvent}).`
            : 'Ruling content matches the stored hash and the ledger chain recomputes clean from genesis.';

    return respond(200, {
      caseId,
      match,
      reason,
      content: {
        computedHash,
        storedHash: storedHash ?? null,
        match: contentVerified ? contentMatch : null,
        verified: contentVerified,
      },
      ledger: {
        entries: recomputed,
        chainValid,
        terminalOk,
        consistent: ledgerConsistent,
        lastEvent,
      },
      verifiedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('verifyRuling failed', err);
    return respond(500, { error: 'Verification failed' });
  }
};
