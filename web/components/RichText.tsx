import { Fragment, type ReactNode } from 'react';

/**
 * Model reasoning arrives as loose markdown (the presiding judge writes
 * "**judge-2** ..." and numbered paragraphs). This renders the small subset
 * that occurs, **bold**, `code`, "# " headings and blank-line paragraphs,
 * as React elements only, never as HTML, so hostile text stays inert.
 * Anything else, including an unclosed "**", is shown as written.
 */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /\*\*([^*\n]+)\*\*|`([^`\n]+)`/g;
  let last = 0;
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(m[1] !== undefined ? <strong key={m.index}>{m[1]}</strong> : <code key={m.index}>{m[2]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function RichText({ text, className }: { text: string; className?: string }) {
  const paragraphs = text.replace(/\r\n/g, '\n').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return (
    <div className={className} data-testid="rich-text">
      {paragraphs.map((paragraph, i) => {
        const heading = /^#{1,6}\s+(.*)$/s.exec(paragraph);
        if (heading) return <p key={i}><strong>{inline(heading[1])}</strong></p>;
        const lines = paragraph.split('\n');
        return (
          <p key={i}>
            {lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(line.replace(/^#{1,6}\s+/, ''))}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
