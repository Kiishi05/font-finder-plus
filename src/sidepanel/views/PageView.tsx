import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { CLASS_LABEL, licenseBadge } from '../../shared/catalog';
import { declarationCss } from '../../shared/css';
import { db, saveFont } from '../../shared/db';
import { Alert02Icon, ArrowRight01Icon, Bookmark02Icon, SourceCodeIcon, Target02Icon } from '../../shared/icons';
import { sendToExtension, sendToTab } from '../../shared/messages';
import { bestFileUrl, fontId, recordFromUsage } from '../../shared/records';
import { hasAllSitesAccess } from '../../shared/settings';
import type { PageFontUsage, Role } from '../../shared/types';
import { Icon } from '../components/Icon';
import { Tester, sampleText, type TesterState } from '../components/Tester';
import { copyToClipboard, usePageScan, type TabState } from '../lib/hooks';
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
      <div className="empty">
        <h2>Inspect the fonts on this page</h2>
        {tab.injectError ? (
          <p>{tab.injectError}</p>
        ) : (
          <p>
            Click the Font Finder Plus icon in the toolbar, or press <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd>, on the page you want to inspect.
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
  const classification = record?.parsed ? record.classification : f.classification;
  const preview = usePreviewFamily(f, tabId);
  const badge = licenseBadge(f.licenseType);
  const text = sampleText(tester, f.family);

  const copyCss = async () => {
    if (await copyToClipboard(declarationCss(parseFamilyList(f.declaredStacks[0] ?? f.family), f.sample))) toast(`Copied CSS for ${f.family}`);
  };
  const save = async () => {
    await saveFont(recordFromUsage(f, bestFileUrl(f, f.sample.fontWeight)), host, f.sample);
    toast(`Saved ${f.family} to your library`);
  };

  return (
    <article className={`fcard${tester.invert ? ' invert' : ''}`}>
      <div className="fcard-head">
        <span className="fname">
          {f.family}
          <span className="label">[{CLASS_LABEL[classification]}]</span>
        </span>
        <span className={`lic ${badge.tone}`}><i />{badge.text}</span>
      </div>
      <div
        className={`specimen${tester.align === 'center' ? ' center' : ''}`}
        style={{ fontFamily: preview.css, fontSize: tester.size, fontWeight: Number(f.sample.fontWeight) || 400, fontStyle: f.sample.fontStyle }}
        title={preview.failed ? 'The font file could not be loaded here, so a fallback is shown.' : undefined}
      >
        {text}
      </div>
      <div className="fcard-foot">
        <span className="label grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{roleSummary(f)}</span>
        <button className="iconbtn sm" aria-label="Show on page" title="Show on page" onClick={() => tabId != null && sendToTab(tabId, { type: 'ffp:highlight', key: f.key })}>
          <Icon icon={Target02Icon} size={15} />
        </button>
        <button className="iconbtn sm" aria-label="Copy CSS" title="Copy CSS" onClick={copyCss}>
          <Icon icon={SourceCodeIcon} size={15} />
        </button>
        <button className={`iconbtn sm${saved ? ' on' : ''}`} aria-label={saved ? 'Saved to library' : 'Save to library'} title={saved ? 'Saved' : 'Save'} onClick={save}>
          <Icon icon={Bookmark02Icon} size={15} stroke={saved ? 2.2 : 1.5} />
        </button>
        <button className="btn sm primary" onClick={() => onOpen(f, id)}>
          Open <Icon icon={ArrowRight01Icon} size={13} />
        </button>
      </div>
    </article>
  );
}
