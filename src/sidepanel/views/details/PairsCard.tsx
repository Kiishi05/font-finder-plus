import { useMemo } from 'react';
import { googleFontsUrl } from '../../../shared/catalog';
import { ArrowUpRight01Icon, SourceCodeIcon } from '../../../shared/icons';
import { pairsFor, type Pair } from '../../../shared/similar';
import type { Classification } from '../../../shared/types';
import { Icon } from '../../components/Icon';
import { useGoogleFont } from '../../lib/google';
import { copyToClipboard } from '../../lib/hooks';
import type { ShapeResult } from '../../lib/shapes';

export function PairsCard({ shape, classification, name, fontCss, exclude, toast }: { shape: ShapeResult | null; classification: Classification; name: string; fontCss: string; exclude: string; toast: (m: string) => void }) {
  const pairs = useMemo(() => (shape ? pairsFor(shape.shape, classification, { exclude, limit: 4 }) : []), [shape, classification, exclude]);
  if (!shape) return null;
  return (
    <section className="section">
      <h2>[Pairs well with]</h2>
      <div className="matches">
        {pairs.map((p) => <PairRow key={p.family} p={p} name={name} fontCss={fontCss} toast={toast} />)}
      </div>
      <span className="muted" style={{ fontSize: 11.5 }}>Suggestions, not rules: a contrasting style, a similar x-height ratio, and well-made, widely used free families.</span>
    </section>
  );
}

function PairRow({ p, name, fontCss, toast }: { p: Pair; name: string; fontCss: string; toast: (m: string) => void }) {
  const css = useGoogleFont(p.family);
  const heading = p.role === 'body' ? { css: fontCss, label: name } : { css, label: p.family };
  const body = p.role === 'body' ? { css, label: p.family } : { css: fontCss, label: name };
  const copy = async () => {
    const text = `h1, h2, h3 { font-family: "${heading.label}"; }\nbody { font-family: "${body.label}"; }`;
    if (await copyToClipboard(text)) toast('Copied CSS for the pair');
  };
  return (
    <div className="match">
      <div className="pairprev">
        <span style={{ fontFamily: heading.css, fontSize: 24, lineHeight: 1.1 }}>A quiet place to read</span>
        <span style={{ fontFamily: body.css, fontSize: 13.5, lineHeight: 1.5 }}>Good type sets a pace, gives the eye somewhere to rest, and lets the words do their work.</span>
      </div>
      <span className="label">Headings {heading.label} · Body {body.label}</span>
      <span className="muted" style={{ fontSize: 11.5 }}>{p.reason}</span>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn sm" onClick={copy}><Icon icon={SourceCodeIcon} size={13} />Copy CSS</button>
        <a className="btn sm ghost" href={googleFontsUrl(p.family)} target="_blank" rel="noreferrer">{p.family} <Icon icon={ArrowUpRight01Icon} size={13} /></a>
      </div>
    </div>
  );
}
