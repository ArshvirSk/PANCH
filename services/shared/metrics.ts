/**
 * Minimal CloudWatch EMF emitter (no aws-embedded-metrics dependency).
 * A Lambda stdout line shaped per the CloudWatch Embedded Metric Format
 * becomes a real metric with dimensions; dimension keys must also appear as
 * top-level fields in the same JSON object.
 */
const NAMESPACE = 'Panch';

export function emitMetric(
  name: string,
  value: number,
  unit: 'Count' | 'None' | 'Milliseconds',
  dimensions: Record<string, string> = {}
): void {
  const entry: Record<string, unknown> = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: NAMESPACE,
          Dimensions: [Object.keys(dimensions)],
          Metrics: [{ Name: name, Unit: unit }],
        },
      ],
    },
    ...dimensions,
    [name]: value,
  };
  // One JSON object per console.log line is the EMF contract.
  console.log(JSON.stringify(entry));
}

/** Stage-duration timer around async work; emits one Milliseconds metric. */
export async function timed<T>(
  stage: string,
  caseId: string,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    emitMetric('StageDuration', Date.now() - start, 'Milliseconds', { Stage: stage, CaseId: caseId });
  }
}
