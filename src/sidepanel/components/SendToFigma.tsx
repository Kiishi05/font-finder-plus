import { useState } from 'react';
import { FigmaIcon } from '../../shared/icons';
import type { PageScan, SystemScan } from '../../shared/types';
import { buildFigmaPayload } from '../lib/figma';
import { copyToClipboard } from '../lib/hooks';
import { Icon } from './Icon';

/** Copies the page's fonts and type styles for the Font Finder Plus Figma plugin. */
export function SendToFigma({ scan, tabId, system, toast, primary }: { scan: PageScan; tabId: number | null; system?: SystemScan | null; toast: (m: string) => void; primary?: boolean }) {
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (tabId == null) return;
    setBusy(true);
    try {
      const { text, payload } = await buildFigmaPayload(scan, tabId, system);
      if (await copyToClipboard(text)) toast(`Copied ${payload.fonts.length} fonts and ${payload.styles.length} styles. In Figma, open the Font Finder Plus plugin and paste.`);
      else toast('Could not copy. Click the panel first, then try again.');
    } catch {
      toast('Could not prepare the fonts for Figma. Scan the page again and retry.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className={`btn sm${primary ? ' primary' : ''}`} onClick={send} disabled={busy || tabId == null}>
      <Icon icon={FigmaIcon} size={14} />
      {busy ? 'Preparing…' : 'Send to Figma'}
    </button>
  );
}
