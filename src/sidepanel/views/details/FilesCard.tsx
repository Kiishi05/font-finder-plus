import { useState } from 'react';
import { Copy01Icon } from '../../../shared/icons';
import type { FaceFile } from '../../../shared/types';
import { Icon } from '../../components/Icon';
import { copyToClipboard } from '../../lib/hooks';

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

/** Every file this font loads from, with its host: useful to see who serves it and what it costs to load. */
export function FilesCard({ files, toast }: { files: FaceFile[]; toast: (m: string) => void }) {
  const [all, setAll] = useState(false);
  const withUrl = files.filter((f) => f.url);
  if (!withUrl.length) return null;
  const hosts = [...new Set(withUrl.map((f) => parts(f.url!).host))];
  const shown = all ? withUrl : withUrl.slice(0, 6);
  return (
    <section className="section" id="sec-files">
      <h2>[Where it loads from] {withUrl.length} {withUrl.length === 1 ? 'file' : 'files'}</h2>
      <span className="muted" style={{ fontSize: 12 }}>From {hosts.join(', ')}.</span>
      <ul className="files">
        {shown.map((f, i) => {
          const p = parts(f.url!);
          return (
            <li key={`${f.url}-${i}`}>
              <div className="row" style={{ gap: 6 }}>
                <span className="mono grow" style={{ fontSize: 11, overflowWrap: 'anywhere' }}>{p.file || f.url!.slice(0, 60)}</span>
                <button className="iconbtn sm" aria-label="Copy file address" title="Copy file address" onClick={async () => (await copyToClipboard(f.url!)) && toast('Copied the file address')}>
                  <Icon icon={Copy01Icon} size={14} />
                </button>
              </div>
              <span className="muted" style={{ fontSize: 11 }}>
                {p.host} · {f.format ? FORMAT[f.format.toLowerCase()] ?? f.format : 'format not stated'} · weight {f.weight}{f.style !== 'normal' ? ` ${f.style}` : ''}
                {f.status ? ` · ${f.status === 'loaded' ? 'loaded' : f.status === 'error' ? 'failed to load' : 'not loaded yet'}` : ''}
                {f.unicodeRange ? ' · one alphabet range' : ''}
              </span>
            </li>
          );
        })}
      </ul>
      {withUrl.length > 6 && <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${withUrl.length}`}</button>}
    </section>
  );
}
