import { expect, test } from 'vitest';
import { judgeOutputSchema } from './schemas';

test('judgeOutputSchema valid input', () => {
  const valid = {
    findingsOfFact: [{ fact: 'A fact', evidenceIds: ['e-1'] }],
    clausesRelied: [{ clauseRef: '2.1', interpretation: 'Means this' }],
    payeeShareBps: 10000,
    reasoning: 'Because yes',
    confidence: 0.95,
    uncertainties: ['none']
  };
  expect(() => judgeOutputSchema.parse(valid)).not.toThrow();
});

test('judgeOutputSchema invalid input', () => {
  const invalid = {
    findingsOfFact: [],
    clausesRelied: [],
    payeeShareBps: 20000, // Invalid, max 10000
    reasoning: '',
    confidence: 1.5, // Invalid, max 1
    uncertainties: []
  };
  expect(() => judgeOutputSchema.parse(invalid)).toThrow();
});
