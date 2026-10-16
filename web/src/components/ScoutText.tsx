import type { ReactNode } from 'react';

function inline(line: string): ReactNode[] {
  return line.split(/\*\*([^*]+)\*\*/).map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part));
}

/** Markdown-lite: **bold**, "- " bullets, newlines. Pure React elements, never HTML. */
export default function ScoutText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let items: string[] = [];
  const flush = () => {
    if (!items.length) return;
    const list = items;
    items = [];
    blocks.push(<ul key={`u${blocks.length}`}>{list.map((it, i) => <li key={i}>{inline(it)}</li>)}</ul>);
  };
  for (const raw of text.split(/\r?\n/)) {
    if (raw.startsWith('- ')) {
      items.push(raw.slice(2));
      continue;
    }
    flush();
    if (raw.trim()) blocks.push(<p key={`p${blocks.length}`}>{inline(raw)}</p>);
  }
  flush();
  return <div className="scout-text">{blocks}</div>;
}
