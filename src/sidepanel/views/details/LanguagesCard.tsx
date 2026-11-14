import { useMemo, useState } from 'react';
import { checkPacks, type PackResult } from '../../../shared/languages';
import { ArrowDown01Icon } from '../../../shared/icons';
import { Icon } from '../../components/Icon';
import { languageSample } from '../../lib/samples';
import type { Coverage } from '../../lib/coverage';

const FIRST = 6;

const FROM: Record<Coverage['from'], string> = {
  google: 'Checked against the full family on Google Fonts.',
  files: 'Checked against the font files this site loads. Other versions of this font may have more characters.',
  installed: 'Checked against the copy installed on this computer.',
};

/** Which languages the font can write, inside the Letters and languages card. Tap a language to see a sample. */
export function LanguagesCard({ coverage, loading, empty, fontCss }: { coverage: Coverage | null; loading: boolean; empty: string; fontCss: string }) {
  const results = useMemo(() => (coverage ? checkPacks(coverage.codepoints) : []), [coverage]);
  const [open, setOpen] = useState<string | null>(null);
  const [showNone, setShowNone] = useState(false);
  const [all, setAll] = useState(false);
  const full = results.filter((r) => r.status === 'full').length;
  const someAll = results.filter((r) => r.status !== 'none');
  // A long list starts with its first few; the rest are one tap away.
  const fold = someAll.length > FIRST + 2 && !all;
  const some = fold ? someAll.slice(0, FIRST) : someAll;
  const none = results.filter((r) => r.status === 'none');
  const toggle = (code: string) => setOpen(open === code ? null : code);
  return (
    <div className="dlangs">
      <div className="dsubhead"><h3>Languages</h3>{coverage && <span className="count">{full} of {results.length} supported</span>}</div>
      {loading && !coverage && <p className="sub">Reading the font's characters…</p>}
      {!loading && !coverage && <p className="sub">{empty}</p>}
      {coverage && (
        <>
          <div className="langs">
            {some.map((r) => <LangRow key={r.pack.code} r={r} open={open === r.pack.code} onToggle={() => toggle(r.pack.code)} fontCss={fontCss} />)}
            {fold && (
              <button className="linkbtn dmore dmorelang" onClick={() => setAll(true)}>
                Show {someAll.length - FIRST} more supported <Icon icon={ArrowDown01Icon} size={14} />
              </button>
            )}
            {none.length > 0 && !showNone && (
              <div className="lang">
                <button className="langhead" aria-expanded={false} onClick={() => setShowNone(true)}>
                  <span className="grow dnone">{none.map((r) => r.pack.label).join(', ')}</span>
                  <span className="lst none">Not included</span>
                </button>
              </div>
            )}
            {showNone && none.map((r) => <LangRow key={r.pack.code} r={r} open={open === r.pack.code} onToggle={() => toggle(r.pack.code)} fontCss={fontCss} />)}
          </div>
          {none.length > 0 && showNone && <button className="linkbtn dmore" onClick={() => setShowNone(false)}>Fold the {none.length} not included <Icon icon={ArrowDown01Icon} size={14} className="flip" /></button>}
          <p className="dnote">{FROM[coverage.from]} A language counts as supported when every letter of its alphabet is in the font. Boxes in a sample mean a missing character.</p>
        </>
      )}
    </div>
  );
}

function LangRow({ r, open, onToggle, fontCss }: { r: PackResult; open: boolean; onToggle: () => void; fontCss: string }) {
  const label = r.status === 'full' ? 'Supported' : r.status === 'none' ? 'Not included' : `${r.missing.length} letters missing`;
  const sample = languageSample(r.pack.code);
  return (
    <div className="lang">
      <button className="langhead" aria-expanded={open} onClick={onToggle}>
        <span>{r.pack.label}</span>
        <span className="faint">{r.pack.script}</span>
        <span className="grow" />
        <span className={`lst ${r.status}`}>{label}</span>
      </button>
      {open && (
        <div className="langbody">
          <p dir="auto" style={{ fontFamily: fontCss, fontSize: 26, margin: 0, lineHeight: 1.25 }}>{sample.code === r.pack.code ? sample.text : r.pack.required.slice(0, 60)}</p>
          {r.missing.length > 0 && (
            <span className="dnote">
              Missing: <span style={{ fontSize: 13, letterSpacing: '0.08em', fontFamily: 'system-ui' }}>{r.missing.slice(0, 80).join(' ')}</span>
              {r.missing.length > 80 ? ` and ${r.missing.length - 80} more` : ''}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
