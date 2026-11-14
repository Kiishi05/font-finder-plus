import { useMemo, useState } from 'react';
import { googleFontsUrl } from '../../../shared/catalog';
import { ArrowUpRight01Icon, SourceCodeIcon, Target02Icon } from '../../../shared/icons';
import { pairsFor, type Pair } from '../../../shared/similar';
import type { Classification, PageFontUsage } from '../../../shared/types';
import { Icon } from '../../components/Icon';
import { trySwap, undoSwap, useGoogleFont, useSwaps } from '../../lib/google';
import type { ShapeResult } from '../../lib/shapes';
import { CopyButton } from './CopyButton';

export function PairsCard({ id, shape, loading, classification, name, fontCss, exclude, pageKey, pageFonts, tabId, toast }: { id?: string; shape: ShapeResult | null; loading?: boolean; classification: Classification; name: string; fontCss: string; exclude: string; pageKey: string | null; pageFonts: PageFontUsage[] | null; tabId: number | null; toast: (m: string) => void }) {
  const swaps = useSwaps(tabId);
  const pairs = useMemo(() => (shape ? pairsFor(shape.shape, classification, { exclude, limit: 4 }) : []), [shape, classification, exclude]);
  // Every partner for one font has the same role: a heading font, or a body font.
  const forBody = pairs[0]?.role === 'body';
  return (
    <section className="section" id={id}>
      <div className="dpairhead">
        <div className="sechead"><h2>{forBody ? 'Pair with a body font' : 'Pair with a heading font'}</h2>{pairs.length > 0 && <span className="count">{pairs.length}</span>}</div>
        {pairs.length > 0 && <p className="sub">Shown with {name} as the {forBody ? 'headings' : 'body text'}.</p>}
      </div>
      {!shape && <p className="sub">{loading ? 'Measuring the font…' : 'The font could not be measured, so pairs cannot be suggested.'}</p>}
      {shape && !pairs.length && <p className="sub">No pairs to suggest for this font.</p>}
      {pairs.length > 0 && (
        <div className="dinners">
          {pairs.map((p) => {
            // The page font that would take the partner: the other main role on this page.
            const target = pageKey && pageFonts ? partnerTarget(pageFonts, pageKey, p.role) : null;
            return <PairRow key={p.family} p={p} name={name} fontCss={fontCss} target={target} active={!!target && swaps[target.key] === p.family} tabId={tabId} toast={toast} />;
          })}
        </div>
      )}
      {pairs.length > 0 && <p className="dnote">Suggestions, not rules: a contrasting style, a similar x-height ratio, and well-made, widely used free families.</p>}
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
  const pairCss = `h1, h2, h3 { font-family: "${heading.label}"; }\nbody { font-family: "${body.label}"; }`;
  return (
    <div className="dinner dpair" title={p.reason}>
      <div className="nm"><b>{p.family}</b><span className="faint">for {p.role === 'body' ? 'body text' : 'headings'}</span></div>
      <div className="hd" style={{ fontFamily: heading.css }}>A quiet place to read</div>
      <div className="bd" style={{ fontFamily: body.css }}>Good type rarely announces itself. It sets a pace, gives the eye somewhere to rest, and lets the words do their work.</div>
      <div className="btns">
        {target && (
          <button className={`btn sm${active ? ' primary' : ''}`} aria-pressed={active} onClick={tryIt} disabled={busy} title={`Shows ${p.family} in place of ${target.displayName || target.family} on the page`}>
            <Icon icon={Target02Icon} size={15} />
            {busy ? 'Loading…' : active ? 'Showing on page' : 'Try on page'}
          </button>
        )}
        <a className="linkbtn" href={googleFontsUrl(p.family)} target="_blank" rel="noreferrer">Google Fonts <Icon icon={ArrowUpRight01Icon} size={13} /></a>
        <span className="grow" />
        <CopyButton className="iconbtn sm" icon={SourceCodeIcon} ariaLabel="Copy CSS for the pair" tip="Copy CSS" text={pairCss} />
      </div>
    </div>
  );
}
