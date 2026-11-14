import { useEffect, useState } from 'react';
import { freeSourceOf } from '../../../shared/catalog';
import { ArrowDown01Icon, ArrowUpRight01Icon, Target02Icon } from '../../../shared/icons';
import type { Match } from '../../../shared/similar';
import { freeLookalikes, type LookalikeInput, type LookalikeResult } from '../../lib/lookalike';
import type { Classification } from '../../../shared/types';
import { Icon } from '../../components/Icon';
import { trySwap, undoSwap, useGoogleFont, useSwaps } from '../../lib/google';
import type { ShapeResult } from '../../lib/shapes';

interface Props {
  id?: string;
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

const FIRST = 3;

export function SimilarCard({ id, shape, loading, pageKey, tabId, input, sampleText, toast }: Props) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [matchX, setMatchX] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [all, setAll] = useState(false);
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

  const shown = all ? matches : matches.slice(0, FIRST);
  return (
    <section className="section" id={id}>
      <div className="sechead"><h2>Similar free fonts</h2>{matches.length > 0 && <span className="count">{matches.length}</span>}</div>
      {loading && !shape && <p className="sub">Measuring the font…</p>}
      {shape && letters === undefined && <p className="sub">Comparing letter shapes…</p>}
      {letters === false && <p className="sub">Compared by proportions only (its letters could not be drawn), so these are rougher.</p>}
      {!loading && !shape && <p className="sub">The font could not be measured, so similar fonts cannot be found. This happens when its file cannot be read.</p>}
      {shape && (
        <>
          {pageKey && (
            <div className="dopt">
              <span className="grow">Keep the original x-height when trying</span>
              {current && tabId != null && <button className="linkbtn" onClick={() => undoSwap(tabId, pageKey)}>Undo</button>}
              <button className="switch" role="switch" aria-checked={matchX} aria-label="Keep the original x-height when trying" onClick={() => setMatchX(!matchX)} />
            </div>
          )}
          {shown.length > 0 && (
            <div className="dinners">
              {shown.map((m) => (
                <MatchRow key={m.family} m={m} text={sampleText} active={current === m.family} busy={busy === m.family} canTry={!!pageKey && tabId != null} onTry={() => (current === m.family && tabId != null && pageKey ? undoSwap(tabId, pageKey) : tryIt(m.family))} />
              ))}
            </div>
          )}
          {matches.length > FIRST && (
            <button className="linkbtn dmore" aria-expanded={all} onClick={() => setAll(!all)}>
              {all ? 'Show fewer' : `Show all ${matches.length}`} <Icon icon={ArrowDown01Icon} size={14} className={all ? 'flip' : undefined} />
            </button>
          )}
          <p className="dnote">
            Free fonts from Google Fonts and Fontshare, ranked by how alike their letters look and by measured proportions (x-height, width, weight, contrast).
            {shape.from === 'page' ? ' The font file could not be read, so the font was measured from how the page draws it.' : ''}
            {shape.from === 'rendered' ? ' Measured from how the installed font draws.' : ''}
            {shape.notRegular ? ' Measured from a non-regular weight, so weight counts for less.' : ''}
            {' '}Similar is not identical; check details like the shapes of a, g and R.
          </p>
        </>
      )}
    </section>
  );
}

function MatchRow({ m, text, active, busy, canTry, onTry }: { m: Match; text: string; active: boolean; busy: boolean; canTry: boolean; onTry: () => void }) {
  const css = useGoogleFont(m.family);
  const src = freeSourceOf(m.family);
  return (
    <div className={`match dinner${active ? ' on' : ''}`}>
      <div className="row">
        <b>{m.family}</b>
        <span className="lic free"><i />Free</span>
        <span className="grow" />
        <span className="pct">{m.score}% alike</span>
      </div>
      <div className="mprev" dir="auto" style={{ fontFamily: css }}>{text || m.family}</div>
      <span className="why">{m.reason}</span>
      <div className="btns">
        {canTry && (
          <button className={`btn sm${active ? ' primary' : ''}`} aria-pressed={active} onClick={onTry} disabled={busy}>
            <Icon icon={Target02Icon} size={15} />
            {busy ? 'Loading…' : active ? 'Showing on page' : 'Try on page'}
          </button>
        )}
        <a className="linkbtn" href={src.url} target="_blank" rel="noreferrer">{src.site} <Icon icon={ArrowUpRight01Icon} size={13} /></a>
      </div>
    </div>
  );
}
