import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { CLASS_LABEL, SOURCE_LABEL, licenseBadge } from '../../shared/catalog';
import { declarationCss } from '../../shared/css';
import { db, saveFont } from '../../shared/db';
import { Alert02Icon, ArrowRight01Icon, Bookmark02Icon, CloseIcon, SourceCodeIcon, Target02Icon } from '../../shared/icons';
import { sendToExtension, sendToTab } from '../../shared/messages';
import { bestFileUrl, fontId, recordFromUsage } from '../../shared/records';
import { hasAllSitesAccess } from '../../shared/settings';
import type { PageFontUsage, Role } from '../../shared/types';
import { CollectionPicker } from '../components/CollectionPicker';
import { Icon } from '../components/Icon';
import { Tester, sampleText, type TesterState } from '../components/Tester';
import { copyToClipboard, usePageScan, useSettings, type TabState } from '../lib/hooks';
import { usePreviewFamily } from '../lib/preview';
import { analyzeAll } from '../lib/analyze';
import { parseFamilyList } from '../lib/stack';

const ROLE_LABEL: Record<Role, string> = {
  heading: 'Headings',
  body: 'Body',
  button: 'Buttons',
  link: 'Links',
  nav: 'Navigation',
  code: 'Code',
  caption: 'Captions',
};

export function roleSummary(f: PageFontUsage, max = 3): string {
  return Object.entries(f.roles)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .slice(0, max)
    .map(([r, n]) => `${ROLE_LABEL[r as Role]} ${n}`)
    .join(' · ');
}

interface Props {
  tab: TabState;
  tester: TesterState;
  onTester: (t: TesterState) => void;
  onOpen: (usage: PageFontUsage, fontId: string) => void;
  toast: (m: string) => void;
}

export function PageView({ tab, tester, onTester, onOpen, toast }: Props) {
  const ready = !!tab.ping;
  const { scan, loading, error, rescan } = usePageScan(tab.tabId, ready, tab.ping?.url);
  const [canInject, setCanInject] = useState(false);

  useEffect(() => {
    hasAllSitesAccess().then(setCanInject);
  }, [ready]);

  // Read each web font's file in the background to fill in format, foundry and style.
  useEffect(() => {
    if (!scan) return;
    const bases = scan.fonts.filter((f) => f.kind === 'web').map((f) => recordFromUsage(f, bestFileUrl(f, f.sample.fontWeight))).filter((b) => b.fileUrl);
    analyzeAll(bases, tab.tabId);
  }, [scan, tab.tabId]);

  if (!ready) {
    return (
      <>
        <div className="empty">
          <h2>Inspect the fonts on this page</h2>
          {tab.injectError ? (
            <p>{tab.injectError}</p>
          ) : (
            <p>
              Go to the web page you want to check, then click the Font Finder Plus icon in Chrome's toolbar, or press <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd>.
              The list of fonts appears here and you can hover any text on the page.
            </p>
          )}
          {canInject && tab.tabId != null && !tab.injectError && (
            <button
              className="btn primary"
              onClick={async () => {
                await sendToExtension({ type: 'ffp:inject', tabId: tab.tabId!, startInspecting: true });
                tab.refresh();
              }}
            >
              Inspect this page
            </button>
          )}
        </div>
        <Guide force />
      </>
    );
  }

  const toggle = async () => {
    if (tab.tabId == null) return;
    await sendToTab(tab.tabId, { type: 'ffp:inspect', on: !tab.inspecting });
    tab.refresh();
  };

  const copyAll = async () => {
    if (!scan) return;
    const css = scan.fonts
      .map((f) => `/* ${f.family} · ${roleSummary(f, 2)} */\n${declarationCss(parseFamilyList(f.declaredStacks[0] ?? f.family), f.sample)}`)
      .join('\n\n');
    if (await copyToClipboard(css)) toast('Copied CSS for all fonts');
  };

  return (
    <>
      <div className="status">
        <span className={`dot${tab.inspecting ? ' live' : ''}`} />
        <div className="stack grow">
          <span className="label">{tab.inspecting ? '[Inspecting] hover any text' : '[Paused] turn on to hover'}</span>
          <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tab.ping!.host || tab.ping!.title}</span>
        </div>
        {scan && <span className="mono muted" style={{ fontSize: 10.5 }}>{scan.fonts.length} {scan.fonts.length === 1 ? 'font' : 'fonts'}</span>}
        <button className="switch" role="switch" aria-checked={tab.inspecting} aria-label="Hover inspector" onClick={toggle} />
      </div>

      <Guide />

      <Tester value={tester} onChange={onTester} />

      {loading && !scan && <div className="notice neutral">Reading the fonts on this page…</div>}
      {error && <div className="notice amber"><Icon icon={Alert02Icon} size={15} />{error}</div>}

      {scan?.notLoaded.map((n) => (
        <div key={n.family} className="notice amber">
          <Icon icon={Alert02Icon} size={15} />
          <span>
            {n.reason === 'failed'
              ? `${n.family} is a web font in the CSS, but it did not load.`
              : `${n.family} is in the CSS, but this page does not load it and it is not installed on this computer.`}{' '}
            {n.fellBackTo} shows instead on {n.count} {n.count === 1 ? 'element' : 'elements'}.
          </span>
        </div>
      ))}

      {scan?.fonts.map((f) => (
        <FontCard key={f.key} f={f} tester={tester} tabId={tab.tabId} host={scan.host} onOpen={onOpen} toast={toast} />
      ))}

      {!!scan?.iconFonts?.length && (
        <div className="notice neutral">
          Icon {scan.iconFonts.length === 1 ? 'font' : 'fonts'} on this page, not listed because {scan.iconFonts.length === 1 ? 'it draws' : 'they draw'} symbols rather than text: {scan.iconFonts.join(', ')}.
        </div>
      )}

      {scan && !scan.fonts.length && <div className="notice neutral">No visible text found on this page yet.</div>}
      {scan?.truncated && <div className="notice neutral">This page is very large. The first 6,000 text elements were checked.</div>}

      {scan && (
        <div className="row" style={{ marginTop: 'auto', gap: 6 }}>
          <button className="btn" style={{ flex: 1, height: 40, borderRadius: 12 }} onClick={copyAll}>Copy all CSS</button>
          <button className="btn" style={{ flex: 1, height: 40, borderRadius: 12 }} onClick={rescan} disabled={loading}>{loading ? 'Reading…' : 'Scan again'}</button>
        </div>
      )}
    </>
  );
}

function FontCard({ f, tester, tabId, host, onOpen, toast }: { f: PageFontUsage; tester: TesterState; tabId: number | null; host: string; onOpen: Props['onOpen']; toast: (m: string) => void }) {
  const id = fontId(f.family, f.source);
  const saved = useLiveQuery(() => db.savedFonts.where('fontId').equals(id).first(), [id]);
  const record = useLiveQuery(() => db.fonts.get(id), [id]);
  // The stored record knows more once the font file has been read.
  const classification = record?.parsed ? record.classification : f.classification;
  const catalogFamily = record?.catalogFamily !== undefined ? record.catalogFamily : f.catalogFamily;
  const name = record?.displayName ?? f.displayName ?? f.family;
  const preview = usePreviewFamily(f, tabId);
  const badge = licenseBadge(record?.licenseType ?? f.licenseType);
  const text = sampleText(tester, name);
  const where = catalogFamily ? (f.source === 'google' ? 'Google Fonts' : `${SOURCE_LABEL[f.source]} · on Google Fonts`) : SOURCE_LABEL[f.source];

  const copyCss = async () => {
    if (await copyToClipboard(declarationCss(parseFamilyList(f.declaredStacks[0] ?? f.family), f.sample))) toast(`Copied CSS for ${name}`);
  };
  const [picking, setPicking] = useState(false);
  // Save and unsave. Right after saving, the collections appear so the font
  // can go straight into one; clicking Saved removes it from the library.
  const save = async () => {
    if (saved?.id != null) {
      await db.savedFonts.delete(saved.id);
      setPicking(false);
      toast(`Removed ${name} from your library`);
      return;
    }
    await saveFont(recordFromUsage(f, bestFileUrl(f, f.sample.fontWeight)), host, f.sample);
    toast(`Saved ${name} to your library`);
    setPicking(true);
  };
  const [outlined, setOutlined] = useState(false);
  const outlineTimer = useRef<number>();
  // Only one font is outlined at a time; other cards switch back to "Show on page".
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent<string | null>).detail !== f.key) setOutlined(false);
    };
    window.addEventListener('ffp-outline', on);
    return () => window.removeEventListener('ffp-outline', on);
  }, [f.key]);
  const show = async () => {
    if (tabId == null) return;
    const r = await sendToTab<{ shown: number; hidden: number; cleared?: boolean }>(tabId, { type: 'ffp:highlight', key: f.key, label: name });
    window.clearTimeout(outlineTimer.current);
    setOutlined(!!r?.shown);
    // The outlines fade on the page after 6 seconds; match that here.
    if (r?.shown) outlineTimer.current = window.setTimeout(() => setOutlined(false), 6000);
    window.dispatchEvent(new CustomEvent('ffp-outline', { detail: r?.shown ? f.key : null }));
    if (r && !r.shown && !r.cleared) toast(r.hidden ? `${name} is only in hidden parts of the page, like a closed menu. Open it and try again.` : `${name} is not on the page right now`);
  };

  return (
    <article className={`fcard${tester.invert ? ' invert' : ''}`}>
      <div className="fcard-head">
        <span className="fname" style={{ flexWrap: 'wrap' }}>
          {name}
          <span className="label">[{CLASS_LABEL[classification]} · {where}]</span>
        </span>
        <span className={`lic ${badge.tone}`}><i />{badge.text}</span>
      </div>
      <div
        dir="auto"
        className={`specimen clamp${tester.align === 'center' ? ' center' : ''}`}
        style={{ fontFamily: preview.css, fontSize: tester.size, fontWeight: Number(f.sample.fontWeight) || 400, fontStyle: f.sample.fontStyle }}
        title={preview.failed ? 'The font file could not be loaded here, so a fallback is shown.' : undefined}
      >
        {text}
      </div>
      <div className="fmeta label">
        Used for {roleSummary(f) || 'text'}
        {f.hiddenCount > 0 && (f.hiddenCount === f.elementCount ? ' · all hidden right now (menus or pop-ups)' : ` · ${f.hiddenCount} hidden right now`)}
        {name !== f.family && <> · CSS name {f.family}</>}
      </div>
      <div className="actions">
        <button className={outlined ? 'on' : ''} aria-pressed={outlined} title={outlined ? 'Remove the outlines' : 'Outline the text on the page that uses this font'} onClick={show}>
          <Icon icon={Target02Icon} size={16} />{outlined ? 'Hide outlines' : 'Show on page'}
        </button>
        <button title="Copy the font-family, size, weight and line height as CSS" onClick={copyCss}>
          <Icon icon={SourceCodeIcon} size={16} />Copy CSS
        </button>
        <button className={saved ? 'on' : ''} aria-expanded={picking} title={saved ? 'Saved. Click to remove it from your library' : 'Save to your library'} onClick={save}>
          <Icon icon={Bookmark02Icon} size={16} filled={!!saved} />{saved ? 'Saved' : 'Save'}
        </button>
        <button className="primary" title="See everything about this font" onClick={() => onOpen(f, id)}>
          <Icon icon={ArrowRight01Icon} size={16} />Details
        </button>
      </div>
      {picking && saved?.id != null && (
        <div className="cardpicker">
          <CollectionPicker savedId={saved.id} />
          <button className="linkbtn" style={{ alignSelf: 'flex-start', fontSize: 12 }} onClick={() => setPicking(false)}>Done</button>
        </div>
      )}
    </article>
  );
}

/** A short "how it works" card. Hidden once dismissed; Settings can bring it back. */
function Guide({ force = false }: { force?: boolean }) {
  const [settings, update] = useSettings();
  if (settings.guideDismissed && !force) return null;
  return (
    <section className="guide" aria-label="How it works">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="label">[How it works]</span>
        {!force && (
          <button className="iconbtn sm" aria-label="Hide this guide" title="Hide this guide" onClick={() => update({ guideDismissed: true })}>
            <Icon icon={CloseIcon} size={14} />
          </button>
        )}
      </div>
      <ol>
        <li><span className="n">1</span><span><b>Hover</b> any text on the web page. A card shows the font, size, weight and spacing.</span></li>
        <li><span className="n">2</span><span><b>Click</b> to pin the card in place, click again to unpin. While it is pinned, click any value in it to copy it.</span></li>
        <li><span className="n">3</span><span>To stop, click <b>Stop</b> on the black bar at the bottom of the web page, or close this panel. The switch at the top of this panel turns hovering on and off too.</span></li>
        <li><span className="n">4</span><span>This panel lists every font on the page. <b>Details</b> shows the file facts and a link to Google Fonts when it is there.</span></li>
      </ol>
      <p className="hint" style={{ margin: 0 }}>
        Another way to start: right-click anywhere on the web page itself (not in this panel) and choose <b>Inspect fonts on this page</b>.
      </p>
    </section>
  );
}
