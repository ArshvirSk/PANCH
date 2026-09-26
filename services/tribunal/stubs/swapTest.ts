import { JudgeInput, JudgeTaskOutput } from '../../shared/step-functions';

export const handler = async (event: JudgeInput): Promise<JudgeTaskOutput> => {
  return {
    judgeName: event.judgeName,
    output: {
      findingsOfFact: [{ fact: "Work delivered on time", evidenceIds: ["e-1"] }],
      clausesRelied: [{ clauseRef: "3.1", interpretation: "Payment upon delivery" }],
      payeeShareBps: 0, // Swap test flipped labels, so we return 0 for claimant (who is now respondent)
      reasoning: "Claimant (swapped) did not deliver.",
      confidence: 0.95,
      uncertainties: []
    },
    isSwapTest: true
  };
};
