import type { IconNode } from '../../shared/icons';

export function Icon({ icon, size = 16, stroke = 1.5, className }: { icon: unknown; size?: number; stroke?: number; className?: string }) {
  const nodes = icon as IconNode;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      {nodes.map(([tag, attrs], i) => {
        const props: Record<string, string | number> = {};
        for (const [k, v] of Object.entries(attrs)) {
          if (k === 'key') continue;
          props[k] = k === 'strokeWidth' ? stroke : v;
        }
        const Tag = tag as 'path';
        return <Tag key={i} {...props} />;
      })}
    </svg>
  );
}
