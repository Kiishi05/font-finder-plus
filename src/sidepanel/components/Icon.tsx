import type { IconNode } from '../../shared/icons';

/** Hugeicons are outline icons. `filled` fills closed shapes (used for "saved"). */
export function Icon({ icon, size = 16, stroke = 1.5, className, filled = false }: { icon: unknown; size?: number; stroke?: number; className?: string; filled?: boolean }) {
  const nodes = icon as IconNode;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      {nodes.map(([tag, attrs], i) => {
        const props: Record<string, string | number> = {};
        for (const [k, v] of Object.entries(attrs)) {
          if (k === 'key') continue;
          props[k] = k === 'strokeWidth' ? stroke : v;
        }
        if (filled && tag === 'path') props.fill = 'currentColor';
        const Tag = tag as 'path';
        return <Tag key={i} {...props} />;
      })}
    </svg>
  );
}
