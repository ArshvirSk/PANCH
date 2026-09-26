import { Icon } from './Icon';

const JUDGES = [
  { name: 'Judge I', before: 100, after: 100 },
  { name: 'Judge II', before: 80, after: 100 },
  { name: 'Judge III', before: 100, after: 100 },
];

/** Hero illustration: how a panel converges on an award. Figures mirror the sample case c-104. */
export function RulingPreview() {
  return (
    <figure className="preview" aria-label="Illustrative example of a Panch panel ruling">
      <div className="preview-head">
        <span className="preview-case">
          <Icon name="scale" size={16} />
          Case c-104 · Non-payment
        </span>
        <span className="preview-tag">Example</span>
      </div>

      <p className="preview-section">Panel after cross-examination</p>
      <ul className="preview-judges">
        {JUDGES.map((j) => (
          <li key={j.name}>
            <span className="preview-judge">{j.name}</span>
            <span className="preview-bar" aria-hidden="true">
              <span style={{ width: `${j.after}%` }} />
            </span>
            <span className="preview-value">
              {j.before !== j.after && <s>{j.before}%</s>} {j.after}%
            </span>
          </li>
        ))}
      </ul>

      <div className="preview-checks">
        <span><Icon name="eye-off" size={14} /> Blind</span>
        <span><Icon name="shuffle" size={14} /> Swap test consistent</span>
        <span><Icon name="check" size={14} /> Spread 0 bps</span>
      </div>

      <div className="preview-award">
        <div>
          <p className="preview-label">Award to claimant</p>
          <p className="preview-big">$400.00</p>
        </div>
        <div className="preview-seal" aria-hidden="true">
          <Icon name="gavel" size={22} />
        </div>
      </div>

      <p className="preview-hash">
        <Icon name="hash" size={13} /> sha256 9f2c 81d0 … 7be4 a41e
      </p>
      <figcaption className="sr-only">Three judges converge on a full award after one judge accepts a critique during cross-examination.</figcaption>
    </figure>
  );
}
