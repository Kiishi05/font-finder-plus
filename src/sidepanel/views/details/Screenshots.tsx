import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { db } from '../../../shared/db';
import { Camera01Icon, Delete02Icon } from '../../../shared/icons';
import { sendToTab } from '../../../shared/messages';
import type { Screenshot } from '../../../shared/types';
import { Icon } from '../../components/Icon';

/** Screenshots of pages where you saw this font, kept with it in the library. */
export function Screenshots({ fontId, tabId, onPage, toast }: { fontId: string; tabId: number | null; onPage: boolean; toast: (m: string) => void }) {
  const specimen = useLiveQuery(() => db.specimens.where('fontId').equals(fontId).first(), [fontId]);
  const shots = useLiveQuery(async (): Promise<(Screenshot | undefined)[]> => (specimen ? db.screenshots.bulkGet(specimen.screenshotIds) : []), [specimen?.screenshotIds.join(',')]) ?? [];
  const [busy, setBusy] = useState(false);
  const urls = useMemo(() => shots.map((s) => (s ? URL.createObjectURL(s.blob) : '')), [shots]);
  useEffect(() => () => urls.forEach((u) => u && URL.revokeObjectURL(u)), [urls]);

  const capture = async () => {
    if (tabId == null) return;
    setBusy(true);
    try {
      const tab = await chrome.tabs.get(tabId);
      // Hide the hover card and bar so they are not in the picture.
      await sendToTab(tabId, { type: 'ffp:hide-ui', hidden: true });
      await new Promise((r) => setTimeout(r, 120));
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 82 });
      await sendToTab(tabId, { type: 'ffp:hide-ui', hidden: false });
      const blob = await (await fetch(dataUrl)).blob();
      const id = await db.screenshots.add({ blob, pageUrl: tab.url ?? '', createdAt: Date.now() });
      if (specimen?.id) await db.specimens.update(specimen.id, { screenshotIds: [...specimen.screenshotIds, id] });
      else await db.specimens.add({ fontId, screenshotIds: [id], pairing: null, notes: '', createdAt: Date.now() });
      toast('Screenshot saved with this font');
    } catch {
      if (tabId != null) sendToTab(tabId, { type: 'ffp:hide-ui', hidden: false });
      toast('Chrome did not allow a screenshot of this page. Click the extension icon on the page and try again.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    if (!specimen?.id) return;
    await db.specimens.update(specimen.id, { screenshotIds: specimen.screenshotIds.filter((x) => x !== id) });
    await db.screenshots.delete(id);
  };

  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="label">[Where you saw it]</span>
      {shots.length > 0 && (
        <div className="shots">
          {shots.map((s, i) =>
            s ? (
              <div key={s.id} className="shot">
                <button className="shotimg" title={s.pageUrl} onClick={() => window.open(urls[i], '_blank')}>
                  <img src={urls[i]} alt={`Screenshot of ${s.pageUrl}`} />
                </button>
                <span className="muted" style={{ fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{safeHost(s.pageUrl)}</span>
                <button className="iconbtn sm" aria-label="Delete screenshot" title="Delete screenshot" onClick={() => remove(s.id!)}><Icon icon={Delete02Icon} size={13} /></button>
              </div>
            ) : null,
          )}
        </div>
      )}
      {onPage ? (
        <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={capture} disabled={busy}><Icon icon={Camera01Icon} size={13} />{busy ? 'Taking…' : 'Save a screenshot of this page'}</button>
      ) : (
        !shots.length && <span className="muted" style={{ fontSize: 12 }}>Open this font from the Page tab on a site to save a screenshot of where you saw it.</span>
      )}
    </div>
  );
}

function safeHost(u: string) {
  try {
    return new URL(u).hostname;
  } catch {
    return u;
  }
}
