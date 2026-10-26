import { useMissing } from '../lib/missing';
import { languageSample } from '../lib/samples';
import type { TesterState } from './Tester';

/** Says in words when the preview text has characters the font lacks (they show as boxes). */
export function MissingNote({ css, text, ready, tester, name, style }: { css: string; text: string; ready: boolean; tester: TesterState; name: string; style?: React.CSSProperties }) {
  const missing = useMissing(css, text, ready && tester.mode !== 'names');
  if (!missing.length) return null;
  const list = missing.slice(0, 12).join(' ');
  const msg =
    tester.mode === 'language'
      ? `${name} does not support ${languageSample(tester.lang).label}: ${missing.length} ${missing.length === 1 ? 'letter is' : 'letters are'} missing and show as boxes.`
      : `${missing.length} of your characters ${missing.length === 1 ? 'is' : 'are'} not in ${name} and show as boxes.`;
  return (
    <div className="missing" style={style} role="note">
      <span>{msg}</span>
      <span className="mono" style={{ fontFamily: 'system-ui' }}>{list}{missing.length > 12 ? ' …' : ''}</span>
    </div>
  );
}
