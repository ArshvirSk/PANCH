import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';
import { verifyRuling } from '../rulings';

const { mockSend, mockFetch } = vi.hoisted(() => ({ mockSend: vi.fn(), mockFetch: vi.fn() }));

vi.mock('@aws-sdk/lib-dynamodb', async (importOriginal) => {
  const actual = await vi.importActual<typeof import('@aws-sdk/lib-dynamodb')>('@aws-sdk/lib-dynamodb');
  return { ...actual, DynamoDBDocumentClient: { from: vi.fn(() => ({ send: mockSend })) } };
});
vi.stubGlobal('fetch', mockFetch);

// rulings.ts captures RULINGS_TABLE/RULINGS_DOMAIN into module consts at
// import time, so the env must be set before the imports evaluate.
vi.hoisted(() => {
  process.env.RULINGS_TABLE = 'rulings';
  process.env.LEDGER_TABLE = 'ledger';
  process.env.RULINGS_DOMAIN = 'dist.cloudfront.net';
});

const storedHash = (body: string) => crypto.createHash('sha256').update(body).digest('hex');
const rulingBody = JSON.stringify({ caseId: 'c-1', payeeShareBps: 7000 }, null, 2);

/** Builds a synthetic valid chain exactly the way the ledger library writes entries. */
interface ChainEntry { seq: number; event: string; amountCents: number; prevHash: string; entryHash: string; }
const chain = (caseId: string, origin: 'GENESIS' | 'ZEROS', amount = 50000): ChainEntry[] => {
  const entryHash = (prevHash: string, event: string, amountCents: number) =>
    crypto.createHash('sha256').update(`${prevHash}|${event}|${amountCents}|${caseId}`).digest('hex');
  const zero = '0'.repeat(64);
  const fund: ChainEntry = {
    seq: 1, event: 'FUND', amountCents: amount,
    prevHash: origin === 'GENESIS' ? 'GENESIS' : zero,
    entryHash: '',
  };
  fund.entryHash = entryHash(fund.prevHash, fund.event, fund.amountCents);
  const release: ChainEntry = {
    seq: 4, event: 'RELEASE', amountCents: amount,
    prevHash: fund.entryHash,
    entryHash: entryHash(fund.entryHash, 'RELEASE', amount),
  };
  return [fund, release];
};

const metaItem = (escalated = false) => ({ caseId: 'c-1', escalated, rulingSha256: storedHash(rulingBody) });

const event = (caseId = 'c-1') => ({ pathParameters: { id: caseId } } as any);

describe('GET /rulings/{id}/verify', () => {
  beforeEach(() => { mockSend.mockReset(); mockFetch.mockReset(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.stubGlobal('fetch', mockFetch); });

  it('returns match: true for an intact ruling with a valid RELEASE-terminated chain (GENESIS origin)', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: metaItem(false) })          // Rulings get
      .mockResolvedValueOnce({ Items: chain('c-1', 'GENESIS') }); // ledger query
    mockFetch.mockResolvedValueOnce(new Response(rulingBody, { status: 200 }));

    const res = await verifyRuling(event());
    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.match).toBe(true);
    expect(body.content.match).toBe(true);
    expect(body.content.verified).toBe(true);
    expect(body.ledger.chainValid).toBe(true);
    expect(body.ledger.terminalOk).toBe(true);
    expect(body.ledger.consistent).toBe(true);
    expect(body.ledger.lastEvent).toBe('RELEASE');
    expect(body.ledger.entries.every((e: any) => e.valid)).toBe(true);
  });

  it('accepts the 64-zero genesis convention (demo settle path)', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: metaItem(false) })
      .mockResolvedValueOnce({ Items: chain('c-1', 'ZEROS') });
    mockFetch.mockResolvedValueOnce(new Response(rulingBody, { status: 200 }));

    const body = JSON.parse((await verifyRuling(event())).body);
    expect(body.match).toBe(true);
    expect(body.ledger.chainValid).toBe(true);
  });

  it('returns match: false when the served ruling bytes differ from the stored hash', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: metaItem(false) })
      .mockResolvedValueOnce({ Items: chain('c-1', 'GENESIS') });
    mockFetch.mockResolvedValueOnce(new Response(rulingBody.replace('7000', '9999'), { status: 200 }));

    const body = JSON.parse((await verifyRuling(event())).body);
    expect(body.match).toBe(false);
    expect(body.content.match).toBe(false);
    expect(body.content.computedHash).not.toBe(body.content.storedHash);
    expect(body.ledger.consistent).toBe(true); // chain itself is fine
  });

  it('returns match: false when a ledger entry hash was tampered with', async () => {
    const entries = chain('c-1', 'GENESIS').map((e, i) => (i === 1 ? { ...e, entryHash: 'f'.repeat(64) } : e));
    mockSend
      .mockResolvedValueOnce({ Item: metaItem(false) })
      .mockResolvedValueOnce({ Items: entries });
    mockFetch.mockResolvedValueOnce(new Response(rulingBody, { status: 200 }));

    const body = JSON.parse((await verifyRuling(event())).body);
    expect(body.match).toBe(false);
    expect(body.ledger.chainValid).toBe(false);
    expect(body.ledger.entries[1].valid).toBe(false);
  });

  it('404s honestly for an escalated case: PUBLISH never ran, so there is no ruling to verify', async () => {
    // Escalated cases skip PUBLISH entirely — no Rulings row, no ruling JSON.
    // The escrow-untouched property for those cases is shown by the review
    // queue (no settlement entries), not by a ruling verification.
    mockSend.mockResolvedValueOnce({ Item: undefined });
    const res = await verifyRuling(event('c-escalated-1'));
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toBe('Ruling not published');
  });

  it('marks legacy rulings (no stored hash) honestly: content.match is null, not true', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: { caseId: 'c-1', escalated: false } })  // no rulingSha256
      .mockResolvedValueOnce({ Items: chain('c-1', 'GENESIS') });
    mockFetch.mockResolvedValueOnce(new Response(rulingBody, { status: 200 }));

    const body = JSON.parse((await verifyRuling(event())).body);
    expect(body.content.verified).toBe(false);
    expect(body.content.match).toBeNull();
    // Fully-verified means content AND chain. Content was never signed, so the
    // honest answer is false with a reason — never a stub true.
    expect(body.match).toBe(false);
    expect(body.reason).toMatch(/before content hashing/);
    expect(body.ledger.consistent).toBe(true); // the chain part is still real
  });

  it('404s when the ruling was never published', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });
    const res = await verifyRuling(event());
    expect(res.statusCode).toBe(404);
  });
});
