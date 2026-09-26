import type { ReactNode } from 'react';

export function PageHeader({ eyebrow, title, description, actions, back }: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <div className="page-header">
      {back && <div className="page-back">{back}</div>}
      <div className="page-header-row">
        <div className="page-header-text">
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h1>{title}</h1>
          {description && <div className="page-description">{description}</div>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
    </div>
  );
}
