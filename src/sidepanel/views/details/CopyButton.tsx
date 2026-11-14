import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Tick02Icon } from '../../../shared/icons';
import { Icon } from '../../components/Icon';
import { copyToClipboard } from '../../lib/hooks';

/** A button that copies text and says so: a tick and "Copied" for a moment, then back. */
export function CopyButton({ text, className = 'btn', icon, iconSize = 15, label, ariaLabel, tip, onCopied, onFail }: {
  text: string | (() => string);
  className?: string;
  icon?: unknown;
  iconSize?: number;
  /** Visible label; leave out for an icon-only button. */
  label?: ReactNode;
  ariaLabel?: string;
  tip?: string;
  onCopied?: () => void;
  onFail?: () => void;
}) {
  const [done, setDone] = useState(false);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const click = async () => {
    const ok = await copyToClipboard(typeof text === 'function' ? text() : text);
    if (!ok) return onFail?.();
    setDone(true);
    onCopied?.();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDone(false), 1600);
  };
  const tipText = tip ? (done ? 'Copied' : tip) : undefined;
  return (
    <button
      className={`${className}${done ? ' copied' : ''}${tip ? ' tip' : ''}`}
      data-tip={tipText}
      aria-label={ariaLabel ? (done ? 'Copied' : ariaLabel) : undefined}
      onClick={click}
    >
      {done ? <Icon icon={Tick02Icon} size={iconSize} /> : icon ? <Icon icon={icon} size={iconSize} /> : null}
      {label !== undefined && (done ? 'Copied' : label)}
    </button>
  );
}
