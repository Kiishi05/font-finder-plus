// All icons come from Hugeicons (free stroke-rounded set, MIT licence).
export {
  Alert02Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Bookmark02Icon,
  Cancel01Icon,
  ContrastIcon,
  Copy01Icon,
  Delete02Icon,
  KeyboardIcon,
  PencilEdit01Icon,
  PinIcon,
  PlusSignIcon,
  Search01Icon,
  Settings02Icon,
  SourceCodeIcon,
  TextAlignCenterIcon,
  TextAlignLeftIcon,
  Tick02Icon,
  Target02Icon,
  GridViewIcon,
  Menu01Icon,
} from '@hugeicons/core-free-icons';

export type IconNode = readonly (readonly [string, Record<string, string | number>])[];

const camelToKebab = (s: string) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());

/** Render an icon as an SVG string (for the content script, which has no React). */
export function iconSvg(icon: unknown, size = 16, strokeWidth = 1.5): string {
  const nodes = icon as IconNode;
  const inner = nodes
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs)
        .filter(([k]) => k !== 'key')
        .map(([k, v]) => {
          const name = camelToKebab(k);
          const val = name === 'stroke-width' ? strokeWidth : v;
          return `${name}="${val}"`;
        })
        .join(' ');
      return `<${tag} ${a}></${tag}>`;
    })
    .join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true">${inner}</svg>`;
}
