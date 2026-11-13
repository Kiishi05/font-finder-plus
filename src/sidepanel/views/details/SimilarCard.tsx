import { useEffect, useState } from 'react';
import { freeSourceOf } from '../../../shared/catalog';
import { ArrowUpRight01Icon } from '../../../shared/icons';
import type { Match } from '../../../shared/similar';
import { freeLookalikes, type LookalikeInput, type LookalikeResult } from '../../lib/lookalike';
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
  /** The font, for the shared look-alike calculation. */
  input: LookalikeInput | null;
  sampleText: string;
  toast: (m: string) => void;
}

export function SimilarCard({ shape, loading, pageKey, tabId, input, sampleText, toast }: Props) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [matchX, setMatchX] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const swaps = useSwaps(tabId);
  const current = pageKey ? swaps[pageKey] ?? null : null;

  // The same calculation as Make it free and Send to Figma, so they always agree.
  const [result, setResult] = useState<LookalikeResult | null | undefined>(undefined);
  const inputKey = input ? JSON.stringify([input.fontId, input.weight, input.style, input.onPage, input.files.length]) : '';
  useEffect(() => {
    if (!input) return setResult(null);
    setResult(undefined);
    let live = true;
    freeLookalikes(input, tabId).then((r) => live && setResult(r));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputKey, tabId]);
  useEffect(() => setMatches(result?.matches.slice(0, 6) ?? []), [result]);
  const letters = result === undefined ? undefined : result?.letters ?? null;
  const x = result?.x ?? shape?.shape.x ?? null;

  const tryIt = async (family: string) => {
    if (tabId == null || !pageKey || !shape) return;
    setBusy(family);
    try {
      const n = await trySwap(tabId, pageKey, family, matchX ? x : null);
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
      {shape && letters === undefined && <span className="muted" style={{ fontSize: 12 }}>Comparing letter shapes…</span>}
      {letters === false && <span className="muted" style={{ fontSize: 11.5 }}>Compared by proportions only (its letters could not be drawn), so these are rougher.</span>}
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
            Free fonts from Google Fonts and Fontshare, ranked by how alike their letters look and by measured proportions (x-height, width, weight, contrast).
            {shape.from === 'page' ? ' The font file could not be read, so the font was measured from how the page draws it.' : ''}
            {shape.from === 'rendered' ? ' Measured from how the installed font draws.' : ''}
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
        <a className="btn sm ghost" href={freeSourceOf(m.family).url} target="_blank" rel="noreferrer">{freeSourceOf(m.family).site} <Icon icon={ArrowUpRight01Icon} size={13} /></a>
      </div>
    </div>
  );
}
