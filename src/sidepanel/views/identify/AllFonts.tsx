// "Fonts in this image": every text style in a picture matched on its own, plus
// font names written in it ("Font: Clash Display"). Save them all at once.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LICENSE_LABEL, allGoogleFamilies, googleFamily, googleFontsUrl, licenseBadge } from '../../../shared/catalog';
import { ArrowUpRight01Icon, FolderAddIcon, Tick02Icon } from '../../../shared/icons';
import { SaveFontButton } from '../../components/SaveFontButton';
import { imageVerdict, type Verdict } from '../../../shared/imagerank';
import { knownFont, licenceTypeFor } from '../../../shared/licences';
import { CATALOGUES_CHECKED, SOURCE_NAME, allFreeFonts, freeFont, freeLicenceLabel } from '../../../shared/freecatalog';
import { closeSpellings, wordLooksLike } from '../../lib/wordcheck';
import type { PageScan } from '../../../shared/types';
import { Icon } from '../../components/Icon';
import { groupBlocks, type TextBlock } from '../../lib/blocks';
import { findFontNames, lookupName, nameLike, namesFromContext, possibleName, type NamedFont } from '../../lib/fontnames';
import { useGoogleFontReady } from '../../lib/google';
import { cutGlyphs } from '../../lib/imageprep';
import { ensureRecord, newImageCollection, pageFontFiles, recordForName, saveWithImage } from '../../lib/imagefonts';
import { matchGlyphs, type ImageMatch } from '../../lib/matcher';
import type { OcrLine } from '../../lib/ocr';

interface BlockResult {
  matches: ImageMatch[];
  letters: number;
  verdict: Verdict;
  /** For a block with a name written in it: do its letters look like that font? */
  nameCheck?: 'agrees' | 'differs' | 'unchecked';
  /** The name was misread; this is the font whose drawing matches the picture. */
  corrected?: { name: NamedFont; read: string };
}

let free: string[] | null = null;
/** Names of the free fonts we can draw (Google Fonts and Fontshare). */
const freeNames = () => (free ??= [...allGoogleFamilies(), ...allFreeFonts().filter((f) => f.s === 'fontshare').map((f) => f.name)]);

const LETTERS = /[A-Za-z0-9]/;
const lettersIn = (b: TextBlock) => b.lines.reduce((n, l) => n + l.line.symbols.filter((s) => LETTERS.test(s.text)).length, 0);

export const VERDICT_LABEL: Record<Verdict, string> = {
  exact: 'Likely this font',
  close: 'Closest free fonts',
  unlikely: 'Probably a paid or custom font',
};

/** Lines that are font names in a list of fonts ("Helvetica Neue", "Coolvetica", "Inter"...), or null if this is not such a list. */
export function fontList(lines: OcrLine[]): Map<number, NamedFont> | null {
  const named = new Map<number, NamedFont>();
  let listed = 0;
  lines.forEach((l, i) => {
    const t = l.text.replace(/^\s*\d+[.)]\s*/, '').trim();
    if (!nameLike(t)) return;
    const hit = lookupName(t);
    if (hit) listed++;
    named.set(i, hit ? { ...hit, line: i } : { name: t, kind: 'unknown', known: null, line: i });
  });
  // A list: several short lines that read as names, at least two of them fonts we know.
  return named.size >= 4 && listed >= 2 && named.size >= lines.length * 0.5 ? named : null;
}

const blockOf = (line: OcrLine, index: number): TextBlock => ({ lines: [{ line, index }], box: { ...line.bbox }, text: line.text, size: line.bbox.y1 - line.bbox.y0 });

/** Blocks worth matching (enough letters): at most 8, or one per name (up to 20) in a list of fonts. */
export function blocksFor(lines: OcrLine[]): TextBlock[] {
  const list = fontList(lines);
  if (list) {
    const rest = groupBlocks(lines.map((l, i) => (list.has(i) ? { ...l, symbols: [] } : l))).filter((b) => lettersIn(b) >= 4).slice(0, 4);
    return [...[...list.keys()].sort((a, b) => lines[a].bbox.y0 - lines[b].bbox.y0 || lines[a].bbox.x0 - lines[b].bbox.x0).map((i) => blockOf(lines[i], i)), ...rest].slice(0, 24);
  }
  return groupBlocks(lines)
    .filter((b) => lettersIn(b) >= 4)
    // Leave out bits that were not really read: low confidence and no real word.
    .filter((b) => b.lines.some((l) => l.line.confidence >= 50 && /[A-Za-z0-9]{3,}/.test(l.line.text)))
    .slice(0, 8);
}

/** The best match of one block, for the Recent list. */
export interface BlockSummary { family: string; bold: boolean; score: number; reason: string; text: string; size: number }

export function AllFonts({ image, lines, postNames = [], scan, tabId, samePage, onOpenFontId, toast, onDone, headExtra }: {
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
  /** Every block has been matched: the best match of each, best first (for the Recent list). */
  onDone?: (best: BlockSummary[]) => void;
  /** Quiet extra controls in the heading card ("Pick one line instead"). */
  headExtra?: ReactNode;
}) {
  const blocks = useMemo(() => blocksFor(lines), [lines]);
  const names = useMemo(() => {
    const list = fontList(lines);
    // "Lil Grotesk is a geometric sans serif font family", written in the image.
    const described = namesFromContext(lines.map((l) => l.text)).map((n) => ({ ...n, line: lines.findIndex((l) => l.text.includes(n.name)) })).filter((n) => n.line >= 0);
    const found = [...(list ? [...list.values()] : []), ...findFontNames(lines).filter((n) => !list?.has(n.line)), ...described];
    // The biggest text, if the post is about a typeface, may be the font's own name.
    const biggest = [...blocks].sort((a, b) => b.size - a.size)[0];
    const guess = possibleName(lines, biggest && biggest.lines.length === 1 ? biggest.lines[0].index : null, found);
    const inImage = guess ? [guess, ...found] : found;
    const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    // The post's names come first: they are spelled out, while lettering in a picture can be misread.
    const fromPost = postNames.filter((n) => !inImage.some((m) => squash(m.name) === squash(n.name)));
    const all = [...fromPost, ...inImage.filter((n) => !(n.kind === 'unknown' && fromPost.length && n.line < 0))];
    return all.filter((n, i) => all.findIndex((m) => squash(m.name) === squash(n.name)) === i);
  }, [lines, blocks, postNames]);
  const [results, setResults] = useState<(BlockResult | null)[]>([]);
  const [pick, setPick] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  // The page's fonts only matter for a picture from this page (a new scan of another page does not re-match).
  const pageScan = samePage ? scan : null;
  useEffect(() => {
    let live = true;
    setResults(blocks.map(() => null));
    (async () => {
      const extra = pageScan ? await pageFontFiles(pageScan.fonts, tabId) : [];
      const out: BlockResult[] = [];
      for (let i = 0; i < blocks.length; i++) {
        const glyphs = cutGlyphs(image, blocks[i].lines, {});
        const all = glyphs.length >= 2 ? await matchGlyphs(glyphs, 80, extra).catch(() => []) : [];
        const b = blocks[i];
        // One line of a few words: the whole word can be drawn in each candidate and compared with the picture.
        const single = b.lines.length === 1 && b.text.trim().length >= 3 && b.text.length <= 40;
        let named = names.find((n) => b.lines.some((l) => l.index === n.line)) ?? null;
        // A name set in a showy font is often misread ("Lobster" as "Tobater"): try close spellings of free fonts.
        let corrected: BlockResult['corrected'];
        if (named?.kind === 'unknown' && single) {
          let best: { name: string; v: number } | null = null;
          for (const c of closeSpellings(named.name, freeNames())) {
            const v = Math.max(await wordLooksLike(image, b.box, c, c), await wordLooksLike(image, b.box, c, c, true));
            if (v >= 0.72 && (!best || v > best.v)) best = { name: c, v };
          }
          if (best) {
            const hit = lookupName(best.name);
            if (hit) {
              corrected = { name: { ...hit, line: named.line }, read: named.name };
              named = corrected.name;
            }
          }
        }
        // Re-rank the closest fonts by how the whole word looks when drawn in each.
        let ranked = all;
        if (single && all.length) {
          const top = all.filter((m) => !m.onPage).slice(0, 6);
          const words = await Promise.all(top.map((m) => wordLooksLike(image, b.box, b.text.trim(), m.family, m.bold)));
          const mixed = top.map((m, k) => ({ ...m, score: words[k] ? Math.round(m.score * 0.5 + words[k] * 100 * 0.5) : Math.round(m.score * 0.8) }));
          ranked = [...all.filter((m) => m.onPage), ...mixed.sort((x, y) => y.score - x.score), ...all.filter((m) => !m.onPage).slice(6)];
        }
        let matches = ranked.slice(0, 4);
        let verdict = imageVerdict(matches.map((m) => m.score), glyphs.length);
        // A name is written here: check it against the letters and the drawn word, when we have that font.
        let nameCheck: BlockResult['nameCheck'];
        if (named && glyphs.length >= 3) {
          const nm = named;
          const free = !!googleFamily(nm.name) || freeFont(nm.name)?.s === 'fontshare';
          if (!free) nameCheck = 'unchecked';
          else {
            const own = ranked.find((m) => m.family.toLowerCase() === nm.name.toLowerCase());
            const drawn = single ? Math.max(await wordLooksLike(image, b.box, b.text.trim(), nm.name), await wordLooksLike(image, b.box, b.text.trim(), nm.name, true)) : 0;
            const byLetters = !!own && !!ranked[0] && own.score >= Math.max(45, ranked[0].score - 12);
            if (byLetters || drawn >= 0.7) {
              nameCheck = 'agrees';
              const first: ImageMatch = own ? { ...own, score: Math.max(own.score, Math.round(drawn * 100)) } : { family: googleFamily(nm.name)?.family ?? nm.name, bold: false, score: Math.round(drawn * 100), reason: 'The words drawn in this font match the picture.', best: [], missing: 0, onPage: false };
              matches = [first, ...ranked.filter((m) => m.family !== first.family)].slice(0, 4);
              verdict = 'exact';
            } else nameCheck = 'differs';
          }
        }
        const r: BlockResult = { matches, letters: glyphs.length, verdict, nameCheck, corrected };
        if (!live) return;
        out.push(r);
        setResults((prev) => prev.map((x, j) => (j === i ? r : x)));
      }
      if (!live) return;
      const best = out
        .map((r, i) => ({ m: r.matches[0], b: blocks[i] }))
        .filter(({ m }) => m && m.score > 0)
        .map(({ m, b }) => ({ family: m.family, bold: m.bold, score: m.score, reason: m.reason, text: b.text, size: b.size }))
        .sort((x, y) => y.score - x.score);
      doneRef.current?.(best);
    })();
    return () => {
      live = false;
    };
  }, [blocks, image, pageScan, tabId, names]);

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
      toast(done.size ? `Saved ${done.size} ${done.size === 1 ? 'font' : 'fonts'} to a new collection, with the picture` : 'Nothing clear enough to save. Pick a font in a card first.');
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
  const total = shownCount + inPost.length + loose.length;

  return (
    <div className="iresults" id="allfonts">
      <section className="section ireshead">
        <div className="sechead">
          <h2>Fonts in this picture<span className="count">{total}</span></h2>
          <button className="btn sm primary" onClick={saveAll} disabled={saving || pending} title="Save every font found to a new collection, with the picture">
            <Icon icon={FolderAddIcon} size={15} />{saving ? 'Saving…' : pending ? 'Matching…' : 'Save all'}
          </button>
        </div>
        {headExtra}
      </section>

      {inPost.map((n) => <NamedCard key={`p-${n.name}`} n={n} where="post" onOpen={() => open(n.name)} image={image} toast={toast} />)}
      {loose.map((n) => <NamedCard key={`i-${n.name}`} n={n} where="picture" onOpen={() => open(n.name)} image={image} toast={toast} />)}

      {blocks.map((b, i) => hidden(i) ? null : (
        <BlockCard key={i} i={blocks.slice(0, i).filter((_, j) => !hidden(j)).length} block={b} image={image} result={results[i]} named={results[i]?.corrected?.name ?? nameOf(b)} picked={chosen(i)} onPick={(f) => setPick({ ...pick, [i]: f })} onOpen={open} toast={toast} />
      ))}

      <p className="ifoot">
        {hiddenCount > 0 && !pending && `${hiddenCount} more ${hiddenCount === 1 ? 'bit' : 'bits'} of text could not be read clearly enough to compare, so ${hiddenCount === 1 ? 'it is' : 'they are'} left out. `}
        Compared on this computer with free Google Fonts and Fontshare fonts{samePage ? ' and the fonts this page uses' : ''}. A paid font gets its closest free look-alikes, not its name, unless the name is written in the picture.
      </p>
    </div>
  );
}

/** The block cut out of the picture, and the colour around its letters (for the box it sits in). */
function crop(image: HTMLCanvasElement, b: TextBlock['box']): { url: string; bg: string; dark: boolean } {
  const pad = 4;
  const x = Math.max(0, b.x0 - pad), y = Math.max(0, b.y0 - pad);
  const w = Math.min(image.width - x, b.x1 - b.x0 + pad * 2), h = Math.min(image.height - y, b.y1 - b.y0 + pad * 2);
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, x, y, w, h, 0, 0, w, h);
  // The middle value of the four corners is nearly always the background.
  const px = [[0, 0], [c.width - 1, 0], [0, c.height - 1], [c.width - 1, c.height - 1]].map(([cx, cy]) => [...ctx.getImageData(cx, cy, 1, 1).data.slice(0, 3)]);
  const mid = [0, 1, 2].map((k) => px.map((p) => p[k]).sort((p, q) => p - q)[1]);
  const luma = (0.299 * mid[0] + 0.587 * mid[1] + 0.114 * mid[2]) / 255;
  return { url: c.toDataURL('image/png'), bg: `rgb(${mid.join(',')})`, dark: luma < 0.5 };
}

/** The licence badge for a font name: green only for free, amber for paid, a grey ring when unknown. */
export function licOf(name: string): { tone: 'free' | 'warn' | 'neutral'; text: string; title: string } {
  const gf = googleFamily(name);
  if (gf) return { tone: 'free', text: 'Free', title: `Free · ${gf.l && gf.l in LICENSE_LABEL ? LICENSE_LABEL[gf.l as keyof typeof LICENSE_LABEL] : 'Google Fonts'}` };
  const free = freeFont(name);
  if (free) return { tone: 'free', text: 'Free', title: `Free · ${freeLicenceLabel(free)} · ${SOURCE_NAME[free.s]}` };
  const k = knownFont(name);
  if (k) {
    const t = licenceTypeFor(k);
    const b = licenseBadge(t);
    return { tone: b.tone, text: b.tone === 'neutral' ? 'Not in our lists' : b.text, title: t in LICENSE_LABEL ? LICENSE_LABEL[t as keyof typeof LICENSE_LABEL] : `${b.text}, from ${k.by}` };
  }
  return { tone: 'neutral', text: 'Not in our lists', title: `Not in ${CATALOGUES_CHECKED.join(', ')}` };
}

export function Lic({ name }: { name: string }) {
  const l = licOf(name);
  return <span className={`lic ${l.tone}`} title={l.title}><i />{l.text}</span>;
}

/** Where to get a font: Google Fonts (free), its foundry (paid or free elsewhere), or a web search. */
export function WhereToGet({ name }: { name: string }) {
  const gf = googleFamily(name);
  if (gf) return <a className="linkbtn getlink" href={googleFontsUrl(gf.family)} target="_blank" rel="noreferrer" title="Get it free on Google Fonts">Google Fonts<Icon icon={ArrowUpRight01Icon} size={14} /></a>;
  const k = knownFont(name);
  if (k) return <a className="linkbtn getlink" href={k.url} target="_blank" rel="noreferrer">{k.licence === 'commercial' ? `Buy from ${k.by}` : `Get it from ${k.by}`}<Icon icon={ArrowUpRight01Icon} size={14} /></a>;
  return (
    <a className="linkbtn getlink" href={`https://www.google.com/search?q=${encodeURIComponent(`"${name}" font`)}`} target="_blank" rel="noreferrer" title="Not in the catalogues Font Finder Plus knows. Opens a web search.">
      Search the web<Icon icon={ArrowUpRight01Icon} size={14} />
    </a>
  );
}

export const Tick = ({ children }: { children: ReactNode }) => <span className="istatus"><Icon icon={Tick02Icon} size={14} /><span>{children}</span></span>;
export const Note = ({ children }: { children: ReactNode }) => <span className="inote">{children}</span>;

/** A font named in the post or the picture, with no text block of its own. */
function NamedCard({ n, where, onOpen, image, toast }: { n: NamedFont; where: 'post' | 'picture'; onOpen: () => void; image: HTMLCanvasElement; toast: (m: string) => void }) {
  const rec = recordForName(n.name);
  const free = n.kind === 'google' ? null : freeFont(n.name);
  const listed = free ? SOURCE_NAME[free.s] : n.kind === 'google' ? 'Google Fonts' : n.known?.by ?? 'a foundry we know';
  return (
    <section className="section ires named">
      <div className="iinfo">
        <div className="nmrow"><b>{n.name}</b><Lic name={n.name} /></div>
        {n.kind !== 'unknown'
          ? <Tick>Named in the {where}. Listed on {listed}{rec.foundry && rec.foundry !== listed ? `, by ${rec.foundry}` : ''}</Tick>
          : <Note>{n.line < 0 ? 'Named in the post next to a link to its font page' : "Possibly the font's name (the biggest text in a post about a typeface)"}, but not confirmed: it is not in {CATALOGUES_CHECKED.join(', ')}. Who made it and its licence are unknown.</Note>}
      </div>
      <div className="racts">
        <button className="btn sm" onClick={onOpen}>Details</button>
        <SaveFontButton fontId={rec.id} name={n.name} onSave={() => saveWithImage(rec, image)} toast={toast} />
        <span className="grow" />
        <WhereToGet name={n.name} />
      </div>
    </section>
  );
}

function BlockCard({ i, block, image, result, named, picked, onPick, onOpen, toast }: {
  i: number; block: TextBlock; image: HTMLCanvasElement; result: BlockResult | null; named: NamedFont | null;
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
  // What the card is about: a name confirmed by its letters; a name that cannot be checked here
  // (paid, or not in our lists) with its free look-alikes; or text matched by its letters.
  const confirmed = !!named && !!m && result?.nameCheck === 'agrees' && !nameDiffers;
  const aboutName = !!named && !!m && nameDiffers && result?.nameCheck !== 'differs';
  const differs = !!named && !!m && result?.nameCheck === 'differs';
  const subjectFamily = confirmed || aboutName ? named!.name : m?.family ?? '';
  const subject = confirmed || aboutName ? named!.name : m ? `${m.family}${m.bold ? ' Bold' : ''}` : '';
  const k = named ? knownFont(named.name) : null;
  const showChips = !!result && result.matches.length > 1 && !confirmed;
  const pageFont = !!m?.onPage && !aboutName && !confirmed;

  let status: ReactNode = null;
  if (result && m && verdict) {
    if (confirmed) status = result.corrected ? <Tick>Read as “{result.corrected.read}”; the letters match {named!.name}</Tick> : <Tick>Name and letters match</Tick>;
    else if (aboutName) {
      status = k?.licence === 'commercial'
        ? <Note>Paid, from {k.by}. Closest free: {m.family} {m.score}%</Note>
        : k
          ? <Note>From {k.by}, so its letters cannot be compared here. Closest free: {m.family} {m.score}%</Note>
          : <Note>{named!.name} is not in the font lists we check, so its letters cannot be compared. Closest free: {m.family} {m.score}%</Note>;
    } else if (differs) status = <Note>The image names {named!.name}, but these letters look different. <span className="nlinks"><button className="linkbtn" onClick={() => onOpen(named!.name)}>Details for {named!.name}</button><WhereToGet name={named!.name} /></span></Note>;
    else if (pageFont) status = <Tick>A font this page uses</Tick>;
    else if (verdict === 'exact') status = <Tick>Likely this font: its letters match very closely</Tick>;
    else if (verdict === 'unlikely') status = <Note>No free font is a close match, so it is probably paid or made for this design. These are the nearest free ones</Note>;
    else status = <Note>{named ? 'Closest free font by its letters' : 'No name in the picture. Closest free font by its letters'}</Note>;
  }

  return (
    <section className="section ires blockcard" aria-label={`Text style ${i + 1}`}>
      <div className={`icut${thumb.dark ? ' dark' : ''}`} style={{ background: thumb.bg }}>
        <img src={thumb.url} alt={`Text style ${i + 1} from your picture`} />
        {m && !m.onPage && !confirmed && g.ready && <span className="isample" dir="auto" style={{ fontFamily: g.css, fontWeight: m.bold ? 700 : 400 }} title={`Your text set in ${m.family}`}>{sample}</span>}
      </div>
      {!result && <div className="iinfo"><Note>Comparing letters…</Note></div>}
      {result && !m && (
        <div className="iinfo">
          {named && <div className="nmrow"><b>{named.name}</b><Lic name={named.name} /></div>}
          <Note>Too few letters could be cut out to compare. Joined-up script lettering often cannot be split into letters.</Note>
        </div>
      )}
      {result && m && (
        <>
          <div className="iinfo">
            <div className="nmrow">
              <b>{subject}</b>
              {pageFont ? <span className="gtag">On this page</span> : <Lic name={subjectFamily} />}
              <span className="grow" />
              <span className="pct" title={`${result.letters} letters compared`}>{m.score}% match</span>
            </div>
            {status}
          </div>
          {showChips && (
            <div className="others">
              <span className="olbl">{aboutName ? 'Closest free matches' : 'Other free matches'}</span>
              <div className="chips" role="radiogroup" aria-label={`Other matches for text style ${i + 1}`}>
                {result.matches.map((x) => (
                  <button key={x.family} role="radio" aria-checked={x.family === m.family} className={`chip${x.family === m.family ? ' on' : ''}`} onClick={() => onPick(x.family)}>{x.family} {x.score}%</button>
                ))}
              </div>
              {/* The card is about the name; the picked look-alike can still be opened, saved or fetched. */}
              {aboutName && !m.onPage && (
                <div className="altacts">
                  <span className="grow">{m.family}</span>
                  <button className="linkbtn" onClick={() => onOpen(m.family)}>Details</button>
                  <SaveFontButton fontId={recordForName(m.family).id} name={m.family} onSave={() => saveWithImage(recordForName(m.family), image)} toast={toast} />
                  <WhereToGet name={m.family} />
                </div>
              )}
            </div>
          )}
          <div className="racts">
            {pageFont ? (
              <span className="inote">Compared with the fonts this page uses</span>
            ) : (
              <>
                <button className="btn sm" onClick={() => onOpen(subjectFamily)}>Details</button>
                <SaveFontButton fontId={recordForName(subjectFamily).id} name={subjectFamily} onSave={() => saveWithImage(recordForName(subjectFamily), image)} toast={toast} />
                <span className="grow" />
                <WhereToGet name={subjectFamily} />
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
