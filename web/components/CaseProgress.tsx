import { stepState, stepsFor } from '../lib/caseLogic';
import type { Status } from '../lib/types';
import { Icon } from './Icon';

export function CaseProgress({ status }: { status: Status }) {
  const steps = stepsFor(status);
  return (
    <ol className="stepper" aria-label="Case progress">
      {steps.map((step, index) => {
        const state = stepState(steps, status, index);
        return (
          <li
            key={step.status}
            className={`stepper-step stepper-${state}`}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span className="stepper-marker" aria-hidden="true">
              {state === 'done' ? <Icon name="check" size={14} /> : index + 1}
            </span>
            <span className="stepper-label">
              {step.label}
              <span className="sr-only">{state === 'done' ? ' (complete)' : state === 'current' ? ' (current)' : ''}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
