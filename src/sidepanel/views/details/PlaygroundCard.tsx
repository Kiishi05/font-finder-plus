import { useEffect, useMemo, useRef, useState } from 'react';
import { SourceCodeIcon, Target02Icon } from '../../../shared/icons';
import { sendToTab } from '../../../shared/messages';
import { Icon } from '../../components/Icon';
import { useGoogleFont } from '../../lib/google';
import { CopyButton } from './CopyButton';

export interface Axis { tag: string; name: string; min: number; max: number; default: number }

const NAMES: Record<string, string> = { wght: 'Weight', wdth: 'Width', opsz: 'Optical size', slnt: 'Slant', ital: 'Italic', GRAD: 'Grade', XHGT: 'x-height', SOFT: 'Softness', WONK: 'Wonky' };

/**
 * Variable font playground. Uses the site's own file when it is variable
 * (and can then apply settings on the page), or the Google Fonts version.
 */
export function PlaygroundCard({ id, axes, fromFile, fontCss, googleFamily, pageKey, tabId, text, toast }: { id?: string; axes: Axis[]; fromFile: boolean; fontCss: string; googleFamily: string | null; pageKey: string | null; tabId: number | null; text: string; toast: (m: string) => void }) {
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
    <section className="section" id={id}>
      <div className="sechead"><h2>Variable</h2><span className="count">{axes.length} {axes.length === 1 ? 'axis' : 'axes'}</span></div>
      <p className="dplay" dir="auto" style={{ fontFamily: css, fontVariationSettings: settings }}>{text}</p>
      <div className="axes">
        {axes.map((a) => {
          const step = a.max - a.min > 20 ? 1 : 0.1;
          return (
            <label key={a.tag} className="axis">
              <span>{NAMES[a.tag] ?? a.name} <span className="faint mono" style={{ fontSize: 11 }}>{a.tag}</span></span>
              <input type="range" min={a.min} max={a.max} step={step} value={vals[a.tag] ?? a.default} onChange={(e) => setVals({ ...vals, [a.tag]: Number(e.target.value) })} />
              <span style={{ fontSize: 12.5, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Math.round((vals[a.tag] ?? a.default) * 10) / 10}</span>
            </label>
          );
        })}
      </div>
      <div className="dfoot">
        {canLive && (
          <button className={`btn sm${live ? ' primary' : ''}`} aria-pressed={live} onClick={() => (live ? stopLive() : setLive(true))}>
            <Icon icon={Target02Icon} size={15} />{live ? 'Showing on page' : 'Apply on page'}
          </button>
        )}
        <CopyButton className="btn sm" icon={SourceCodeIcon} label="Copy CSS" text={`font-variation-settings: ${settings};`} onFail={() => toast('Could not copy')} />
        <button className="linkbtn" onClick={() => setVals(initial)}>Reset</button>
      </div>
      <p className="dnote">
        {fromFile ? 'Using the font file from this site.' : 'Using the Google Fonts version. The site loads a fixed weight, so these settings cannot be shown on the page.'}
      </p>
    </section>
  );
}
