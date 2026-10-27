import { useMemo, useState } from 'react';
import { googleFontsUrl } from '../../../shared/catalog';
import { ArrowUpRight01Icon, SourceCodeIcon } from '../../../shared/icons';
import { pairsFor, type Pair } from '../../../shared/similar';
import type { Classification, PageFontUsage } from '../../../shared/types';
import { Icon } from '../../components/Icon';
import { trySwap, undoSwap, useGoogleFont, useSwaps } from '../../lib/google';
import { copyToClipboard } from '../../lib/hooks';
import type { ShapeResult } from '../../lib/shapes';

export function PairsCard({ shape, classification, name, fontCss, exclude, pageKey, pageFonts, tabId, toast }: { shape: ShapeResult | null; classification: Classification; name: string; fontCss: string; exclude: string; pageKey: string | null; pageFonts: PageFontUsage[] | null; tabId: number | null; toast: (m: string) => void }) {
  const swaps = useSwaps(tabId);
  const pairs = useMemo(() => (shape ? pairsFor(shape.shape, classification, { exclude, limit: 4 }) : []), [shape, classification, exclude]);
  if (!shape) return null;
  return (
    <section className="section">
      <h2>[Pairs well with]</h2>
      <div className="matches">
        {pairs.map((p) => {
          // The page font that would take the partner: the other main role on this page.
          const target = pageKey && pageFonts ? partnerTarget(pageFonts, pageKey, p.role) : null;
          return <PairRow key={p.family} p={p} name={name} fontCss={fontCss} target={target} active={!!target && swaps[target.key] === p.family} tabId={tabId} toast={toast} />;
        })}
      </div>
      <span className="muted" style={{ fontSize: 11.5 }}>Suggestions, not rules: a contrasting style, a similar x-height ratio, and well-made, widely used free families.</span>
    </section>
  );
}

/** The page's main font for headings or body text, other than this one. */
function partnerTarget(fonts: PageFontUsage[], ownKey: string, role: Pair['role']): PageFontUsage | null {
  const want = role === 'body' ? 'body' : 'heading';
  const others = fonts.filter((f) => f.key !== ownKey && f.kind !== 'generic' && (f.roles[want] ?? 0) > 0);
  return others.sort((a, b) => (b.roles[want] ?? 0) - (a.roles[want] ?? 0))[0] ?? null;
}

function PairRow({ p, name, fontCss, target, active, tabId, toast }: { p: Pair; name: string; fontCss: string; target: PageFontUsage | null; active: boolean; tabId: number | null; toast: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const tryIt = async () => {
    if (!target || tabId == null) return;
    if (active) {
      await undoSwap(tabId, target.key);
      return;
    }
    setBusy(true);
    try {
      await trySwap(tabId, target.key, p.family, null);
      toast(`Showing ${p.family} for the ${p.role === 'body' ? 'body text' : 'headings'} on the page`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not try it on the page');
    } finally {
      setBusy(false);
    }
  };
  const css = useGoogleFont(p.family);
  const heading = p.role === 'body' ? { css: fontCss, label: name } : { css, label: p.family };
  const body = p.role === 'body' ? { css, label: p.family } : { css: fontCss, label: name };
  const copy = async () => {
    const text = `h1, h2, h3 { font-family: "${heading.label}"; }\nbody { font-family: "${body.label}"; }`;
    if (await copyToClipboard(text)) toast('Copied CSS for the pair');
  };
  return (
    <div className="match">
      <b style={{ fontSize: 13 }}>{heading.label} + {body.label}</b>
      <div className="pairprev">
        <span className="role">Heading · {heading.label}</span>
        <span style={{ fontFamily: heading.css, fontSize: 26, lineHeight: 1.1 }}>A quiet place to read</span>
        <span className="role" style={{ marginTop: 6 }}>Body text · {body.label}</span>
        <span style={{ fontFamily: body.css, fontSize: 14, lineHeight: 1.5 }}>Good type sets a pace, gives the eye somewhere to rest, and lets the words do their work.</span>
      </div>
      <span className="muted" style={{ fontSize: 11.5 }}>{p.reason}</span>
      <div className="row" style={{ gap: 6 }}>
        {target && (
          <button className={`btn sm${active ? ' done' : ''}`} onClick={tryIt} disabled={busy} title={`Shows ${p.family} in place of ${target.displayName || target.family} on the page`}>
            {busy ? 'Loading…' : active ? 'Showing on page · Undo' : `Try on page (replaces ${target.displayName || target.family})`}
          </button>
        )}
        <button className="btn sm" onClick={copy}><Icon icon={SourceCodeIcon} size={13} />Copy CSS</button>
        <a className="btn sm ghost" href={googleFontsUrl(p.family)} target="_blank" rel="noreferrer">{p.family} <Icon icon={ArrowUpRight01Icon} size={13} /></a>
      </div>
    </div>
  );
}
