import { useMissing } from '../lib/missing';
import { languageSample } from '../lib/samples';
import type { TesterState } from './Tester';

/** Says in words when the preview text has characters the font lacks (they show as boxes). */
export function MissingNote({ css, text, ready, tester, name, style }: { css: string; text: string; ready: boolean; tester: TesterState; name: string; style?: React.CSSProperties }) {
  const missing = useMissing(css, text, ready && tester.mode !== 'names');
  if (!missing.length) return null;
  const quoted = missing.slice(0, 12).map((c) => `“${c}”`).join(' ') + (missing.length > 12 ? ` and ${missing.length - 12} more` : '');
  const n = missing.length;
  const msg =
    tester.mode === 'language'
      ? `${name} does not support ${languageSample(tester.lang).label}. ${n === 1 ? '1 letter is' : `${n} letters are`} missing (${quoted}) and ${n === 1 ? 'shows as a box' : 'show as boxes'}.`
      : `${n === 1 ? '1 character you typed is' : `${n} characters you typed are`} not in ${name} (${quoted}) and ${n === 1 ? 'shows as a box' : 'show as boxes'}.`;
  return (
    <div className="missing" style={style} role="note">
      <span>{msg}</span>
    </div>
  );
}
