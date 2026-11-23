// One set of type styles can be on the page at a time (Try on page, Use with
// my fonts, Paste type from Figma). This keeps track of which part of the
// panel put them there, so the others can show that it was replaced.
import { useEffect, useState } from 'react';
import { sendToTab, type ApplyTypeReply, type ApplyTypeStyle } from '../../shared/messages';

export type TypeOwner = 'scale' | 'mine' | 'figma';

let current: { tabId: number; owner: TypeOwner } | null = null;
const EVENT = 'ffp-applied-type';

export async function applyToPage(tabId: number, owner: TypeOwner, styles: ApplyTypeStyle[]): Promise<ApplyTypeReply | null> {
  const r = await sendToTab<ApplyTypeReply>(tabId, { type: 'ffp:apply-type', styles, on: true }, 30000);
  current = r?.ok ? { tabId, owner } : null;
  window.dispatchEvent(new Event(EVENT));
  return r;
}

export async function undoOnPage(tabId: number): Promise<void> {
  await sendToTab(tabId, { type: 'ffp:apply-type', styles: [], on: false });
  current = null;
  window.dispatchEvent(new Event(EVENT));
}

/** Who has styles on the page in this tab right now. */
export function useAppliedOwner(tabId: number | null): TypeOwner | null {
  const read = () => (current && current.tabId === tabId ? current.owner : null);
  const [owner, setOwner] = useState<TypeOwner | null>(read);
  useEffect(() => {
    const on = () => setOwner(read());
    on();
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);
  return owner;
}
