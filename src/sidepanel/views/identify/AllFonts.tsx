// "Fonts in this image": every text style in a picture matched on its own, plus
// font names written in it ("Font: Clash Display"). Save them all at once.
import { useEffect, useMemo, useState } from 'react';
import { LICENSE_LABEL, googleFamily, googleFontsUrl, licenseBadge } from '../../../shared/catalog';
import { ArrowUpRight01Icon, FolderAddIcon } from '../../../shared/icons';
import { SaveFontButton } from '../../components/SaveFontButton';
import { imageVerdict, type Verdict } from '../../../shared/imagerank';
import { knownFont, licenceTypeFor } from '../../../shared/licences';
import { CATALOGUES_CHECKED, SOURCE_NAME, freeFont, freeLicenceLabel } from '../../../shared/freecatalog';
import type { PageScan } from '../../../shared/types';
import { Icon } from '../../components/Icon';
import { groupBlocks, type TextBlock } from '../../lib/blocks';
import { findFontNames, possibleName, type NamedFont } from '../../lib/fontnames';
import { useGoogleFontReady } from '../../lib/google';
import { cutGlyphs } from '../../lib/imageprep';
import { ensureRecord, newImageCollection, pageFontFiles, recordForName, saveWithImage } from '../../lib/imagefonts';
import { matchGlyphs, type ImageMatch } from '../../lib/matcher';
import type { OcrLine } from '../../lib/ocr';

interface BlockResult { matches: ImageMatch[]; letters: number; verdict: Verdict }

const LETTERS = /[A-Za-z0-9]/;
const lettersIn = (b: TextBlock) => b.lines.reduce((n, l) => n + l.line.symbols.filter((s) => LETTERS.test(s.text)).length, 0);

export const VERDICT_LABEL: Record<Verdict, string> = {
  exact: 'Likely this font',
  close: 'Closest free fonts',
  unlikely: 'Probably a paid or custom font',
};

/** Blocks worth matching (enough letters), at most 8. */
export function blocksFor(lines: OcrLine[]): TextBlock[] {
  return groupBlocks(lines)
    .filter((b) => lettersIn(b) >= 4)
    // Leave out bits that were not really read: low confidence and no real word.
    .filter((b) => b.lines.some((l) => l.line.confidence >= 50 && /[A-Za-z0-9]{3,}/.test(l.line.text)))
    .slice(0, 8);
}

export function AllFonts({ image, lines, postNames = [], scan, tabId, samePage, onOpenFontId, toast }: {
  image: HTMLCanvasElement;
  lines: OcrLine[];
  /** Font names in the post around the picture. */
  postNames?: NamedFont[];
  scan: PageScan | null;
  tabId: number | null;
  /** The picture comes from the page in this tab, so its own fonts are compared too. */
  samePage: boolean;
  onOpenFontId: (id: string) => void;
  toast: (m: string) => void;
}) {
  const blocks = useMemo(() => blocksFor(lines), [lines]);
  const names = useMemo(() => {
    const found = findFontNames(lines);
    // The biggest text, if the post is about a typeface, may be the font's own name.
    const biggest = [...blocks].sort((a, b) => b.size - a.size)[0];
    const guess = possibleName(lines, biggest && biggest.lines.length === 1 ? biggest.lines[0].index : null, found);
    const inImage = guess ? [guess, ...found] : found;
    const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    // The post's names come first: they are spelled out, while lettering in a picture can be misread.
    const fromPost = postNames.filter((n) => !inImage.some((m) => squash(m.name) === squash(n.name)));
    return [...fromPost, ...inImage.filter((n) => !(n.kind === 'unknown' && fromPost.length))];
  }, [lines, blocks, postNames]);
  const [results, setResults] = useState<(BlockResult | null)[]>([]);
  const [pick, setPick] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    setResults(blocks.map(() => null));
    (async () => {
      const extra = samePage && scan ? await pageFontFiles(scan.fonts, tabId) : [];
      for (let i = 0; i < blocks.length; i++) {
        const glyphs = cutGlyphs(image, blocks[i].lines, {});
        const matches = glyphs.length >= 2 ? await matchGlyphs(glyphs, 4, extra).catch(() => []) : [];
        const r: BlockResult = { matches, letters: glyphs.length, verdict: imageVerdict(matches.map((m) => m.score), glyphs.length) };
        if (!live) return;
        setResults((prev) => prev.map((x, j) => (j === i ? r : x)));
      }
    })();
    return () => {
      live = false;
    };
  }, [blocks, image, samePage, scan, tabId]);

  // A name written inside a block names that block's font ("Clash Display" set in Clash Display).
  const nameOf = (b: TextBlock) => names.find((n) => b.lines.some((l) => l.index === n.line)) ?? null;
  const loose = names.filter((n) => n.line >= 0 && !blocks.some((b) => b.lines.some((l) => l.index === n.line)));
  const inPost = names.filter((n) => n.line < 0);
  const chosen = (i: number) => pick[i] ?? results[i]?.matches[0]?.family ?? null;

  const saveAll = async () => {
    setSaving(true);
    try {
      const col = await newImageCollection();
      const done = new Set<string>();
      for (const n of names) {
        if (done.has(n.name)) continue;
        await saveWithImage(recordForName(n.name), image, col);
        done.add(n.name);
      }
      for (let i = 0; i < blocks.length; i++) {
        const r = results[i];
        const fam = chosen(i);
        if (!fam || !r || r.verdict === 'unlikely' || r.matches.find((m) => m.family === fam)?.onPage || done.has(fam)) continue;
        await saveWithImage(recordForName(fam), image, col);
        done.add(fam);
      }
      toast(done.size ? `Saved ${done.size} ${done.size === 1 ? 'font' : 'fonts'} to a new collection, with the image` : 'Nothing clear enough to save. Pick a font in a card first.');
    } finally {
      setSaving(false);
    }
  };

  const open = async (name: string) => onOpenFontId(await ensureRecord(name));
  const pending = results.some((r) => r === null);
  // Blocks where nothing could be compared (unreadable bits) are left out of the list.
  const hidden = (i: number) => !!results[i] && results[i]!.matches.every((m) => m.score === 0) && !nameOf(blocks[i]);
  const shownCount = blocks.filter((_, i) => !hidden(i)).length;
  const hiddenCount = blocks.length - shownCount;

  return (
    <section className="section" id="allfonts">
      <h2>[Fonts in this image] {shownCount} {shownCount === 1 ? 'text style' : 'text styles'}{names.length ? ` · ${names.length} named` : ''}</h2>
      <span className="muted" style={{ fontSize: 12 }}>Each block of text in a different size or style is matched on its own. Font names written in the image are looked up too.</span>
      <button className="btn primary" onClick={saveAll} disabled={saving || pending}>
        <Icon icon={FolderAddIcon} size={15} />{saving ? 'Saving…' : pending ? 'Matching…' : 'Save all to a new collection'}
      </button>

      {inPost.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="label">[Named in the post]</span>
          {inPost.map((n) => <NamedRow key={n.name} n={n} onOpen={() => open(n.name)} image={image} toast={toast} />)}
        </div>
      )}

      {loose.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="label">[Named in the image]</span>
          {loose.map((n) => <NamedRow key={n.name} n={n} onOpen={() => open(n.name)} image={image} toast={toast} />)}
        </div>
      )}

      <div className="blocks">
        {blocks.map((b, i) => hidden(i) ? null : (
          <BlockCard key={i} i={blocks.slice(0, i).filter((_, j) => !hidden(j)).length} total={shownCount} block={b} image={image} result={results[i]} named={nameOf(b)} picked={chosen(i)} onPick={(f) => setPick({ ...pick, [i]: f })} onOpen={open} toast={toast} />
        ))}
      </div>
      {hiddenCount > 0 && !pending && <span className="muted" style={{ fontSize: 11.5 }}>{hiddenCount} more {hiddenCount === 1 ? 'bit' : 'bits'} of text could not be read clearly enough to compare, so {hiddenCount === 1 ? 'it is' : 'they are'} left out.</span>}
      <span className="muted" style={{ fontSize: 11.5 }}>
        Compared on this computer with free Google Fonts{samePage ? ' and the fonts this page uses' : ''}. "Likely this font" is used only for very close matches. A paid font gets its closest free look-alikes, not its name, unless the name is written in the image.
      </span>
    </section>
  );
}

function crop(image: HTMLCanvasElement, b: TextBlock['box']): string {
  const pad = 4;
  const x = Math.max(0, b.x0 - pad), y = Math.max(0, b.y0 - pad);
  const w = Math.min(image.width - x, b.x1 - b.x0 + pad * 2), h = Math.min(image.height - y, b.y1 - b.y0 + pad * 2);
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  c.getContext('2d')!.drawImage(image, x, y, w, h, 0, 0, w, h);
  return c.toDataURL('image/png');
}

/** Where to get a font: Google Fonts (free), its foundry (paid or free elsewhere), or a plain note. */
function WhereToGet({ name }: { name: string }) {
  const gf = googleFamily(name);
  if (gf) return <a className="btn sm ghost" href={googleFontsUrl(gf.family)} target="_blank" rel="noreferrer">Get it free: Google Fonts <Icon icon={ArrowUpRight01Icon} size={13} /></a>;
  const k = knownFont(name);
  if (k) return <a className="btn sm ghost" href={k.url} target="_blank" rel="noreferrer">{k.licence === 'commercial' ? `Buy from ${k.by}` : `Get it from ${k.by}`} <Icon icon={ArrowUpRight01Icon} size={13} /></a>;
  return (
    <a className="btn sm ghost" href={`https://www.google.com/search?q=${encodeURIComponent(`"${name}" font`)}`} target="_blank" rel="noreferrer" title="Not in the catalogues Font Finder Plus knows. Opens a web search.">
      Search the web for it <Icon icon={ArrowUpRight01Icon} size={13} />
    </a>
  );
}

function NamedRow({ n, onOpen, image, toast }: { n: NamedFont; onOpen: () => void; image: HTMLCanvasElement; toast: (m: string) => void }) {
  const rec = recordForName(n.name);
  const lic = n.kind === 'google' ? googleFamily(n.name)?.l : n.known ? licenceTypeFor(n.known) : null;
  const badge = licenseBadge(rec.licenseType);
  const free = n.kind === 'google' ? null : freeFont(n.name);
  return (
    <div className="named">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <b className="grow">{n.name}</b>
        <span className={`lic ${badge.tone}`}><i />{free ? `Free · ${freeLicenceLabel(free)}` : lic && lic in LICENSE_LABEL ? LICENSE_LABEL[lic as keyof typeof LICENSE_LABEL] : badge.text}</span>
      </div>
      {n.kind !== 'unknown' && <span className="muted" style={{ fontSize: 11.5 }}>Confirmed: listed on {free ? SOURCE_NAME[free.s] : n.kind === 'google' ? 'Google Fonts' : n.known?.by ?? 'a foundry we know'}.</span>}
      {n.kind === 'unknown' && <span className="muted" style={{ fontSize: 11.5 }}>{n.line < 0 ? 'Named in the post next to a link to its font page' : "Possibly the font's name (the biggest text in a post about a typeface)"}, but not confirmed: it is not in {CATALOGUES_CHECKED.join(', ')}. Who made it and its licence are unknown.</span>}
      {rec.foundry && <span className="muted" style={{ fontSize: 11.5 }}>By {rec.foundry}</span>}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button className="btn sm" onClick={onOpen}>Details</button>
        <SaveFontButton fontId={rec.id} name={n.name} onSave={() => saveWithImage(rec, image)} toast={toast} />
        <WhereToGet name={n.name} />
      </div>
    </div>
  );
}

function BlockCard({ i, total, block, image, result, named, picked, onPick, onOpen, toast }: {
  i: number; total: number; block: TextBlock; image: HTMLCanvasElement; result: BlockResult | null; named: NamedFont | null;
  picked: string | null; onPick: (f: string) => void; onOpen: (name: string) => void; toast: (m: string) => void;
}) {
  const thumb = useMemo(() => crop(image, block.box), [image, block]);
  const m = result?.matches.find((x) => x.family === picked) ?? result?.matches[0] ?? null;
  const g = useGoogleFontReady(m && !m.onPage ? m.family : null);
  const sample = block.text.slice(0, 60);
  const isTop = m && result && m === result.matches[0];
  // The name written here is a different font from the closest match (often a font that is not
  // in Google Fonts): never call the match "likely" then.
  const nameDiffers = !!named && !!m && named.name.toLowerCase() !== m.family.toLowerCase();
  const verdict = result ? (isTop && !(nameDiffers && result.verdict === 'exact') ? result.verdict : result.verdict === 'unlikely' ? 'unlikely' : 'close') : null;
  return (
    <div className="blockcard">
      <span className="mono muted" style={{ fontSize: 10.5 }}>TEXT STYLE {i + 1} OF {total} · {result ? `${result.letters} letters compared` : 'matching…'}</span>
      <img className="blockimg" src={thumb} alt={`Text style ${i + 1} from your image`} />
      {named && (
        <div className="named inline">
          <span className="muted" style={{ fontSize: 11.5 }}>{named.kind === 'unknown' ? 'Possible font name (not confirmed):' : 'Named here:'}</span> <b>{named.name}</b>
          <button className="btn sm" onClick={() => onOpen(named.name)}>Details</button>
          <WhereToGet name={named.name} />
        </div>
      )}
      {!result && <span className="muted" style={{ fontSize: 12 }}>Comparing letters…</span>}
      {result && !m && <span className="muted" style={{ fontSize: 12 }}>Too few letters could be cut out to compare. Joined-up script lettering often cannot be split into letters.</span>}
      {result && m && verdict && (
        <>
          <div className="row" style={{ gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span className={`verdict ${verdict}`}>{VERDICT_LABEL[verdict]}</span>
            <b className="grow" style={{ fontSize: 13.5 }}>{m.family}{m.bold ? ' Bold' : ''}</b>
            <span className="mono" style={{ fontSize: 12 }}>{m.score}%</span>
          </div>
          <div className="mprev" dir="auto" style={{ fontFamily: m.onPage ? undefined : g.css, fontWeight: m.bold ? 700 : 400 }}>{sample}</div>
          {nameDiffers && <span className="muted" style={{ fontSize: 11.5 }}>The image names {named!.name}. These are the free fonts (Google Fonts and Fontshare) that look closest to it.</span>}
          {result.verdict === 'unlikely' && <span className="muted" style={{ fontSize: 11.5 }}>No free font is a close match, so the font in your image is probably paid or made for this design. These are the nearest free ones.</span>}
          {result.matches.length > 1 && (
            <div className="chips" role="radiogroup" aria-label={`Other matches for text style ${i + 1}`}>
              {result.matches.map((x) => (
                <button key={x.family} role="radio" aria-checked={x.family === m.family} className={`chip${x.family === m.family ? ' on' : ''}`} onClick={() => onPick(x.family)}>{x.family} {x.score}%</button>
              ))}
            </div>
          )}
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {!m.onPage && <button className="btn sm" onClick={() => onOpen(m.family)}>Details</button>}
            {!m.onPage && <SaveFontButton fontId={recordForName(m.family).id} name={m.family} onSave={() => saveWithImage(recordForName(m.family), image)} toast={toast} />}
            {m.onPage ? <span className="gtag">A font this page uses</span> : <WhereToGet name={m.family} />}
          </div>
        </>
      )}
    </div>
  );
}
