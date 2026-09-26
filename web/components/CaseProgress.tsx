import { stepState, stepsFor } from '../lib/caseLogic';
import type { Status } from '../lib/types';

export function CaseProgress({ status }: { status: Status }) {
  const steps = stepsFor(status);
  return (
    <ol className="progress" aria-label="Case progress">
      {steps.map((step, index) => {
        const state = stepState(steps, status, index);
        return (
          <li key={step.status} className={`progress-step progress-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="progress-dot" aria-hidden="true">{state === 'done' ? '✓' : index + 1}</span>
            <span className="progress-label">{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
