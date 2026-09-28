# Fallback ruling — Case A (claimant win on non-payment after delivery)

- **Status:** cached fallback — the live tribunal failed to reach a ruling
- **Award:** no award (`payeeShareBps: 0`, escrow untouched)
- **Reference expectation (not an award):** clear claimant win — non-payment
  after confirmed delivery with no valid withholding notice under clauses 4.1
  and 4.2 of the seeded contract. Gold label: 10000 bps (see `gold.json`).

The tribunal could not complete deliberation for this demo case. No RESOLVE or
RELEASE ledger entry was recorded, so escrow is unaffected. This cached page is
served by the Catch path so the public ruling URL stays reachable during a demo.
