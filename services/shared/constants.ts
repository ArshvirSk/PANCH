export const SSM_PARAMETERS = {
  JUDGE_1: '/panch/models/judge-1',
  JUDGE_2: '/panch/models/judge-2',
  JUDGE_3: '/panch/models/judge-3',
  PRESIDING: '/panch/models/presiding',
  JUDGE_1_MODE: '/panch/models/judge-1-mode',
  JUDGE_2_MODE: '/panch/models/judge-2-mode',
  JUDGE_3_MODE: '/panch/models/judge-3-mode',
  PRESIDING_MODE: '/panch/models/presiding-mode',
  SPREAD_THRESHOLD_BPS: '/panch/config/spread-threshold-bps',
  MAX_CROSSEXAM_ROUNDS: '/panch/config/max-crossexam-rounds'
};

export const S3_KEY_BUILDERS = {
  evidenceRaw: (caseId: string, evidenceId: string) => `panch-evidence/${caseId}/${evidenceId}`,
  evidenceExtracted: (caseId: string, evidenceId: string) => `panch-evidence/${caseId}/extracted/${evidenceId}.txt`,
  rulingMarkdown: (caseId: string) => `panch-rulings/${caseId}/ruling.md`,
  rulingJson: (caseId: string) => `panch-rulings/${caseId}/ruling.json`,
  benchCase: (benchId: string, filename: string) => `panch-benchmark/${benchId}/${filename}`
};
