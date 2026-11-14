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

/** ok: allowed. paid: needs a licence. chk: check (grey ring). no: not allowed. */
const TONE: Record<Allowed, string> = { yes: 'ok', conditions: 'ok', licence: 'paid', check: 'chk', no: 'no', unknown: 'chk' };

export function LicenceCard({ id, name, licenseType, source, parsed, fromCatalogue }: { id?: string; name: string; licenseType: LicenseType; source: string; parsed: ParsedFontFile | null; fromCatalogue: boolean }) {
  const known = knownFont(name) ?? (parsed?.familyName ? knownFont(parsed.familyName) : null);
  const s = summaryFor(licenseType, known, source);
  return (
    <section className="section" id={id}>
      <div className="sechead"><h2>Licence</h2></div>
      <div className="dverdict">
        <p><b>{s.name.replace(/\.$/, '')}.</b> {s.short}</p>
        {known && (
          <p className="dnote">
            {known.licence === 'commercial' ? 'Sold by ' : 'From '}
            <a href={known.url} target="_blank" rel="noreferrer">{known.by}</a>
            {known.note ? `. ${known.note}` : ''}
          </p>
        )}
        {fromCatalogue && <p className="dnote">Licence from the Google Fonts catalogue.</p>}
      </div>
      <div className="duses">
        {USES.map((u) => {
          const v = s.uses[u.key];
          return (
            <div key={u.key} className="duse">
              <span>{u.label}</span>
              <span className={`st ${TONE[v.a]}`}><i />{ALLOWED_LABEL[v.a]}</span>
              {v.note && <span className="dnote">{v.note}</span>}
            </div>
          );
        })}
      </div>
      {s.notes.map((n) => (
        <p key={n} className="dnote">{n}</p>
      ))}
      {(licenseType === 'commercial' || licenseType === 'unknown') && (
        <details className="dfold">
          <summary>Common rules in paid font licences</summary>
          <p className="dnote">General rules most foundries use. They are not this font's terms: check its own licence.</p>
          <ul className="rules">
            {PAID_RULES.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </details>
      )}
      {(parsed?.licenseDescription || parsed?.licenseUrl || parsed?.copyright) && (
        <details className="dfold">
          <summary>What the font file itself says</summary>
          {parsed?.copyright && <p className="dnote">{parsed.copyright}</p>}
          {parsed?.licenseDescription && <p className="dnote">{parsed.licenseDescription.slice(0, 600)}{parsed.licenseDescription.length > 600 ? '…' : ''}</p>}
          {parsed?.licenseUrl && <a className="linkbtn" href={parsed.licenseUrl} target="_blank" rel="noreferrer">Licence link in the file <Icon icon={ArrowUpRight01Icon} size={13} /></a>}
        </details>
      )}
      <div className="dfoot">
        {s.url && (
          <a className="btn sm" href={s.url} target="_blank" rel="noreferrer">Read the full licence <Icon icon={ArrowUpRight01Icon} size={14} /></a>
        )}
        <span className="dnote">A summary, not legal advice.</span>
      </div>
    </section>
  );
}
