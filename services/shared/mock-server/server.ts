import express from 'express';
import cors from 'cors';
import data from '../fixtures/data.json';

const app = express();
app.use(cors());
app.use(express.json());

app.post('/cases', (req, res) => {
  res.json({ caseId: 'c-100', status: 'CREATED' });
});

app.post('/cases/:id/fund', (req, res) => {
  res.json({ success: true, status: 'FUNDED' });
});

app.post('/cases/:id/dispute', (req, res) => {
  res.json({ success: true, status: 'DISPUTED' });
});

app.post('/cases/:id/evidence', (req, res) => {
  res.json({ evidenceId: 'e-' + Date.now(), uploadUrl: 'https://mock-s3-url' });
});

app.post('/cases/:id/respond', (req, res) => {
  res.json({ success: true });
});

app.post('/cases/:id/submit', (req, res) => {
  res.json({ success: true, status: 'DELIBERATING' });
});

app.get('/cases/:id', (req, res) => {
  const state = (req.query.state as string) || 'CREATED';
  const c = (data.cases as any)[state] || data.cases.CREATED;
  
  // Simulate timeline if deliberating or ruled
  let timeline = [];
  if (state === 'DELIBERATING') {
    timeline = data.timeline.slice(0, 4); // Up to CROSS_EXAM
  } else if (state === 'RULED' || state === 'SETTLED') {
    timeline = data.timeline;
  }
  
  res.json({
    case: c,
    evidence: state === 'CREATED' || state === 'FUNDED' ? [] : data.evidence,
    timeline,
    escalated: state === 'ESCALATED'
  });
});

app.get('/rulings/:id', (req, res) => {
  res.json(data.tribunalOutput.ruling);
});

app.get('/rulings/:id/verify', (req, res) => {
  res.json({ verified: true, hashMatch: true });
});

app.post('/demo/run', (req, res) => {
  res.json({ caseId: 'c-104', status: 'DELIBERATING', executionArn: 'arn:mock' });
});

app.get('/bench/summary', (req, res) => {
  res.json({
    flipRate: 0.05,
    agreement85: true,
    escalationRate: 0.65
  });
});

app.listen(4000, () => {
  console.log('Mock API server listening on port 4000');
});
