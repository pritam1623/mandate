/* Tiny, safe Markdown renderer for agent replies: paragraphs, lists, **bold**, *italic*, `code`.
   Builds React elements only (no innerHTML), so model output can never inject HTML. */
import { Fragment } from "react";

function inline(text: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${i++}`;
    if (t.startsWith("**")) out.push(<strong key={k} className="font-semibold text-ink">{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k} className="rounded-md bg-line-2 px-1 py-0.5 font-mono text-[0.85em]">{t.slice(1, -1)}</code>);
    else out.push(<em key={k}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function Markdown({ text, className = "" }: { text: string; className?: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  let i = 0;
  let b = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const ul = /^\s*[-*•]\s+/;
    const ol = /^\s*\d+[.)]\s+/;
    if (ul.test(line) || ol.test(line)) {
      const ordered = ol.test(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? ol : ul).test(lines[i])) {
        items.push(lines[i].replace(ordered ? ol : ul, ""));
        i++;
      }
      const Tag = ordered ? "ol" : "ul";
      blocks.push(
        <Tag key={b} className={`${ordered ? "list-decimal" : "list-disc"} space-y-1 pl-5 marker:text-faint`}>
          {items.map((it, j) => <li key={j}>{inline(it, `${b}-${j}`)}</li>)}
        </Tag>,
      );
    } else if (/^#{1,6}\s/.test(line)) {
      blocks.push(<p key={b} className="font-semibold text-ink">{inline(line.replace(/^#{1,6}\s/, ""), String(b))}</p>);
      i++;
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i].trim() && !ul.test(lines[i]) && !ol.test(lines[i])) { para.push(lines[i]); i++; }
      blocks.push(
        <p key={b}>
          {para.map((p, j) => <Fragment key={j}>{j > 0 && <br />}{inline(p, `${b}-${j}`)}</Fragment>)}
        </p>,
      );
    }
    b++;
  }
  return <div className={`space-y-3 ${className}`}>{blocks}</div>;
}
