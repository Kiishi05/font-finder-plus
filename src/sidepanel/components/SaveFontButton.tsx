import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db } from '../../shared/db';
import { Bookmark02Icon } from '../../shared/icons';
import { Icon } from './Icon';

/** Save button that shows "Saved" with a filled bookmark once the font is in the library. Click again to remove it. */
export function SaveFontButton({ fontId, name, onSave, toast }: { fontId: string; name: string; onSave: () => Promise<void>; toast: (m: string) => void }) {
  const saved = useLiveQuery(() => db.savedFonts.where('fontId').equals(fontId).first(), [fontId]);
  const [busy, setBusy] = useState(false);
  const click = async () => {
    setBusy(true);
    try {
      if (saved?.id != null) {
        await db.savedFonts.delete(saved.id);
        toast(`Removed ${name} from your library`);
      } else {
        await onSave();
        toast(`Saved ${name} to your library, with the image`);
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className={`btn sm savebtn${saved ? ' saved' : ''}`} aria-pressed={!!saved} title={saved ? 'Saved. Click to remove it from your library' : 'Save to your library'} onClick={click} disabled={busy}>
      <Icon icon={Bookmark02Icon} size={15} filled={!!saved} />{saved ? 'Saved' : 'Save'}
    </button>
  );
}
