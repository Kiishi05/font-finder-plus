import { useMemo, useState } from 'react';
import { checkPacks, type PackResult } from '../../../shared/languages';
import { languageSample } from '../../lib/samples';
import type { Coverage } from '../../lib/coverage';

const FROM: Record<Coverage['from'], string> = {
  google: 'Checked against the full family on Google Fonts.',
  files: 'Checked against the font files this site loads. Other versions of this font may have more characters.',
  installed: 'Checked against the copy installed on this computer.',
};

export function LanguagesCard({ coverage, loading, empty, fontCss }: { coverage: Coverage | null; loading: boolean; empty: string; fontCss: string }) {
  const results = useMemo(() => (coverage ? checkPacks(coverage.codepoints) : []), [coverage]);
  const [open, setOpen] = useState<string | null>(null);
  const [showNone, setShowNone] = useState(false);
  const full = results.filter((r) => r.status === 'full').length;
  const some = results.filter((r) => r.status !== 'none');
  const none = results.filter((r) => r.status === 'none');
  return (
    <section className="section">
      <h2>[Languages] {coverage ? `${full} of ${results.length} supported` : ''}</h2>
      {loading && !coverage && <span className="muted" style={{ fontSize: 12 }}>Reading the font's characters…</span>}
      {!loading && !coverage && <span className="muted" style={{ fontSize: 12 }}>{empty}</span>}
      {coverage && (
        <>
          <div className="langs">
            {some.map((r) => (
              <LangRow key={r.pack.code} r={r} open={open === r.pack.code} onToggle={() => setOpen(open === r.pack.code ? null : r.pack.code)} fontCss={fontCss} />
            ))}
            {none.length > 0 && (
              <div className="lang">
                <button className="langhead" aria-expanded={showNone} onClick={() => setShowNone(!showNone)}>
                  <span>Not supported ({none.length})</span>
                  <span className="grow" />
                  <span className="muted" style={{ fontSize: 11.5 }}>{showNone ? 'Hide' : 'Show'}</span>
                </button>
                {!showNone && <p className="muted" style={{ margin: '0 0 10px', fontSize: 12 }}>{none.map((r) => r.pack.label).join(', ')}</p>}
              </div>
            )}
            {showNone && none.map((r) => (
              <LangRow key={r.pack.code} r={r} open={open === r.pack.code} onToggle={() => setOpen(open === r.pack.code ? null : r.pack.code)} fontCss={fontCss} />
            ))}
          </div>
          <span className="muted" style={{ fontSize: 11.5 }}>{FROM[coverage.from]} A language counts as supported when every letter of its alphabet is in the font. Boxes in a sample mean a missing character.</span>
        </>
      )}
    </section>
  );
}

function LangRow({ r, open, onToggle, fontCss }: { r: PackResult; open: boolean; onToggle: () => void; fontCss: string }) {
  const label = r.status === 'full' ? 'Supported' : r.status === 'none' ? 'Not supported' : `Missing ${r.missing.length}`;
  const tone = r.status === 'full' ? 'free' : r.status === 'none' ? 'neutral' : 'warn';
  const sample = languageSample(r.pack.code);
  return (
    <div className="lang">
      <button className="langhead" aria-expanded={open} onClick={onToggle}>
        <span>{r.pack.label}</span>
        <span className="muted" style={{ fontSize: 11 }}>{r.pack.script}</span>
        <span className="grow" />
        <span className={`lic ${tone}`}><i />{label}</span>
      </button>
      {open && (
        <div className="langbody">
          <p dir="auto" style={{ fontFamily: fontCss, fontSize: 26, margin: 0, lineHeight: 1.25 }}>{sample.code === r.pack.code ? sample.text : r.pack.required.slice(0, 60)}</p>
          {r.missing.length > 0 && (
            <span className="muted" style={{ fontSize: 12 }}>
              Missing: <span className="mono" style={{ fontSize: 13, letterSpacing: '0.08em', fontFamily: 'system-ui' }}>{r.missing.slice(0, 80).join(' ')}</span>
              {r.missing.length > 80 ? ` and ${r.missing.length - 80} more` : ''}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
