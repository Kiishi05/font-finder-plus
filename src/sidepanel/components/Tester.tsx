import { useEffect, useId, useRef, useState } from 'react';
import { ArrowDown01Icon, ArrowReloadHorizontalIcon, ContrastIcon, LanguageSquareIcon, MoreHorizontalIcon, PencilEdit01Icon, TextAlignCenterIcon, TextAlignLeftIcon, Tick02Icon } from '../../shared/icons';
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

/** By default every font shows the same English sample; its name is in the card's header. */
export const DEFAULT_TESTER: TesterState = { mode: 'language', text: '', lang: 'en', size: 32, align: 'left', invert: false };

export function sampleText(t: TesterState, familyName: string): string {
  if (t.mode === 'mine') return t.text.trim() || familyName;
  if (t.mode === 'language') return languageSample(t.lang).text;
  return familyName;
}

/** The sample choices in the dropdown: each font's own name, then the languages. */
const NAMES = '__names';
const OPTIONS: { key: string; label: string }[] = [{ key: NAMES, label: 'Font name' }, ...LANGUAGE_SAMPLES.map((l) => ({ key: l.code, label: l.label }))];

/** One compact bar: your own text, a sample picker, the size, and a menu for alignment, invert and reset. */
export function Tester({ value, onChange, min = 12, max = 96, extra }: { value: TesterState; onChange: (v: TesterState) => void; min?: number; max?: number; extra?: React.ReactNode }) {
  const set = (p: Partial<TesterState>) => onChange({ ...value, ...p });
  // What the specimens show when the text box is empty: the last sample picked.
  const last = useRef<string>(value.mode === 'names' ? NAMES : value.lang);
  if (value.mode === 'names') last.current = NAMES;
  else if (value.mode === 'language') last.current = value.lang;
  const back = (): Partial<TesterState> => (last.current === NAMES ? { mode: 'names' } : { mode: 'language', lang: last.current });

  const pick = (key: string) => onChange({ ...value, text: '', ...(key === NAMES ? { mode: 'names' } : { mode: 'language', lang: key }) });

  return (
    <div className="tester tbar">
      <label className="tbar-input" htmlFor="tester-text">
        <Icon icon={PencilEdit01Icon} size={16} />
        <input
          id="tester-text"
          type="text"
          placeholder="Type your own text"
          aria-label="Your text"
          value={value.text}
          onChange={(e) => set(e.target.value ? { text: e.target.value, mode: 'mine' } : { text: '', ...back() })}
        />
      </label>
      <SampleDropdown selected={last.current} onPick={pick} />
      <input
        className="tbar-size"
        type="range"
        aria-label="Preview size"
        aria-valuetext={`${value.size} pixels`}
        title={`Size: ${value.size}px`}
        min={min}
        max={max}
        value={value.size}
        onChange={(e) => set({ size: Number(e.target.value) })}
      />
      {extra}
      <MoreMenu value={value} set={set} onReset={() => { last.current = DEFAULT_TESTER.lang; onChange({ ...DEFAULT_TESTER }); }} />
    </div>
  );
}

/** A listbox in place of the native select, so it matches the panel and the chevron turns when open. */
function SampleDropdown({ selected, onPick }: { selected: string; onPick: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const current = OPTIONS.find((o) => o.key === selected) ?? OPTIONS[1];

  useEffect(() => {
    if (!open) return;
    const sel = list.current?.querySelector<HTMLElement>('[aria-selected="true"]') ?? list.current?.querySelector<HTMLElement>('li');
    sel?.focus();
    sel?.scrollIntoView({ block: 'nearest' });
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [open]);

  const choose = (key: string) => {
    onPick(key);
    setOpen(false);
    btn.current?.focus();
  };
  const onListKey = (e: React.KeyboardEvent<HTMLUListElement>) => {
    const items = [...(list.current?.querySelectorAll<HTMLElement>('li') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(items.length - 1, i + 1)]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[Math.max(0, i - 1)]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); items[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); items[items.length - 1]?.focus(); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const k = (document.activeElement as HTMLElement)?.dataset.key; if (k) choose(k); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); btn.current?.focus(); }
    else if (e.key === 'Tab') setOpen(false);
    else if (e.key.length === 1) {
      // Type a letter to jump to the first language that starts with it.
      const ch = e.key.toLowerCase();
      items.find((li, j) => j > i && li.textContent?.toLowerCase().startsWith(ch))?.focus() ?? items.find((li) => li.textContent?.toLowerCase().startsWith(ch))?.focus();
    }
  };

  return (
    <div className="dd" ref={root}>
      <button
        ref={btn}
        type="button"
        className="ddbtn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`Sample text: ${current.label}`}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); }
        }}
      >
        <Icon icon={LanguageSquareIcon} size={15} />
        <span className="ddlabel">{current.label}</span>
        <span className="chev"><Icon icon={ArrowDown01Icon} size={14} /></span>
      </button>
      {open && (
        <ul className="ddlist" id={id} role="listbox" aria-label="Sample text" ref={list} onKeyDown={onListKey}>
          {OPTIONS.map((o) => (
            <li key={o.key} role="option" tabIndex={-1} data-key={o.key} aria-selected={o.key === selected} className={o.key === NAMES ? 'sep' : undefined} onClick={() => choose(o.key)}>
              {o.label}
              <span className="tick"><Icon icon={Tick02Icon} size={14} /></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Alignment, light-on-dark and reset, folded into one small menu. */
function MoreMenu({ value, set, onReset }: { value: TesterState; set: (p: Partial<TesterState>) => void; onReset: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('button')?.focus();
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [open]);
  const onKey = (e: React.KeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('button') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); btn.current?.focus(); }
    else if (e.key === 'Tab') setOpen(false);
  };
  return (
    <div className="dd" ref={root}>
      <button ref={btn} type="button" className={`iconbtn sm${open ? '' : ' tip'}`} data-tip="Style" aria-label="Preview style" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon icon={MoreHorizontalIcon} size={16} />
      </button>
      {open && (
        <div className="ddlist menu" role="menu" aria-label="Preview style" ref={menu} onKeyDown={onKey}>
          <button type="button" role="menuitemradio" aria-checked={value.align === 'left'} onClick={() => set({ align: 'left' })}>
            <Icon icon={TextAlignLeftIcon} size={15} />Align left<span className="tick"><Icon icon={Tick02Icon} size={14} /></span>
          </button>
          <button type="button" role="menuitemradio" aria-checked={value.align === 'center'} onClick={() => set({ align: 'center' })}>
            <Icon icon={TextAlignCenterIcon} size={15} />Align center<span className="tick"><Icon icon={Tick02Icon} size={14} /></span>
          </button>
          <button type="button" role="menuitemcheckbox" aria-checked={value.invert} onClick={() => set({ invert: !value.invert })}>
            <Icon icon={ContrastIcon} size={15} />Light text on dark<span className="tick"><Icon icon={Tick02Icon} size={14} /></span>
          </button>
          <button type="button" role="menuitem" onClick={() => { onReset(); setOpen(false); btn.current?.focus(); }}>
            <Icon icon={ArrowReloadHorizontalIcon} size={15} />Reset text, size and style
          </button>
        </div>
      )}
    </div>
  );
}
