import { useEffect, useMemo, useRef, useState } from 'react';
import { CLASS_LABEL, licenseBadge } from '../../shared/catalog';
import { ArrowLeft01Icon, Copy01Icon, Download01Icon, PlusSignIcon, Tick02Icon } from '../../shared/icons';
import type { PageFontUsage } from '../../shared/types';
import { Icon } from '../components/Icon';
import { SIZES, canvasBlob, downloadBlob, drawSiteCard, fontCssForUsage, slug, type CardSize, type Theme } from '../lib/cards';
import { usePageScan, type TabState } from '../lib/hooks';

const ROLE: Record<string, string> = { heading: 'Headings', body: 'Body text', button: 'Buttons', link: 'Links', nav: 'Navigation', code: 'Code', caption: 'Captions' };

function label(f: PageFontUsage): string {
  const role = Object.entries(f.roles).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0];
  const lic = f.catalogFamily ? 'Free on Google Fonts' : licenseBadge(f.licenseType).text;
  return [role ? ROLE[role] : null, CLASS_LABEL[f.classification], lic].filter(Boolean).join(' · ').toUpperCase();
}

/** Share card: "Fonts used on [site]". */
export function SiteShareView({ tab, onBack, toast }: { tab: TabState; onBack: () => void; toast: (m: string) => void }) {
  const { scan } = usePageScan(tab.tabId, !!tab.ping, tab.ping?.url, tab.fontsVersion);
  const fonts = useMemo(() => (scan?.fonts ?? []).filter((f) => f.kind !== 'generic'), [scan]);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [size, setSize] = useState<CardSize>('landscape');
  const [theme, setTheme] = useState<Theme>('light');
  const [watermark, setWatermark] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  const picked = chosen ?? fonts.slice(0, 3).map((f) => f.key);

  useEffect(() => {
    if (!scan || !canvas.current) return;
    let off = false;
    (async () => {
      const list = picked.map((k) => fonts.find((f) => f.key === k)).filter((f): f is PageFontUsage => !!f);
      const site = await Promise.all(list.map(async (f) => ({ name: f.displayName || f.family, css: await fontCssForUsage(f, tab.tabId), weight: f.sample.fontWeight || '400', style: f.sample.fontStyle || 'normal', label: label(f) })));
      if (!off && canvas.current) await drawSiteCard(canvas.current, { size, theme, host: scan.host, fonts: site, watermark });
    })();
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan, picked.join('|'), size, theme, watermark]);

  const toggle = (k: string) => {
    const cur = picked.includes(k) ? picked.filter((x) => x !== k) : [...picked, k];
    setChosen(cur.slice(0, 5));
  };
  const file = `fonts-used-on-${slug(scan?.host ?? 'site')}-${size}.png`;

  return (
    <>
      <div className="topbar">
        <button className="iconbtn" aria-label="Back" onClick={onBack}><Icon icon={ArrowLeft01Icon} /></button>
        <span className="label grow">[Share card] / [Fonts used on {scan?.host ?? 'this page'}]</span>
      </div>
      {!scan ? (
        <div className="empty"><p>Open this from the Page tab of a site you have inspected.</p></div>
      ) : (
        <>
          <section className="section">
            <canvas ref={canvas} className="cardcanvas" aria-label={`Fonts used on ${scan.host}`} />
            <span className="mono muted" style={{ fontSize: 10.5 }}>{SIZES[size][0]} × {SIZES[size][1]} px · PNG</span>
          </section>
          <section className="section">
            <h2>[Fonts on the card] Up to 5</h2>
            <div className="chips">
              {fonts.map((f) => {
                const on = picked.includes(f.key);
                return (
                  <button key={f.key} className={`chip${on ? ' on' : ''}`} aria-pressed={on} onClick={() => toggle(f.key)}>
                    {on ? <Icon icon={Tick02Icon} size={13} stroke={2} /> : <Icon icon={PlusSignIcon} size={13} />}
                    {f.displayName || f.family}
                  </button>
                );
              })}
            </div>
            <div className="seg" role="group" aria-label="Size">
              <button aria-pressed={size === 'landscape'} onClick={() => setSize('landscape')}>Landscape 1200×675</button>
              <button aria-pressed={size === 'portrait'} onClick={() => setSize('portrait')}>Portrait 1080×1350</button>
            </div>
            <div className="seg" role="group" aria-label="Theme">
              {(['light', 'dark', 'green'] as Theme[]).map((t) => <button key={t} aria-pressed={theme === t} onClick={() => setTheme(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}
            </div>
            <div className="row">
              <span className="grow" style={{ fontSize: 12.5 }}>Watermark "Font Finder Plus"</span>
              <button className="switch" role="switch" aria-checked={watermark} aria-label="Watermark" onClick={() => setWatermark(!watermark)} />
            </div>
          </section>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn primary" style={{ flex: 1, height: 40 }} onClick={async () => canvas.current && downloadBlob(await canvasBlob(canvas.current), file)}><Icon icon={Download01Icon} size={15} />Download PNG</button>
            <button className="btn" style={{ flex: 1, height: 40 }} onClick={async () => {
              if (!canvas.current) return;
              try {
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': await canvasBlob(canvas.current) })]);
                toast('Copied the image');
              } catch {
                toast('Chrome did not allow copying the image. Use Download instead.');
              }
            }}><Icon icon={Copy01Icon} size={15} />Copy image</button>
          </div>
        </>
      )}
    </>
  );
}
