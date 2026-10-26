import { useEffect, useState } from 'react';
import { googleFontsUrl } from '../../../shared/catalog';
import { ArrowUpRight01Icon } from '../../../shared/icons';
import { similarTo, type Match } from '../../../shared/similar';
import type { Classification } from '../../../shared/types';
import { Icon } from '../../components/Icon';
import { trySwap, undoSwap, useGoogleFont, useSwaps } from '../../lib/google';
import type { ShapeResult } from '../../lib/shapes';

interface Props {
  shape: ShapeResult | null;
  loading: boolean;
  exclude: string;
  classification: Classification;
  /** The font's key on the current page, when it is on the page (enables "Try on page"). */
  pageKey: string | null;
  tabId: number | null;
  sampleText: string;
  toast: (m: string) => void;
}

export function SimilarCard({ shape, loading, exclude, classification, pageKey, tabId, sampleText, toast }: Props) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [matchX, setMatchX] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const swaps = useSwaps(tabId);
  const current = pageKey ? swaps[pageKey] ?? null : null;

  useEffect(() => {
    setMatches(shape ? similarTo(shape.shape, { exclude, classification, limit: 6, ignoreWeight: shape.notRegular }) : []);
  }, [shape, exclude, classification]);

  const tryIt = async (family: string) => {
    if (tabId == null || !pageKey || !shape) return;
    setBusy(family);
    try {
      const n = await trySwap(tabId, pageKey, family, matchX ? shape.shape.x : null);
      toast(n ? `Showing ${family} on the page` : 'This font is not on the page right now');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not try this font on the page');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="section">
      <h2>[Similar free fonts] Closest matches</h2>
      {loading && !shape && <span className="muted" style={{ fontSize: 12 }}>Measuring the font…</span>}
      {!loading && !shape && <span className="muted" style={{ fontSize: 12 }}>The font could not be measured, so similar fonts cannot be found. This happens when its file cannot be read.</span>}
      {shape && (
        <>
          {pageKey && (
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <label className="row" style={{ gap: 6, fontSize: 12.5 }}>
                <input type="checkbox" checked={matchX} onChange={(e) => setMatchX(e.target.checked)} />
                Keep the original x-height when trying
              </label>
              {current && tabId != null && <button className="btn sm" onClick={() => undoSwap(tabId, pageKey)}>Undo</button>}
            </div>
          )}
          <div className="matches">
            {matches.map((m) => (
              <MatchRow key={m.family} m={m} text={sampleText} active={current === m.family} busy={busy === m.family} canTry={!!pageKey && tabId != null} onTry={() => (current === m.family && tabId != null && pageKey ? undoSwap(tabId, pageKey) : tryIt(m.family))} />
            ))}
          </div>
          <span className="muted" style={{ fontSize: 11.5 }}>
            Free fonts from Google Fonts, ranked by measured proportions: x-height, width, weight, contrast and roundness.
            {shape.from === 'rendered' ? ' Weight and contrast could not be measured for an installed font.' : ''}
            {shape.notRegular ? ' Measured from a non-regular weight, so weight counts for less.' : ''}
            {' '}Similar is not identical; check details like the shapes of a, g and R.
          </span>
        </>
      )}
    </section>
  );
}

function MatchRow({ m, text, active, busy, canTry, onTry }: { m: Match; text: string; active: boolean; busy: boolean; canTry: boolean; onTry: () => void }) {
  const css = useGoogleFont(m.family);
  return (
    <div className={`match${active ? ' on' : ''}`}>
      <div className="row" style={{ alignItems: 'baseline' }}>
        <b className="grow" style={{ fontSize: 12.5 }}>{m.family}</b>
        <span className="mono" style={{ fontSize: 11.5 }}>{m.score}%</span>
      </div>
      <div className="mprev" dir="auto" style={{ fontFamily: css }}>{text || m.family}</div>
      <span className="muted" style={{ fontSize: 11.5 }}>{m.reason}</span>
      <div className="row" style={{ gap: 6 }}>
        {canTry && (
          <button className={`btn sm${active ? ' done' : ''}`} onClick={onTry} disabled={busy}>
            {busy ? 'Loading…' : active ? 'Showing on page · Undo' : 'Try on page'}
          </button>
        )}
        <a className="btn sm ghost" href={googleFontsUrl(m.family)} target="_blank" rel="noreferrer">Google Fonts <Icon icon={ArrowUpRight01Icon} size={13} /></a>
      </div>
    </div>
  );
}
