import { JudgeInput, JudgeTaskOutput } from '../../shared/step-functions';

export const handler = async (event: JudgeInput): Promise<JudgeTaskOutput> => {
  return {
    judgeName: 'judge-2',
    output: {
      findingsOfFact: [{ fact: "Work delivered on time", evidenceIds: ["e-1"] }],
      clausesRelied: [{ clauseRef: "3.1", interpretation: "Payment upon delivery" }],
      payeeShareBps: 10000,
      reasoning: "Claimant fulfilled the contract.",
      confidence: 0.95,
      uncertainties: []
    },
    isSwapTest: event.isSwapTest
  };
};
