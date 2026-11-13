import { ALLOWED_LABEL, USES, knownFont, summaryFor, type Allowed } from '../../../shared/licences';
import { ArrowUpRight01Icon } from '../../../shared/icons';
import type { LicenseType, ParsedFontFile } from '../../../shared/types';
import { Icon } from '../../components/Icon';

/** General practice in paid font licences, shown as things to check, never as this font's terms. */
const PAID_RULES = [
  'A desktop licence (for design apps and print) usually does not cover using the font on a website. Websites need a web licence, often priced by monthly page views.',
  'Apps, games and e-books usually need their own licence.',
  'Many licences do not allow converting or cutting down the font files, so check before making your own web font files.',
  'Licences are usually counted per company, per number of computers, or per site.',
  'A logo you trademark or sell may need an extended licence.',
  'Free trial or personal-use versions do not cover client or commercial work.',
];

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
      {(licenseType === 'commercial' || licenseType === 'unknown') && (
        <details className="filelicence" open={licenseType === 'commercial'}>
          <summary>Common rules in paid font licences</summary>
          <span className="muted" style={{ fontSize: 11.5 }}>General rules most foundries use. They are not this font's terms: check its own licence.</span>
          <ul className="rules">
            {PAID_RULES.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </details>
      )}
      {(parsed?.licenseDescription || parsed?.licenseUrl || parsed?.copyright) && (
        <details className="filelicence" open>
          <summary>What the font file itself says (shown as written)</summary>
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
