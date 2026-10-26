import { useMemo, useState } from 'react';
import { Copy01Icon, Search01Icon } from '../../../shared/icons';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { copyToClipboard } from '../../lib/hooks';
import { blockOf, hex, isCombining, isDrawable } from '../../lib/unicode';

const PAGE = 240;

export function GlyphsCard({ codepoints, fontCss, note, toast }: { codepoints: Set<number> | null; fontCss: string; note: string; toast: (m: string) => void }) {
  const [block, setBlock] = useState('all');
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [sel, setSel] = useState<number | null>(null);

  const list = useMemo(() => [...(codepoints ?? [])].filter(isDrawable).sort((a, b) => a - b), [codepoints]);
  const blocks = useMemo(() => {
    const m = new Map<string, number>();
    for (const cp of list) m.set(blockOf(cp), (m.get(blockOf(cp)) ?? 0) + 1);
    return [...m.entries()];
  }, [list]);

  const filtered = useMemo(() => {
    const q = query.trim();
    let out = block === 'all' ? list : list.filter((cp) => blockOf(cp) === block);
    if (q) {
      const m = /^(?:u\+|0x)?([0-9a-f]{2,6})$/i.exec(q);
      const asHex = m ? parseInt(m[1], 16) : null;
      const chars = new Set([...q].map((c) => c.codePointAt(0)!));
      out = out.filter((cp) => chars.has(cp) || cp === asHex);
    }
    return out;
  }, [list, block, query]);

  if (!codepoints) {
    return (
      <section className="section">
        <h2>[Glyphs]</h2>
        <span className="muted" style={{ fontSize: 12 }}>{note}</span>
      </section>
    );
  }

  const ch = (cp: number) => (isCombining(cp) ? '◌' : '') + String.fromCodePoint(cp);
  return (
    <section className="section">
      <h2>[Glyphs] {list.length} characters</h2>
      <div className="row" style={{ gap: 6 }}>
        <label className="tester-input grow" style={{ height: 34, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 9 }}>
          <Icon icon={Search01Icon} size={14} />
          <input aria-label="Find a character" placeholder="Type a letter or U+00E9" value={query} onChange={(e) => { setQuery(e.target.value); setShown(PAGE); }} />
        </label>
        <div style={{ width: 150 }}>
          <Select label="Character group" value={block} onChange={(v) => { setBlock(v); setShown(PAGE); }} options={[{ value: 'all', label: `All (${list.length})` }, ...blocks.map(([b, n]) => ({ value: b, label: `${b} (${n})` }))]} />
        </div>
      </div>
      {sel != null && (
        <div className="glyphsel">
          <span className="big" style={{ fontFamily: fontCss }}>{ch(sel)}</span>
          <div className="stack" style={{ gap: 4, minWidth: 0 }}>
            <b className="mono" style={{ fontSize: 13 }}>U+{hex(sel)}</b>
            <span className="muted" style={{ fontSize: 11.5 }}>{blockOf(sel)}</span>
            <div className="chips">
              <button className="chip" onClick={async () => (await copyToClipboard(String.fromCodePoint(sel))) && toast('Copied character')}><Icon icon={Copy01Icon} size={12} />Character</button>
              <button className="chip" onClick={async () => (await copyToClipboard(`\\${hex(sel)}`)) && toast('Copied CSS code')}>CSS \{hex(sel)}</button>
              <button className="chip" onClick={async () => (await copyToClipboard(`&#x${hex(sel)};`)) && toast('Copied HTML code')}>HTML &amp;#x{hex(sel)};</button>
            </div>
          </div>
        </div>
      )}
      <div className="glyphs" style={{ fontFamily: fontCss }}>
        {filtered.slice(0, shown).map((cp) => (
          <button key={cp} className={sel === cp ? 'on' : ''} title={`U+${hex(cp)}`} onClick={() => setSel(cp)}>{ch(cp)}</button>
        ))}
      </div>
      {filtered.length === 0 && <span className="muted" style={{ fontSize: 12 }}>No matching characters in this font.</span>}
      {filtered.length > shown && <button className="btn sm" onClick={() => setShown(shown + PAGE * 2)}>Show more ({filtered.length - shown} left)</button>}
      <span className="muted" style={{ fontSize: 11.5 }}>{note}</span>
    </section>
  );
}
