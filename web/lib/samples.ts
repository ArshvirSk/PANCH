/**
 * The published ruling every "Sample ruling" link opens. Case A of the synthetic
 * demo benchmark (bench/demo/case-a): settled live at 10000 bps, matching its gold
 * label, with the content hash and ledger chain verifying (LOG.md phases 16, 23).
 * The earlier c-104 id only existed in the API stub and now 404s.
 */
export const SAMPLE_RULING_ID = 'demo-ba-a-354484';
export const SAMPLE_RULING_HREF = `/ruling/?id=${SAMPLE_RULING_ID}`;
