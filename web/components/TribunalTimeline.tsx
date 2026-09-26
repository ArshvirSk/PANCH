import type { TimelineStage } from '../lib/types';
import { Icon, type IconName } from './Icon';

const STAGES: { stage: TimelineStage; label: string; detail: string; icon: IconName }[] = [
  { stage: 'INTAKE', label: 'Evidence intake', detail: 'Text extracted, files fingerprinted, injection screening', icon: 'file' },
  { stage: 'BLIND', label: 'Identities blinded', detail: 'Names and countries become Claimant and Respondent', icon: 'eye-off' },
  { stage: 'JUDGES', label: 'Independent rulings', detail: 'Three judges from different model families rule alone', icon: 'users' },
  { stage: 'CROSS_EXAM', label: 'Cross-examination', detail: 'Each judge critiques the others and may revise', icon: 'message' },
  { stage: 'SWAP_TEST', label: 'Swap test', detail: 'Parties swapped to check the outcome does not flip', icon: 'shuffle' },
  { stage: 'AGGREGATE', label: 'Panel aggregated', detail: 'Median award and judge spread computed', icon: 'scale' },
  { stage: 'PRESIDING', label: 'Presiding judge', detail: 'Reasoned ruling written, every finding cited', icon: 'gavel' },
  { stage: 'PUBLISH', label: 'Ruling published', detail: 'Stored with a SHA-256 hash for verification', icon: 'hash' },
  { stage: 'SETTLE', label: 'Escrow settled', detail: 'Funds released per the award', icon: 'wallet' },
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
            <span className="timeline-marker" aria-hidden="true">
              <Icon name={state === 'done' ? 'check' : s.icon} size={15} />
            </span>
            <span className="timeline-text">
              <span className="timeline-label">
                {s.label}
                {state === 'current' && <span className="timeline-live">In progress</span>}
                <span className="sr-only">{state === 'done' ? ' (complete)' : ''}</span>
              </span>
              <span className="timeline-detail">{s.detail}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
