import { useEffect, useMemo, useRef, useState } from 'react';
import { SourceCodeIcon } from '../../../shared/icons';
import { sendToTab } from '../../../shared/messages';
import { Icon } from '../../components/Icon';
import { useGoogleFont } from '../../lib/google';
import { copyToClipboard } from '../../lib/hooks';

export interface Axis { tag: string; name: string; min: number; max: number; default: number }

const NAMES: Record<string, string> = { wght: 'Weight', wdth: 'Width', opsz: 'Optical size', slnt: 'Slant', ital: 'Italic', GRAD: 'Grade', XHGT: 'x-height', SOFT: 'Softness', WONK: 'Wonky' };

/**
 * Variable font playground. Uses the site's own file when it is variable
 * (and can then apply settings on the page), or the Google Fonts version.
 */
export function PlaygroundCard({ axes, fromFile, fontCss, googleFamily, pageKey, tabId, text, toast }: { axes: Axis[]; fromFile: boolean; fontCss: string; googleFamily: string | null; pageKey: string | null; tabId: number | null; text: string; toast: (m: string) => void }) {
  const gfCss = useGoogleFont(!fromFile ? googleFamily : null, { axes: true });
  const css = fromFile ? fontCss : gfCss;
  const initial = useMemo(() => Object.fromEntries(axes.map((a) => [a.tag, a.default])), [axes]);
  const [vals, setVals] = useState<Record<string, number>>(initial);
  const [live, setLive] = useState(false);
  const timer = useRef<number>();
  useEffect(() => setVals(initial), [initial]);

  const settings = axes.map((a) => `"${a.tag}" ${vals[a.tag] ?? a.default}`).join(', ');
  const canLive = fromFile && !!pageKey && tabId != null;

  useEffect(() => {
    if (!live || !canLive) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      sendToTab(tabId!, { type: 'ffp:vary', key: pageKey!, settings, weight: vals.wght != null ? String(Math.round(vals.wght)) : null });
    }, 60);
  }, [live, canLive, settings, tabId, pageKey, vals.wght]);

  const stopLive = () => {
    setLive(false);
    if (canLive) sendToTab(tabId!, { type: 'ffp:unswap', key: pageKey! });
  };

  if (!axes.length) return null;
  return (
    <section className="section">
      <h2>[Variable playground]</h2>
      <p dir="auto" style={{ margin: 0, fontFamily: css, fontSize: 34, lineHeight: 1.15, fontVariationSettings: settings, overflowWrap: 'anywhere' }}>{text}</p>
      <div className="axes">
        {axes.map((a) => {
          const step = a.max - a.min > 20 ? 1 : 0.1;
          return (
            <label key={a.tag} className="axis">
              <span>{NAMES[a.tag] ?? a.name} <span className="mono muted" style={{ fontSize: 10.5 }}>{a.tag}</span></span>
              <input type="range" min={a.min} max={a.max} step={step} value={vals[a.tag] ?? a.default} onChange={(e) => setVals({ ...vals, [a.tag]: Number(e.target.value) })} />
              <span className="mono" style={{ fontSize: 11.5, textAlign: 'right' }}>{Math.round((vals[a.tag] ?? a.default) * 10) / 10}</span>
            </label>
          );
        })}
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button className="btn sm" onClick={async () => (await copyToClipboard(`font-variation-settings: ${settings};`)) && toast('Copied CSS')}><Icon icon={SourceCodeIcon} size={13} />Copy CSS</button>
        <button className="btn sm ghost" onClick={() => setVals(initial)}>Reset</button>
        {canLive && (live ? <button className="btn sm done" onClick={stopLive}>Showing on page · Stop</button> : <button className="btn sm" onClick={() => setLive(true)}>Apply on page</button>)}
      </div>
      <span className="muted" style={{ fontSize: 11.5 }}>
        {fromFile ? 'Using the font file from this site.' : 'Using the Google Fonts version. The site loads a fixed weight, so these settings cannot be shown on the page.'}
      </span>
    </section>
  );
}
