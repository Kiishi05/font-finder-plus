import { ContrastIcon, PencilEdit01Icon, TextAlignCenterIcon, TextAlignLeftIcon } from '../../shared/icons';
import { Icon } from './Icon';

export type SampleMode = 'mine' | 'names' | 'pangram' | 'yoruba';

export interface TesterState {
  mode: SampleMode;
  text: string;
  size: number;
  align: 'left' | 'center';
  invert: boolean;
}

export const DEFAULT_TESTER: TesterState = { mode: 'names', text: '', size: 32, align: 'left', invert: false };

const PANGRAM = 'The quick brown fox jumps over the lazy dog';
const YORUBA = 'Ẹ káàárọ̀. Ọmọ mi, ẹ ṣé o.';

export function sampleText(t: TesterState, familyName: string): string {
  if (t.mode === 'mine') return t.text.trim() || familyName;
  if (t.mode === 'pangram') return PANGRAM;
  if (t.mode === 'yoruba') return YORUBA;
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
        {(['mine', 'names', 'pangram', 'yoruba'] as SampleMode[]).map((m) => (
          <button key={m} className="t" aria-pressed={value.mode === m} onClick={() => set({ mode: m })}>
            {m === 'mine' ? 'Mine' : m === 'names' ? 'Names' : m === 'pangram' ? 'Pangram' : 'Yoruba'}
          </button>
        ))}
        {extra}
        <span className="grow" />
        <button className="iconbtn sm" style={{ width: 24, height: 24 }} aria-label="Align left" aria-pressed={value.align === 'left'} onClick={() => set({ align: 'left' })}>
          <span style={{ color: value.align === 'left' ? 'var(--ink)' : 'var(--faint)', display: 'flex' }}><Icon icon={TextAlignLeftIcon} size={15} /></span>
        </button>
        <button className="iconbtn sm" style={{ width: 24, height: 24 }} aria-label="Align center" aria-pressed={value.align === 'center'} onClick={() => set({ align: 'center' })}>
          <span style={{ color: value.align === 'center' ? 'var(--ink)' : 'var(--faint)', display: 'flex' }}><Icon icon={TextAlignCenterIcon} size={15} /></span>
        </button>
        <button className="iconbtn sm" style={{ width: 24, height: 24 }} aria-label="Invert preview" aria-pressed={value.invert} onClick={() => set({ invert: !value.invert })}>
          <span style={{ color: value.invert ? 'var(--ink)' : 'var(--faint)', display: 'flex' }}><Icon icon={ContrastIcon} size={15} /></span>
        </button>
        <button className="t" onClick={() => onChange({ ...value, mode: 'names', text: '', size: 32, align: 'left', invert: false })}>Reset</button>
      </div>
    </div>
  );
}
