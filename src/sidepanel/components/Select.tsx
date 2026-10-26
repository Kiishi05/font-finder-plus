import { ArrowDown01Icon } from '../../shared/icons';
import { Icon } from './Icon';

/** A native select (keyboard and screen-reader friendly) with a Hugeicons arrow. */
export function Select<T extends string>({ value, onChange, label, options }: { value: T; onChange: (v: T) => void; label: string; options: { value: T; label: string }[] }) {
  return (
    <span className="selectwrap">
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <Icon icon={ArrowDown01Icon} size={14} />
    </span>
  );
}
