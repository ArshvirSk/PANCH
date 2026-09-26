import type { TimelineStage } from '../lib/types';

const STAGES: { stage: TimelineStage; label: string }[] = [
  { stage: 'INTAKE', label: 'Evidence intake' },
  { stage: 'BLIND', label: 'Identities blinded' },
  { stage: 'JUDGES', label: 'Three judges rule independently' },
  { stage: 'CROSS_EXAM', label: 'Cross-examination' },
  { stage: 'SWAP_TEST', label: 'Swap test for bias' },
  { stage: 'AGGREGATE', label: 'Panel aggregated' },
  { stage: 'PRESIDING', label: 'Presiding judge writes ruling' },
  { stage: 'PUBLISH', label: 'Ruling published' },
  { stage: 'SETTLE', label: 'Escrow settled' },
];

/** Live tribunal progress (PRD F9). `completed` lists stages the workflow has reported. */
export function TribunalTimeline({ completed, active }: { completed: TimelineStage[]; active: boolean }) {
  const done = new Set(completed);
  const nextIndex = STAGES.findIndex((s) => !done.has(s.stage));
  return (
    <ol className="timeline" aria-label="Tribunal progress" data-testid="tribunal-timeline">
      {STAGES.map((s, i) => {
        const state = done.has(s.stage) ? 'done' : active && i === nextIndex ? 'current' : 'upcoming';
        return (
          <li key={s.stage} className={`timeline-item timeline-${state}`}>
            <span className="timeline-dot" aria-hidden="true" />
            <span>{s.label}</span>
            {state === 'current' && <span className="muted small"> · in progress</span>}
          </li>
        );
      })}
    </ol>
  );
}
