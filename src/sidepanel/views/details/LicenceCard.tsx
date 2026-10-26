import { ALLOWED_LABEL, USES, knownFont, summaryFor, type Allowed } from '../../../shared/licences';
import { ArrowUpRight01Icon } from '../../../shared/icons';
import type { LicenseType, ParsedFontFile } from '../../../shared/types';
import { Icon } from '../../components/Icon';

const TONE: Record<Allowed, string> = { yes: 'free', conditions: 'free', licence: 'warn', check: 'neutral', no: 'neutral', unknown: 'neutral' };

export function LicenceCard({ name, licenseType, source, parsed, fromCatalogue }: { name: string; licenseType: LicenseType; source: string; parsed: ParsedFontFile | null; fromCatalogue: boolean }) {
  const known = knownFont(name) ?? (parsed?.familyName ? knownFont(parsed.familyName) : null);
  const s = summaryFor(licenseType, known, source);
  return (
    <section className="section">
      <h2>[Licence] Can I use it?</h2>
      <div className="stack" style={{ gap: 2 }}>
        <b style={{ fontSize: 14 }}>{s.name}</b>
        <span className="muted" style={{ fontSize: 12.5 }}>{s.short}</span>
        {known && (
          <span style={{ fontSize: 12.5 }}>
            {known.licence === 'commercial' ? 'Sold by ' : 'From '}
            <a href={known.url} target="_blank" rel="noreferrer">{known.by}</a>
            {known.note ? `. ${known.note}` : ''}
          </span>
        )}
        {fromCatalogue && <span className="muted" style={{ fontSize: 11.5 }}>Licence from the Google Fonts catalogue.</span>}
      </div>
      <div className="uses">
        {USES.map((u) => {
          const v = s.uses[u.key];
          return (
            <div key={u.key} className="use">
              <span>{u.label}</span>
              <span className={`lic ${TONE[v.a]}`}><i />{ALLOWED_LABEL[v.a]}</span>
              {v.note && <span className="muted note">{v.note}</span>}
            </div>
          );
        })}
      </div>
      {s.notes.map((n) => (
        <span key={n} className="muted" style={{ fontSize: 12 }}>{n}</span>
      ))}
      {(parsed?.licenseDescription || parsed?.licenseUrl || parsed?.copyright) && (
        <details className="filelicence">
          <summary>What the font file itself says</summary>
          {parsed?.copyright && <p>{parsed.copyright}</p>}
          {parsed?.licenseDescription && <p>{parsed.licenseDescription.slice(0, 600)}{parsed.licenseDescription.length > 600 ? '…' : ''}</p>}
          {parsed?.licenseUrl && <a href={parsed.licenseUrl} target="_blank" rel="noreferrer">Licence link in the file</a>}
        </details>
      )}
      <div className="row" style={{ justifyContent: 'space-between' }}>
        {s.url ? (
          <a className="btn sm" href={s.url} target="_blank" rel="noreferrer">Read the full licence <Icon icon={ArrowUpRight01Icon} size={13} /></a>
        ) : <span />}
        <span className="muted" style={{ fontSize: 11 }}>This is a summary, not legal advice.</span>
      </div>
    </section>
  );
}
