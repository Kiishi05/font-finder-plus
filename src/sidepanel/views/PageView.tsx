import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { CLASS_LABEL, SOURCE_LABEL, freeSourceOf, licenseBadge, adobeFontsUrl } from '../../shared/catalog';
import { declarationCss } from '../../shared/css';
import { db, saveFont } from '../../shared/db';
import {
  Share08Icon,
  Alert02Icon,
  AlertCircleIcon,
  ArrowDown01Icon,
  ArrowReloadHorizontalIcon,
  ArrowRight01Icon,
  ArrowRight02Icon,
  ArrowUp01Icon,
  ArrowUpRight01Icon,
  Bookmark02Icon,
  CloseIcon,
  Copy01Icon,
  CursorPointer01Icon,
  FileLockedIcon,
  InformationCircleIcon,
  PuzzleIcon,
  ScanImageIcon,
  SearchRemoveIcon,
  SourceCodeIcon,
  Target02Icon,
  Tick02Icon,
  WifiDisconnected01Icon,
} from '../../shared/icons';
import { sendToExtension, sendToTab } from '../../shared/messages';
import { bestFileUrl, fontId, recordFromUsage } from '../../shared/records';
import { hasAllSitesAccess, requestAllSitesAccess } from '../../shared/settings';
import type { PageFontUsage, Role } from '../../shared/types';
import { CollectionPicker } from '../components/CollectionPicker';
import { MissingNote } from '../components/MissingNote';
import type { Match } from '../../shared/similar';
import { trySwap, undoSwap, useSwaps } from '../lib/google';
import { SendToFigma } from '../components/SendToFigma';
import { FILE_ACCESS_HINT, drawsTextAsPictures } from '../../shared/pageaccess';
import { CLOSE_MATCH, freeLookalikes, type LookalikeResult } from '../lib/lookalike';
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

/** "Headings, links": what a font is used for, most used first, in a sentence. */
function roleNames(f: PageFontUsage, max = 2): string {
  const names = Object.entries(f.roles)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .slice(0, max)
    .map(([r]) => ROLE_LABEL[r as Role]);
  return names.map((n, i) => (i ? n.toLowerCase() : n)).join(', ');
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** True for about 1.6 seconds after `flash()`, for "Copied" ticks. */
function useFlash(): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const t = useRef<number>();
  useEffect(() => () => window.clearTimeout(t.current), []);
  return [
    on,
    () => {
      setOn(true);
      window.clearTimeout(t.current);
      t.current = window.setTimeout(() => setOn(false), 1600);
    },
  ];
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', on);
    };
  }, []);
  return online;
}

/** The empty and error card: an icon square, a heading and a line, then steps and buttons. */
function Empty({ icon, title, children, steps, actions, tone }: { icon: unknown; title: string; children?: React.ReactNode; steps?: React.ReactNode[]; actions?: React.ReactNode; tone?: 'amber' }) {
  return (
    <section className="empty">
      <span className={`eic${tone ? ` ${tone}` : ''}`}><Icon icon={icon} size={22} /></span>
      <div className="et">
        <h2>{title}</h2>
        {children}
      </div>
      {steps && (
        <ol className="steps">
          {steps.map((s, i) => (
            <li key={i}><span className="n">{i + 1}</span><span>{s}</span></li>
          ))}
        </ol>
      )}
      {actions && <div className="eacts">{actions}</div>}
    </section>
  );
}

interface Props {
  tab: TabState;
  tester: TesterState;
  onTester: (t: TesterState) => void;
  onOpen: (usage: PageFontUsage, fontId: string) => void;
  onShare: () => void;
  toast: (m: string) => void;
  /** A font the on-page dock asked to open: its details open once the page's fonts are read. */
  openFamily?: { family: string; at: number } | null;
  onOpenFamilyDone?: () => void;
}

const normName = (s: string) => s.replace(/^['"]|['"]$/g, '').trim().toLowerCase();

export function PageView({ tab, tester, onTester, onOpen, onShare, toast, openFamily, onOpenFamilyDone }: Props) {
  const ready = !!tab.ping;
  const { scan, loading, error, rescan } = usePageScan(tab.tabId, ready, tab.ping?.url, tab.fontsVersion);
  const [canInject, setCanInject] = useState(false);
  const swaps = useSwaps(ready ? tab.tabId : null);
  const online = useOnline();
  const [cssCopied, flashCss] = useFlash();
  const [errCopied, flashErr] = useFlash();

  useEffect(() => {
    hasAllSitesAccess().then(setCanInject);
    const on = () => hasAllSitesAccess().then(setCanInject);
    chrome.permissions.onAdded.addListener(on);
    chrome.permissions.onRemoved.addListener(on);
    return () => {
      (chrome.permissions.onAdded as unknown as chrome.events.Event<() => void>).removeListener(on);
      (chrome.permissions.onRemoved as unknown as chrome.events.Event<() => void>).removeListener(on);
    };
  }, [ready]);

  // Read each web font's file in the background to fill in format, foundry and style.
  useEffect(() => {
    if (!scan) return;
    const bases = scan.fonts.filter((f) => f.kind === 'web').map((f) => recordFromUsage(f, bestFileUrl(f, f.sample.fontWeight))).filter((b) => b.fileUrl);
    analyzeAll(bases, tab.tabId);
  }, [scan, tab.tabId]);

  // The dock asked for a font's details: open them when the font is on this page, or stay on the list.
  useEffect(() => {
    if (!openFamily) return;
    if (Date.now() - openFamily.at > 20000) return onOpenFamilyDone?.();
    if (!scan) {
      if (!loading && error) onOpenFamilyDone?.();
      return;
    }
    const want = normName(openFamily.family);
    const f = want ? scan.fonts.find((x) => normName(x.family) === want || normName(x.displayName ?? '') === want) : undefined;
    onOpenFamilyDone?.();
    if (f) onOpen(f, fontId(f.family, f.source));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFamily, scan, loading, error]);

  // With access to all sites, read the page as soon as you are on it.
  const autoTried = useRef<string | null>(null);
  useEffect(() => {
    if (ready || !canInject || tab.tabId == null || tab.injectError) return;
    const k = String(tab.tabId);
    if (autoTried.current === k) return;
    autoTried.current = k;
    sendToExtension({ type: 'ffp:inject', tabId: tab.tabId, startInspecting: true }).then(() => tab.refresh());
  }, [ready, canInject, tab.tabId, tab.injectError, tab]);

  const offline = !online && (
    <Empty icon={WifiDisconnected01Icon} title="You're offline" tone="amber">
      <p>The fonts on this page still show. Free look-alikes and Google Fonts previews come back when you reconnect.</p>
    </Empty>
  );

  if (!ready) {
    if (tab.injectError) {
      const fileAccess = tab.injectError.includes(FILE_ACCESS_HINT);
      if (fileAccess) {
        return (
          <>
            <Empty
              icon={FileLockedIcon}
              title="Allow access to files on your computer"
              steps={['Click Open extension settings', <>Turn on “{FILE_ACCESS_HINT}”</>, 'Come back and reload this page']}
              actions={<button className="btn primary" onClick={() => chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` })}>Open extension settings</button>}
            >
              <p>This page is a file on your computer. Chrome only lets extensions read files when you turn that on.</p>
            </Empty>
            <Guide tabId={tab.tabId} />
          </>
        );
      }
      const blocked = /does not let|blocks every extension/i.test(tab.injectError);
      return (
        <>
          <Empty icon={PuzzleIcon} title={blocked ? "Chrome doesn't let extensions read this page" : "This page can't be read"}>
            <p>{tab.injectError}</p>
            <p className="faint">You can still identify fonts from a screenshot: open the Image tab and paste or upload it.</p>
          </Empty>
          <Guide tabId={tab.tabId} />
        </>
      );
    }
    if (canInject) return <Loading host={null} />;
    return (
      <>
        <Empty
          icon={CursorPointer01Icon}
          title="See the fonts on any page"
          steps={[
            'Open the page you want to check',
            <>Click the <b>Ff</b> icon in Chrome's toolbar, or press <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd>. No icon? Click the puzzle piece and pin Font Finder Plus.</>,
            'Hover any text to see its font',
          ]}
          actions={
            <button
              className="btn"
              onClick={async () => {
                const ok = await requestAllSitesAccess();
                setCanInject(ok);
              }}
            >
              Allow access to all sites
            </button>
          }
        >
          <p>Open a website, then click the Font Finder Plus icon in the toolbar. This panel fills in with every font on the page.</p>
          <p className="faint">To read every page by itself, without clicking each time, allow access to all sites. You can turn this off in Settings.</p>
        </Empty>
        <Guide tabId={tab.tabId} />
      </>
    );
  }

  if (tab.ping?.pdf) {
    return (
      <Empty icon={InformationCircleIcon} title="This is a PDF">
        <p>Chrome shows PDFs in its own viewer, which extensions cannot read. Fonts inside a PDF are not web fonts, so they cannot be listed here.</p>
        <p className="faint">To identify a font in it, open the Image tab and use Select an area on the text, or take a screenshot and paste it there.</p>
      </Empty>
    );
  }

  const host = tab.ping!.host || tab.ping!.title;

  if (loading && !scan) return <Loading host={host} />;

  if (error && !scan) {
    return (
      <>
        {offline}
        <Empty
          icon={AlertCircleIcon}
          title="Couldn't finish reading this page"
          actions={
            <>
              <button className="btn primary" onClick={rescan} disabled={loading}><Icon icon={ArrowReloadHorizontalIcon} size={16} />{loading ? 'Reading…' : 'Try again'}</button>
              <button
                className="btn"
                onClick={async () => {
                  if (await copyToClipboard(`${error}\n${tab.ping?.url ?? ''}`)) {
                    flashErr();
                    toast('Copied the error details');
                  }
                }}
              >
                <Icon icon={errCopied ? Tick02Icon : Copy01Icon} size={16} />{errCopied ? 'Copied' : 'Copy details'}
              </button>
            </>
          }
        >
          <p>Something on the page stopped Font Finder Plus partway. Trying again usually works. If it keeps happening, copy the details and send them to us.</p>
          <p className="faint">{error}</p>
        </Empty>
      </>
    );
  }

  const toggle = async () => {
    if (tab.tabId == null) return;
    // Off pauses pointing and keeps the dock on the page; on resumes (or starts it).
    if (tab.inspecting) await sendToTab(tab.tabId, { type: 'ffp:pause', paused: true });
    else await sendToTab(tab.tabId, { type: 'ffp:inspect', on: true });
    tab.refresh();
  };

  const copyAll = async () => {
    if (!scan) return;
    const css = scan.fonts
      .map((f) => `/* ${f.family} · ${roleSummary(f, 2)} */\n${declarationCss(parseFamilyList(f.declaredStacks[0] ?? f.family), f.sample, f.family)}`)
      .join('\n\n');
    if (await copyToClipboard(css)) {
      flashCss();
      toast('Copied CSS for all fonts');
    }
  };

  // No text with a font: offer to read the letters from a picture of the area instead.
  const selectArea = async () => {
    if (tab.tabId == null) return;
    const r = await sendToTab<{ rect: { x: number; y: number; w: number; h: number; dpr: number } | null }>(tab.tabId, { type: 'ffp:select-area' }, 120000);
    if (!r) {
      toast('The page did not answer. Reload the page and try again.');
      return;
    }
    if (!r.rect) {
      sendToTab(tab.tabId, { type: 'ffp:hide-ui', hidden: false });
      return;
    }
    // The Image tab picks this up and reads the area (the same path as Identify this picture).
    await chrome.storage.session.set({ 'identify:pending': { rect: r.rect, tabId: tab.tabId, pageUrl: tab.ping?.url ?? '', context: [], at: Date.now() } });
  };

  const noFonts = !!scan && !scan.fonts.length;
  const asPictures = drawsTextAsPictures(scan?.url);

  return (
    <>
      <section className="section pstatus" aria-label="This page">
        <div className="st1">
          <span className={`pdot${tab.inspecting ? ' live' : ''}`} aria-hidden="true" />
          <span className="who">
            <span>{tab.inspecting ? 'Inspecting · point at any text' : 'Paused · turn on to point at text'}</span>
            <b title={host}>{host}</b>
          </span>
          {scan && <span className="count cpill">{plural(scan.fonts.length, 'font')}</span>}
          <button className="switch" role="switch" aria-checked={tab.inspecting} aria-label="Hover to inspect" onClick={toggle} />
        </div>
        {scan && !noFonts && (
          <div className="st2">
            <SendToFigma scan={scan} tabId={tab.tabId} toast={toast} label="Copy for Figma" className="btn figmabtn" primary />
            <span className="igrp">
            <button className="iconbtn sm tip" data-tip={cssCopied ? 'Copied' : 'Copy all CSS'} aria-label={cssCopied ? 'Copied' : 'Copy all CSS'} onClick={copyAll}>
              <Icon icon={cssCopied ? Tick02Icon : SourceCodeIcon} size={17} />
            </button>
            <button className="iconbtn sm tip" data-tip="Share card" aria-label="Share card" onClick={onShare}>
              <Icon icon={Share08Icon} size={17} />
            </button>
            <button className={`iconbtn sm tip${loading ? ' spinning' : ''}`} data-tip={loading ? 'Reading…' : 'Scan again'} aria-label={loading ? 'Reading the page' : 'Scan again'} onClick={rescan} disabled={loading}>
              <Icon icon={ArrowReloadHorizontalIcon} size={17} />
            </button>
            </span>
          </div>
        )}
      </section>

      {offline}

      <Guide tabId={tab.tabId} />

      {error && <div className="pnote warn"><Icon icon={Alert02Icon} size={16} /><span>{error}</span></div>}

      {noFonts ? (
        <Empty
          icon={SearchRemoveIcon}
          title="No text on this page uses a font"
          actions={
            <>
              <button className="btn primary" onClick={selectArea}><Icon icon={ScanImageIcon} size={16} />Select an area on the page</button>
              <button className="btn" onClick={rescan} disabled={loading}>{loading ? 'Reading…' : 'Check again'}</button>
            </>
          }
        >
          <p>The words here are probably part of pictures or a canvas. Select the area and Font Finder Plus reads the letters from the picture instead.</p>
        </Empty>
      ) : (
        <Tester value={tester} onChange={onTester} />
      )}

      {scan && <MakeItFree fonts={scan.fonts} tabId={tab.tabId} swaps={swaps} toast={toast} />}

      {!!scan?.notLoaded.length && <NotLoaded items={scan.notLoaded} />}

      {!!scan?.fonts.length && (
        <div className="seclabel plabel">
          <h2>Fonts on this page</h2>
          <span className="cpill">{scan.fonts.length}</span>
        </div>
      )}

      {!!scan?.fonts.length && (
        <div className="pcards">
          {scan.fonts.map((f, i) => (
            <FontCard key={f.key} index={i} f={f} tester={tester} tabId={tab.tabId} host={scan.host} swappedTo={swaps[f.key] ?? null} onOpen={onOpen} toast={toast} />
          ))}
        </div>
      )}

      {asPictures && (
        <div className="pnote">
          <Icon icon={InformationCircleIcon} size={16} />
          <span>{asPictures} The fonts listed here are the app's own interface, not your document. To identify a font in the document, use Select an area in the Image tab.</span>
        </div>
      )}

      {!!scan?.pictureText?.count && (
        <div className="pnote">
          <Icon icon={InformationCircleIcon} size={16} />
          <span>
            {scan.pictureText.count === 1 ? 'Some text on this page is' : `${scan.pictureText.count} pieces of text on this page are`} drawn as pictures (SVG or images)
            {scan.pictureText.examples.length ? `, such as ${scan.pictureText.examples.map((e) => `“${e}”`).join(', ')}` : ''}. Pictures have no font to read, so they are not listed. To identify one, hover it and click Identify this picture, or use Select an area in the Image tab.
          </span>
        </div>
      )}

      {!!scan?.iconFonts?.length && (
        <div className="pnote">
          <Icon icon={InformationCircleIcon} size={16} />
          <span>Icon {scan.iconFonts.length === 1 ? 'font' : 'fonts'} on this page, not listed because {scan.iconFonts.length === 1 ? 'it draws' : 'they draw'} symbols rather than text: {scan.iconFonts.join(', ')}.</span>
        </div>
      )}

      {scan?.truncated && (
        <div className="pnote">
          <Icon icon={InformationCircleIcon} size={16} />
          <span>This page is very large. The first 6,000 text elements were checked.</span>
        </div>
      )}
    </>
  );
}

/** Reading the page: a spinner line and three placeholder cards. */
function Loading({ host }: { host: string | null }) {
  return (
    <>
      <section className="section ploading" role="status">
        <span className="spin" aria-hidden="true" />
        <span>{host ? <>Reading the fonts on <b>{host}</b>…</> : 'Reading this page…'}</span>
      </section>
      {[0, 1, 2].map((i) => (
        <section key={i} className="section pskel" aria-hidden="true"><i className="s1" /><i className="s2" /><i className="s3" /></section>
      ))}
      {!host && <p className="sub" style={{ padding: '0 6px' }}>If nothing appears, reload the page.</p>}
    </>
  );
}

/** "2 fonts did not load": one row that opens to say which, and what shows instead. */
function NotLoaded({ items }: { items: { family: string; reason: string; fellBackTo: string; count: number }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <section className={`notloaded${open ? ' open' : ''}`}>
      <button className="nlhead" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon icon={Alert02Icon} size={16} />
        <span className="grow">
          <b>{items.length === 1 ? '1 font did not load' : `${items.length} fonts did not load`}</b>
          <span className="sub">Other fonts show instead</span>
        </span>
        <span className="chev"><Icon icon={ArrowRight01Icon} size={16} /></span>
      </button>
      {open && (
        <ul className="nllist">
          {items.map((n) => (
            <li key={n.family}>
              <b>{n.family}</b>
              <span>
                {n.reason === 'failed'
                  ? 'A web font in the CSS, but it did not load.'
                  : 'In the CSS, but this page does not load it and it is not installed on this computer.'}{' '}
                {n.fellBackTo} shows instead on {plural(n.count, 'element')}.
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FontCard({ f, index, tester, tabId, host, swappedTo, onOpen, toast }: { f: PageFontUsage; index: number; tester: TesterState; tabId: number | null; host: string; swappedTo: string | null; onOpen: Props['onOpen']; toast: (m: string) => void }) {
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
  const [cssCopied, flashCss] = useFlash();

  const copyCss = async () => {
    if (await copyToClipboard(declarationCss(parseFamilyList(f.declaredStacks[0] ?? f.family), f.sample, f.family))) {
      flashCss();
      toast(`Copied CSS for ${name}`);
    }
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

  // Things worth knowing that are not on every card.
  const extra = [
    f.hiddenCount > 0 ? (f.hiddenCount === f.elementCount ? 'All hidden right now (menus or pop-ups)' : `${f.hiddenCount} hidden right now`) : null,
    (f.memberFamilies?.length ?? 1) > 1
      ? `${f.memberFamilies!.length} separate font files (${(f.styleNames ?? []).slice(0, 4).join(', ')}${(f.styleNames?.length ?? 0) > 4 ? '…' : ''})`
      : name !== f.family
        ? `CSS name ${f.family}`
        : null,
  ].filter(Boolean);

  return (
    <article className={`fcard pcard fc${tester.invert ? ' invert' : ''}`}>
      <div className="fcard-head">
        <span className="idx">{String(index + 1).padStart(2, '0')}</span>
        <span className="fname">{name}</span>
        <span className={`lic ${badge.text === 'System' ? 'system' : badge.tone}`}><i />{badge.text}</span>
        <span className="grow" />
        <span className="ptools">
          <button className="iconbtn sm tip" aria-pressed={outlined} data-tip={outlined ? 'Hide outlines' : 'Show on page'} aria-label={outlined ? 'Hide outlines' : `Show ${name} on the page`} onClick={show}>
            <Icon icon={Target02Icon} size={17} />
          </button>
          <button className="iconbtn sm tip" data-tip={cssCopied ? 'Copied' : 'Copy CSS'} aria-label={cssCopied ? 'Copied' : `Copy CSS for ${name}`} onClick={copyCss}>
            <Icon icon={cssCopied ? Tick02Icon : SourceCodeIcon} size={17} />
          </button>
          <button className="iconbtn sm tip" aria-pressed={!!saved} aria-expanded={picking} data-tip={saved ? 'Saved' : 'Save'} aria-label={saved ? `Saved. Click to remove ${name} from your library` : `Save ${name} to your library`} onClick={save}>
            <Icon icon={Bookmark02Icon} size={17} filled={!!saved} />
          </button>
        </span>
      </div>
      <div
        dir="auto"
        className={`specimen clamp${tester.align === 'center' ? ' center' : ''}`}
        style={{ fontFamily: preview.css, fontSize: tester.size, fontWeight: Number(f.sample.fontWeight) || 400, fontStyle: f.sample.fontStyle }}
        title={preview.failed ? 'The font file could not be loaded here, so a fallback is shown.' : undefined}
        onClick={() => onOpen(f, id)}
      >
        {text}
      </div>
      {f.kind !== 'generic' && <MissingNote css={preview.css} text={text} ready={preview.ready && !preview.failed} tester={tester} name={name} />}
      {swappedTo && tabId != null && (
        <div className="swapnote">
          <span>Showing <b>{swappedTo}</b> on the page instead</span>
          <button className="linkbtn" onClick={() => undoSwap(tabId, f.key)}>Undo</button>
        </div>
      )}
      {f.source === 'adobe' && !catalogFamily && (
        <div className="fcard-links">
          <a className="btn sm" href={adobeFontsUrl(name)} target="_blank" rel="noreferrer">Find it on Adobe Fonts <Icon icon={ArrowUpRight01Icon} size={14} /></a>
        </div>
      )}
      <div className="fmeta">
        <span className="grow">
          <span title={`Used for ${roleSummary(f, 7) || 'text'} · ${where}`}>{[CLASS_LABEL[classification], roleNames(f) || 'Text', plural(f.elementCount, 'element')].join(' · ')}</span>
          {extra.length > 0 && <span className="fextra">{extra.join(' · ')}</span>}
        </span>
        <button className="go btn-details" aria-label={`Details for ${name}`} onClick={() => onOpen(f, id)}>
          Details<Icon icon={ArrowRight01Icon} size={14} />
        </button>
      </div>
      {picking && saved?.id != null && (
        <div className="cardpicker">
          <CollectionPicker savedId={saved.id} />
          <button className="linkbtn" style={{ alignSelf: 'flex-start', fontSize: 12.5 }} onClick={() => setPicking(false)}>Done</button>
        </div>
      )}
    </article>
  );
}

const IS_MAC = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

/** A key on the keyboard list. */
const Kbd = ({ k }: { k: string }) => <kbd className="kbd">{k}</kbd>;

/** What each key does, in plain words. */
const KEYS: [string, React.ReactNode][] = [
  ['See a font', <span className="plain">Point at text</span>],
  ['Pin the card', <span className="kbds"><Kbd k="Click" /><span className="plain">or</span><Kbd k="Space" /></span>],
  ['Copy one value', <span className="plain">Click it on the card</span>],
  ['Copy all as CSS', <span className="kbds"><Kbd k="C" /></span>],
  ['Unpin, then turn off', <span className="kbds"><Kbd k="Esc" /></span>],
  ['Turn on or off', <span className="kbds" aria-label={IS_MAC ? 'Option Shift F' : 'Alt Shift F'}>{(IS_MAC ? ['⌥', '⇧', 'F'] : ['Alt', 'Shift', 'F']).map((k) => <Kbd key={k} k={k} />)}</span>],
];

/** A short "how it works" card: the keys, the tips on the page, and reading every page. Hidden once dismissed; Settings can bring it back. */
function Guide({ force = false, tabId = null }: { force?: boolean; tabId?: number | null }) {
  const [settings, update] = useSettings();
  const [allSites, setAllSites] = useState(false);
  useEffect(() => {
    hasAllSitesAccess().then(setAllSites);
    const on = () => hasAllSitesAccess().then(setAllSites);
    chrome.permissions.onAdded.addListener(on);
    chrome.permissions.onRemoved.addListener(on);
    return () => {
      (chrome.permissions.onAdded as unknown as chrome.events.Event<() => void>).removeListener(on);
      (chrome.permissions.onRemoved as unknown as chrome.events.Event<() => void>).removeListener(on);
    };
  }, []);
  if (settings.guideDismissed && !force) return null;

  // Start the three tips on the page again, then turn inspecting on so they show.
  const replayTips = async () => {
    await chrome.storage.local.set({ 'ffp:coachStep': 0 });
    if (tabId == null) return;
    const r = await sendToTab(tabId, { type: 'ffp:inspect', on: true });
    if (r == null) await sendToExtension({ type: 'ffp:inject', tabId, startInspecting: true });
  };

  const toggleAllSites = async () => {
    if (allSites) {
      await chrome.permissions.remove({ origins: ['<all_urls>'] });
      setAllSites(false);
    } else {
      setAllSites(await requestAllSitesAccess());
    }
  };

  return (
    <section className="section guide" aria-label="How it works">
      <div className="sechead">
        <h2>How it works</h2>
        {!force && (
          <button className="iconbtn sm tip" data-tip="Hide" aria-label="Hide this guide" onClick={() => update({ guideDismissed: true })}>
            <Icon icon={CloseIcon} size={15} />
          </button>
        )}
      </div>
      <dl className="keys">
        {KEYS.map(([what, how]) => (
          <div key={what}>
            <dt>{what}</dt>
            <dd>{how}</dd>
          </div>
        ))}
      </dl>
      <button className="btn sm replay" onClick={replayTips}>Show the tips on the page again</button>
      <div className="allsites">
        <div>
          <b id="allsites-label">Read every page by itself</b>
          <span>Lets the panel read each page you open, without clicking.</span>
        </div>
        <button className="switch" role="switch" aria-checked={allSites} aria-labelledby="allsites-label" onClick={toggleAllSites} />
      </div>
      <p className="sub guidenote">
        Another way to start: right-click the page and choose <b>Inspect fonts on this page</b>.
      </p>
    </section>
  );
}

/**
 * Swap paid or unknown-licence web fonts for their closest free Google Fonts
 * match, live on the page, to preview the site with free fonts.
 * Matches below CLOSE_MATCH are marked as not close.
 */
function MakeItFree({ fonts, tabId, swaps, toast }: { fonts: PageFontUsage[]; tabId: number | null; swaps: Record<string, string>; toast: (m: string) => void }) {
  const candidates = fonts.filter((f) => f.kind === 'web' && !f.catalogFamily);
  const ids = candidates.map((f) => fontId(f.family, f.source));
  const records = useLiveQuery(() => db.fonts.bulkGet(ids), [ids.join('|')]) ?? [];
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);
  // Closest free fonts, from the same calculation as Similar fonts and Send to Figma.
  const [found, setFound] = useState<Record<string, LookalikeResult | null | 'pending'>>({});
  const rows = candidates
    .map((f, i) => {
      const r = records[i];
      const lic = r?.licenseType ?? f.licenseType;
      if (lic !== 'commercial' && lic !== 'unknown') return null;
      if (r?.catalogFamily) return null;
      const res = found[f.key];
      const match: Match | null = res && res !== 'pending' ? res.matches[0] ?? null : null;
      const state: 'ok' | 'measuring' | 'failed' = match ? 'ok' : res === undefined || res === 'pending' ? 'measuring' : 'failed';
      return { f, id: ids[i], name: r?.displayName ?? f.displayName ?? f.family, lic, match, x: res && res !== 'pending' ? res.x : null, state };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  const toFind = rows.filter((r) => found[r.f.key] === undefined);
  useEffect(() => {
    if (tabId == null || !toFind.length) return;
    setFound((m) => ({ ...m, ...Object.fromEntries(toFind.map((r) => [r.f.key, 'pending' as const])) }));
    for (const { f, id } of toFind) {
      freeLookalikes({ fontId: id, family: f.family, catalogFamily: null, files: f.files, kind: f.kind, classification: f.classification, weight: f.sample.fontWeight, style: f.sample.fontStyle, onPage: true }, tabId).then((res) => setFound((m) => ({ ...m, [f.key]: res })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, toFind.map((r) => r.f.key).join('|')]);
  if (!rows.length || tabId == null) return null;
  const anySwapped = rows.some((r) => swaps[r.f.key]);
  const swapAll = async () => {
    setBusy(true);
    let n = 0;
    for (const r of rows) {
      if (!r.match) continue;
      try {
        await trySwap(tabId, r.f.key, r.match.family, r.x);
        n++;
      } catch {
        /* keep going */
      }
    }
    setBusy(false);
    toast(n ? `Showing ${n} free ${n === 1 ? 'font' : 'fonts'} on the page` : 'Could not swap these fonts');
  };
  return (
    <section className="section mif" aria-label="Make it free">
      <div className="sechead">
        <h2>Make it free</h2>
        {rows.length > 5 && (
          <button className="linkbtn row" style={{ gap: 4, textDecoration: 'none', fontSize: 12.5 }} aria-expanded={all} onClick={() => setAll(!all)}>
            {all ? 'Show fewer' : `Show all ${rows.length}`}
            <Icon icon={all ? ArrowUp01Icon : ArrowDown01Icon} size={14} />
          </button>
        )}
      </div>
      <p className="info">
        {rows.length === 1 ? 'One font here is' : `${rows.length} fonts here are`} paid or have an unknown licence. Preview the page with the closest free fonts from Google Fonts and Fontshare instead.
      </p>
      <ul className="mflist">
        {(all ? rows : rows.slice(0, 5)).map((r) => {
          const src = r.match ? freeSourceOf(r.match.family) : null;
          return (
            <li key={r.f.key}>
              <span className="from">{r.name}</span>
              <span className="to" role="img" aria-label="to"><Icon icon={ArrowRight02Icon} size={16} /></span>
              <span className="dest">
                {r.match && src ? (
                  <>
                    <span title={`Free on ${src.site} · ${src.licence}`}>
                      <b>{r.match.family}</b>
                      <span className="pct">{r.match.score}%</span>
                    </span>
                    {r.match.score < CLOSE_MATCH && (
                      <span className="far" title="No free font is close to this one. This is the nearest, but it will look noticeably different.">Not a close match</span>
                    )}
                  </>
                ) : r.state === 'measuring' ? (
                  <span className="far">Measuring…</span>
                ) : (
                  <span className="far" title="The font file could not be read and the page could not draw its letters for measuring.">Could not be measured</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn primary" onClick={swapAll} disabled={busy || !rows.some((r) => r.match)}>{busy ? 'Loading fonts…' : anySwapped ? 'Swap again' : 'Swap all on the page'}</button>
        {anySwapped && <button className="btn" onClick={() => undoSwap(tabId, null)}>Undo all</button>}
      </div>
      <small>The same matches as each font's Similar fonts. Under {CLOSE_MATCH}% is marked as not a close match. Nothing changes on the real site, and reloading the page undoes it.</small>
    </section>
  );
}
