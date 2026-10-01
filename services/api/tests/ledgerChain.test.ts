import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fund, dispute } from '../cases';
import { computeEntryHash, LedgerEvent, LEDGER_GENESIS } from '../../shared';

/**
 * FUND and DISPUTE must link onto the tip of the case's hash chain.
 *
 * Both handlers used to hardcode `prevHash: 'GENESIS'` (with seq 1 and 2), so a
 * case funded and disputed through the API wrote a DISPUTE entry claiming to
 * follow genesis while a FUND entry already existed. GET
 * /rulings/{id}/verify recomputes every link, so it reported a broken chain for
 * every case that went through the real flow (LOG.md phases 22 and 25).
 */

// Env must be set before cases.ts / shared/ledger.ts are imported.
vi.hoisted(() => {
  process.env.CASES_TABLE = 'Cases';
  process.env.LEDGER_TABLE = 'Ledger';
});

const sendMock = vi.hoisted(() => vi.fn());
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: sendMock })) },
  GetCommand: class { constructor(public input: any) {} },
  PutCommand: class { constructor(public input: any) {} },
  UpdateCommand: class { constructor(public input: any) {} },
  QueryCommand: class { constructor(public input: any) {} },
  TransactWriteCommand: class { constructor(public input: any) {} },
}));
vi.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: vi.fn() }));
vi.mock('@aws-sdk/client-s3', () => ({ S3Client: class {}, PutObjectCommand: class { constructor(public input: any) {} } }));
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: vi.fn() }));
vi.mock('@aws-sdk/client-sfn', () => ({
  SFNClient: class {},
  StartExecutionCommand: class { constructor(public input: any) {} },
  DescribeExecutionCommand: class { constructor(public input: any) {} },
  GetExecutionHistoryCommand: class { constructor(public input: any) {} },
}));

const CASE_ID = 'c-1234abcd';
const AMOUNT = 40000;
const FUND_HASH = computeEntryHash(LEDGER_GENESIS, LedgerEvent.FUND, AMOUNT, CASE_ID);

/** Drives the three reads/writes a transition makes: get case, read head, transact. */
function prime({ status, head }: { status: string; head: Array<Record<string, unknown>> }) {
  const writes: any[] = [];
  sendMock.mockImplementation(async (cmd: any) => {
    if (cmd.input?.TransactItems) {
      writes.push(cmd.input);
      return {};
    }
    if (cmd.input?.KeyConditionExpression) return { Items: head };
    if (cmd.input?.Key) return { Item: { caseId: CASE_ID, status, amountCents: AMOUNT } };
    return {};
  });
  return writes;
}

function event() {
  return { pathParameters: { id: CASE_ID }, headers: {}, requestContext: {} } as any;
}

// Block body: mockReset() returns the mock, and a beforeEach that returns a
// function makes vitest register that mock as a cleanup hook — it would then be
// called with no arguments between tests.
beforeEach(() => {
  sendMock.mockReset();
});

describe('ledger chain written by POST /cases/{id}/fund and /dispute', () => {
  it('FUND on a fresh case starts the chain at the genesis hash with seq 1', async () => {
    const writes = prime({ status: 'CREATED', head: [] });
    const res = await fund(event());
    expect(res.statusCode).toBe(200);

    const item = writes[0].TransactItems[0].Put.Item;
    expect(item.seq).toBe(1);
    expect(item.prevHash).toBe(LEDGER_GENESIS);
    expect(item.entryHash).toBe(FUND_HASH);
  });

  it('DISPUTE links onto the FUND entry instead of claiming genesis', async () => {
    const writes = prime({ status: 'FUNDED', head: [{ caseId: CASE_ID, seq: 1, event: 'FUND', entryHash: FUND_HASH }] });
    const res = await dispute(event());
    expect(res.statusCode).toBe(200);

    const item = writes[0].TransactItems[0].Put.Item;
    expect(item.seq).toBe(2);
    expect(item.prevHash).toBe(FUND_HASH);
    expect(item.entryHash).toBe(computeEntryHash(FUND_HASH, LedgerEvent.DISPUTE, AMOUNT, CASE_ID));
  });

  it('the chain a verifier recomputes from FUND to DISPUTE stays valid', async () => {
    const writes = prime({ status: 'FUNDED', head: [{ caseId: CASE_ID, seq: 1, event: 'FUND', entryHash: FUND_HASH }] });
    await dispute(event());

    // Same walk as services/api/rulings.ts verifyRuling.
    const entries = [
      { seq: 1, event: 'FUND', prevHash: LEDGER_GENESIS, entryHash: FUND_HASH },
      writes[0].TransactItems[0].Put.Item,
    ].sort((a, b) => a.seq - b.seq);

    let expectedPrev: string | null = null;
    for (const e of entries) {
      const recomputed = computeEntryHash(e.prevHash, e.event as LedgerEvent, AMOUNT, CASE_ID);
      expect(recomputed).toBe(e.entryHash);
      expect(expectedPrev === null ? e.prevHash === LEDGER_GENESIS : e.prevHash === expectedPrev).toBe(true);
      expectedPrev = e.entryHash;
    }
  });

  it('FUND on a case that already has entries continues the chain', async () => {
    const writes = prime({ status: 'CREATED', head: [{ caseId: CASE_ID, seq: 3, event: 'DISPUTE', entryHash: 'f'.repeat(64) }] });
    const res = await fund(event());
    expect(res.statusCode).toBe(200);

    const item = writes[0].TransactItems[0].Put.Item;
    expect(item.seq).toBe(4);
    expect(item.prevHash).toBe('f'.repeat(64));
  });
});
