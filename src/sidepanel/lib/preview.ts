import { useEffect, useState } from 'react';
import type { FaceFile } from '../../shared/types';
import { aliasFor, loadPreviewFamily, previewFaces } from './fonts';

export interface PreviewSource {
  family: string;
  kind: 'web' | 'local' | 'generic';
  genericName?: string;
  files: FaceFile[];
}

/** CSS font-family the panel should use to draw this font, loading it if needed. */
export function usePreviewFamily(src: PreviewSource | null, tabId: number | null): { css: string; ready: boolean; failed: boolean } {
  const [state, setState] = useState<{ css: string; ready: boolean; failed: boolean }>(() => initial(src));
  const filesKey = src ? src.files.map((f) => f.url).join('|') : '';

  useEffect(() => {
    if (!src) return;
    const init = initial(src);
    setState(init);
    if (src.kind !== 'web') return;
    const faces = previewFaces(src.files);
    if (!faces.length) {
      setState({ css: init.css, ready: true, failed: true });
      return;
    }
    const alias = aliasFor(faces.map((f) => f.url).join('|'));
    let cancelled = false;
    loadPreviewFamily(alias, faces, tabId).then((ok) => {
      if (cancelled) return;
      setState({ css: ok ? `"${alias}", ${fallback(src)}` : init.css, ready: true, failed: !ok });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src?.family, src?.kind, filesKey, tabId]);

  return state;
}

function fallback(src: PreviewSource): string {
  return src.genericName && src.genericName !== 'browser default' ? src.genericName : 'system-ui';
}

function initial(src: PreviewSource | null): { css: string; ready: boolean; failed: boolean } {
  if (!src) return { css: 'inherit', ready: false, failed: false };
  if (src.kind === 'generic') return { css: src.genericName && src.genericName !== 'browser default' ? src.genericName : 'serif', ready: true, failed: false };
  if (src.kind === 'local') return { css: `"${src.family}", ${fallback(src)}`, ready: true, failed: false };
  return { css: `${fallback(src)}`, ready: false, failed: false };
}
