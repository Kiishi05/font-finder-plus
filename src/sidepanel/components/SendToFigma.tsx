import { useEffect, useRef, useState } from 'react';
import { FigmaIcon, Tick02Icon } from '../../shared/icons';
import type { PageScan, SystemScan } from '../../shared/types';
import { buildFigmaPayload } from '../lib/figma';
import { copyToClipboard } from '../lib/hooks';
import { Icon } from './Icon';

/** Copies the page's fonts and type styles for the Font Finder Plus Figma plugin. */
export function SendToFigma({ scan, tabId, system, toast, primary, label = 'Send to Figma', className = 'btn sm' }: { scan: PageScan; tabId: number | null; system?: SystemScan | null; toast: (m: string) => void; primary?: boolean; label?: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const send = async () => {
    if (tabId == null) return;
    setBusy(true);
    try {
      const { text, payload } = await buildFigmaPayload(scan, tabId, system);
      if (await copyToClipboard(text)) {
        toast(`Copied ${payload.fonts.length} fonts and ${payload.styles.length} styles. In Figma, open the Font Finder Plus plugin and paste.`);
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1600);
      } else toast('Could not copy. Click the panel first, then try again.');
    } catch {
      toast('Could not prepare the fonts for Figma. Scan the page again and retry.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      className={`${className}${primary ? ' primary' : ''}`}
      onClick={send}
      disabled={busy || tabId == null}
      title="Copies every font, its licence, a free stand-in and the type styles for the Font Finder Plus Figma plugin"
    >
      <Icon icon={copied ? Tick02Icon : FigmaIcon} size={15} />
      {busy ? 'Preparing…' : copied ? 'Copied' : label}
    </button>
  );
}
