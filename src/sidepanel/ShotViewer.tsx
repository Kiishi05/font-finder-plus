import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo } from 'react';
import { db } from '../shared/db';
import { Download01Icon } from '../shared/icons';
import { Icon } from './components/Icon';
import { downloadBlob } from './lib/cards';

/** Full-size view of a saved screenshot, opened in its own tab. */
export function ShotViewer({ id }: { id: number }) {
  const shot = useLiveQuery(() => db.screenshots.get(id).then((s) => s ?? null), [id]);
  const url = useMemo(() => (shot ? URL.createObjectURL(shot.blob) : ''), [shot]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => {
    document.title = shot ? `Screenshot · ${host(shot.pageUrl)}` : 'Screenshot';
  }, [shot]);
  if (shot === undefined) return null;
  if (!shot) return <div className="viewer"><p>This screenshot was deleted.</p></div>;
  return (
    <div className="viewer">
      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <div className="stack grow" style={{ gap: 2, minWidth: 0 }}>
          <b style={{ overflowWrap: 'anywhere' }}>{host(shot.pageUrl)}</b>
          <span className="muted" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{shot.pageUrl} · {new Date(shot.createdAt).toLocaleString()}</span>
        </div>
        <button className="btn" onClick={() => downloadBlob(shot.blob, `screenshot-${host(shot.pageUrl)}.jpg`)}><Icon icon={Download01Icon} size={15} />Download</button>
      </div>
      <img src={url} alt={`Screenshot of ${shot.pageUrl}`} />
    </div>
  );
}

function host(u: string) {
  try {
    return new URL(u).hostname;
  } catch {
    return u;
  }
}
