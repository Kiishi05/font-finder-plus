import { useState } from 'react';
import { Copy01Icon } from '../../../shared/icons';
import type { FaceFile } from '../../../shared/types';
import { CopyButton } from './CopyButton';

const FORMAT: Record<string, string> = { woff2: 'WOFF2', woff: 'WOFF', truetype: 'TTF', ttf: 'TTF', opentype: 'OTF', otf: 'OTF' };

function parts(url: string): { host: string; file: string } {
  if (url.startsWith('data:')) return { host: 'Inside the CSS (data URL)', file: '' };
  try {
    const u = new URL(url);
    return { host: u.host, file: decodeURIComponent(u.pathname.split('/').pop() || u.pathname) };
  } catch {
    return { host: '', file: url };
  }
}

/** The files a font loads from (with a URL). */
export function fileCount(files: FaceFile[]): number {
  return files.filter((f) => f.url).length;
}

/** Every file this font loads from, with its host: useful to see who serves it and what it costs to load. Sits inside the Files card. */
export function FilesCard({ files, toast }: { files: FaceFile[]; toast: (m: string) => void }) {
  const [all, setAll] = useState(false);
  const withUrl = files.filter((f) => f.url);
  if (!withUrl.length) return null;
  const hosts = [...new Set(withUrl.map((f) => parts(f.url!).host))];
  const shown = all ? withUrl : withUrl.slice(0, 6);
  return (
    <div className="dfiles">
      <p className="sub">From {hosts.join(', ')}.</p>
      <ul className="dfilelist">
        {shown.map((f, i) => {
          const p = parts(f.url!);
          return (
            <li key={`${f.url}-${i}`}>
              <div className="dfilerow">
                <code>{p.file || f.url!.slice(0, 60)}</code>
                <CopyButton className="iconbtn sm" icon={Copy01Icon} iconSize={15} ariaLabel="Copy file address" tip="Copy address" text={f.url!} onFail={() => toast('Could not copy the address')} />
              </div>
              <span className="dnote">
                {f.format ? FORMAT[f.format.toLowerCase()] ?? f.format : 'Format not stated'} · weight {f.weight}{f.style !== 'normal' ? ` ${f.style}` : ''}
                {f.status ? ` · ${f.status === 'loaded' ? 'loaded' : f.status === 'error' ? 'failed to load' : 'not loaded yet'}` : ''}
                {f.unicodeRange ? ' · one alphabet range' : ''}
                {hosts.length > 1 ? ` · ${p.host}` : ''}
              </span>
            </li>
          );
        })}
      </ul>
      {withUrl.length > 6 && <button className="linkbtn dmore" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${withUrl.length}`}</button>}
    </div>
  );
}
