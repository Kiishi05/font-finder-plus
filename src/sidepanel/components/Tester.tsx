import { ArrowReloadHorizontalIcon, ContrastIcon, LanguageSquareIcon, PencilEdit01Icon, TextAlignCenterIcon, TextAlignLeftIcon } from '../../shared/icons';
import { LANGUAGE_SAMPLES, languageSample } from '../lib/samples';
import { Icon } from './Icon';

/** "mine": the text you type. "names": each font's own name. "language": a sample sentence. */
export type SampleMode = 'mine' | 'names' | 'language';

export interface TesterState {
  mode: SampleMode;
  text: string;
  lang: string;
  size: number;
  align: 'left' | 'center';
  invert: boolean;
}

export const DEFAULT_TESTER: TesterState = { mode: 'names', text: '', lang: 'en', size: 32, align: 'left', invert: false };

export function sampleText(t: TesterState, familyName: string): string {
  if (t.mode === 'mine') return t.text.trim() || familyName;
  if (t.mode === 'language') return languageSample(t.lang).text;
  return familyName;
}

export function Tester({ value, onChange, min = 12, max = 96, extra }: { value: TesterState; onChange: (v: TesterState) => void; min?: number; max?: number; extra?: React.ReactNode }) {
  const set = (p: Partial<TesterState>) => onChange({ ...value, ...p });
  return (
    <div className="tester">
      <div className="tester-line">
        <label className="tester-input" htmlFor="tester-text">
          <Icon icon={PencilEdit01Icon} size={15} />
          <input
            id="tester-text"
            placeholder="Your text"
            value={value.text}
            onChange={(e) => set({ text: e.target.value, mode: e.target.value ? 'mine' : 'names' })}
          />
        </label>
        <div className="size">
          <span className="mono" style={{ fontSize: 11.5, width: 34, textAlign: 'right' }}>{value.size}px</span>
          <input
            type="range"
            aria-label="Preview size"
            min={min}
            max={max}
            value={value.size}
            onChange={(e) => set({ size: Number(e.target.value) })}
          />
        </div>
      </div>
      <div className="toggles">
        <button className="t" aria-pressed={value.mode === 'names'} title="Show each font's own name" onClick={() => set({ mode: 'names' })}>Font name</button>
        <button className="t" aria-pressed={value.mode === 'mine'} title="Show the text you typed above" onClick={() => set({ mode: 'mine' })}>Your text</button>
        <label className={`langpick${value.mode === 'language' ? ' on' : ''}`} title="Show a sample sentence in a language">
          <Icon icon={LanguageSquareIcon} size={15} />
          <select
            aria-label="Language sample"
            value={value.mode === 'language' ? value.lang : ''}
            onChange={(e) => set(e.target.value ? { mode: 'language', lang: e.target.value } : { mode: 'names' })}
          >
            <option value="">Language</option>
            {LANGUAGE_SAMPLES.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </label>
        {extra}
        <span className="grow" />
        <span className="tools">
          <button className="iconbtn sm" aria-label="Align left" title="Align left" aria-pressed={value.align === 'left'} onClick={() => set({ align: 'left' })}>
            <Icon icon={TextAlignLeftIcon} size={15} />
          </button>
          <button className="iconbtn sm" aria-label="Align center" title="Align center" aria-pressed={value.align === 'center'} onClick={() => set({ align: 'center' })}>
            <Icon icon={TextAlignCenterIcon} size={15} />
          </button>
          <button className="iconbtn sm" aria-label="Invert preview" title="Light text on dark" aria-pressed={value.invert} onClick={() => set({ invert: !value.invert })}>
            <Icon icon={ContrastIcon} size={15} />
          </button>
          <button className="iconbtn sm" aria-label="Reset" title="Reset text, size and style" onClick={() => onChange({ ...DEFAULT_TESTER })}>
            <Icon icon={ArrowReloadHorizontalIcon} size={15} />
          </button>
        </span>
      </div>
    </div>
  );
}
