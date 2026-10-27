// Plain-language licence summaries. Rules:
// - Open licences (OFL, Apache, UFL) are summarised from their published text.
// - Commercial fonts: we only say who sells the font and that a paid licence is
//   needed. Exact terms vary by foundry and licence, so we link to the foundry.
// - Anything we do not know is shown as unknown.
import type { LicenseType } from './types';

export type Allowed = 'yes' | 'conditions' | 'licence' | 'check' | 'no' | 'unknown';

export interface LicenceUse {
  key: 'web' | 'print' | 'apps' | 'logos' | 'modify' | 'sell';
  label: string;
}

export const USES: LicenceUse[] = [
  { key: 'web', label: 'Websites' },
  { key: 'print', label: 'Print, documents and images' },
  { key: 'apps', label: 'Apps and games' },
  { key: 'logos', label: 'Logos and branding' },
  { key: 'modify', label: 'Change the font itself' },
  { key: 'sell', label: 'Sell the font file on its own' },
];

export interface LicenceSummary {
  name: string;
  short: string;
  url: string | null;
  uses: Record<LicenceUse['key'], { a: Allowed; note?: string }>;
  notes: string[];
}

const all = (a: Allowed) => ({ web: { a }, print: { a }, apps: { a }, logos: { a }, modify: { a }, sell: { a } });

export const SUMMARIES: Record<string, LicenceSummary> = {
  OFL: {
    name: 'SIL Open Font License 1.1',
    short: 'Free for personal and commercial use.',
    url: 'https://openfontlicense.org',
    uses: {
      web: { a: 'yes' },
      print: { a: 'yes' },
      apps: { a: 'yes', note: 'You can bundle the font with your app.' },
      logos: { a: 'yes' },
      modify: { a: 'conditions', note: 'Changed versions must stay under the OFL and must not use any Reserved Font Name the font has.' },
      sell: { a: 'no', note: 'You cannot sell the font by itself. Selling a product that includes it is fine.' },
    },
    notes: ['Keep the copyright notice and licence with the font files if you share them.'],
  },
  APACHE: {
    name: 'Apache License 2.0',
    short: 'Free for personal and commercial use.',
    url: 'https://www.apache.org/licenses/LICENSE-2.0',
    uses: {
      web: { a: 'yes' },
      print: { a: 'yes' },
      apps: { a: 'yes' },
      logos: { a: 'yes' },
      modify: { a: 'conditions', note: 'Mark the files you changed and keep the licence and notices.' },
      sell: { a: 'conditions', note: 'Allowed, as long as the licence and notices go with it.' },
    },
    notes: ['Keep a copy of the licence with the font files if you share them.'],
  },
  UFL: {
    name: 'Ubuntu Font Licence 1.0',
    short: 'Free for personal and commercial use.',
    url: 'https://ubuntu.com/legal/font-licence',
    uses: {
      web: { a: 'yes' },
      print: { a: 'yes' },
      apps: { a: 'yes' },
      logos: { a: 'yes' },
      modify: { a: 'conditions', note: 'Allowed, with naming rules set out in the licence.' },
      sell: { a: 'check' },
    },
    notes: [],
  },
  fontshare: {
    name: 'Fontshare free licence (ITF Free Font License)',
    short: 'Free for personal and commercial use, under Fontshare\'s own licence.',
    url: 'https://www.fontshare.com',
    uses: { web: { a: 'yes' }, print: { a: 'yes' }, apps: { a: 'check' }, logos: { a: 'check' }, modify: { a: 'check' }, sell: { a: 'no', note: 'The fonts are free to download, not to resell.' } },
    notes: ['Read the licence on Fontshare before using it in an app or a logo.'],
  },
  commercial: {
    name: 'Commercial licence',
    short: 'A paid licence is needed. What it covers depends on the licence you buy.',
    url: null,
    uses: {
      web: { a: 'licence', note: 'Usually a separate web licence, often priced by page views.' },
      print: { a: 'licence', note: 'Usually a desktop licence, priced by number of computers.' },
      apps: { a: 'licence', note: 'Usually a separate app licence.' },
      logos: { a: 'check' },
      modify: { a: 'check' },
      sell: { a: 'no' },
    },
    notes: ['The site you found it on has its own licence. That does not cover your use.'],
  },
  system: {
    name: 'Comes with the operating system',
    short: 'You can use it on a computer that has it. Sharing or embedding the file is a different matter.',
    url: null,
    uses: {
      web: { a: 'conditions', note: 'Fine in a font stack: visitors who have it installed will see it. Hosting the file yourself needs a licence from the owner.' },
      print: { a: 'yes', note: 'In documents and images you make on that computer.' },
      apps: { a: 'licence', note: 'Bundling the file in an app needs a licence from the owner.' },
      logos: { a: 'check' },
      modify: { a: 'no' },
      sell: { a: 'no' },
    },
    notes: [],
  },
  adobe: {
    name: 'Adobe Fonts',
    short: 'Served by Adobe Fonts. Using it in your own work needs your own Adobe plan, or a licence from the foundry.',
    url: 'https://fonts.adobe.com',
    uses: { web: { a: 'licence', note: 'Through an Adobe Fonts web project on your own account.' }, print: { a: 'licence' }, apps: { a: 'check' }, logos: { a: 'check' }, modify: { a: 'no' }, sell: { a: 'no' } },
    notes: [],
  },
  unknown: {
    name: 'Unknown',
    short: 'We could not find who makes this font or how it is licensed.',
    url: null,
    uses: all('unknown'),
    notes: ['Check the font file details below for a foundry or licence link, or ask the site owner which font it is.'],
  },
};

export interface KnownFont {
  by: string;
  url: string;
  licence: 'commercial' | 'fontshare' | 'OFL' | 'apple';
  note?: string;
}

const KNOWN = new Map<string, KnownFont>();
const add = (by: string, url: string, licence: KnownFont['licence'], names: string[], note?: string) => {
  for (const n of names) KNOWN.set(squash(n), { by, url, licence, note });
};
function squash(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}

// Commercial foundries. We state who sells the font, never the terms.
add('Klim Type Foundry', 'https://klim.co.nz', 'commercial', ['Söhne', 'Söhne Mono', 'Söhne Breit', 'Söhne Schmal', 'Soehne', 'Soehne Mono', 'Soehne Breit', 'Soehne Schmal', 'Martina Plantijn', 'Die Grotesk', 'American Grotesk', 'Epicene', 'Feijoa', 'Manuka', 'Metric', 'Newzald', 'Founders Grotesk', 'Founders Grotesk Mono', 'Tiempos', 'Tiempos Text', 'Tiempos Headline', 'Tiempos Fine', 'Calibre', 'National', 'National 2', 'Signifier', 'Untitled Sans', 'Untitled Serif', 'Domaine Display', 'Domaine Text', 'Financier Display', 'Financier Text', 'Pitch', 'Heldane Display', 'Heldane Text']);
add('Grilli Type', 'https://www.grillitype.com', 'commercial', ['GT America', 'GT America Mono', 'GT Walsheim', 'GT Sectra', 'GT Super', 'GT Eesti', 'GT Flexa', 'GT Pressura', 'GT Haptik', 'GT Alpina', 'GT Maru', 'GT Standard', 'GT Zirkon', 'GT Planar', 'GT Cinetype']);
add('Commercial Type', 'https://commercialtype.com', 'commercial', ['Graphik', 'Graphik Compact', 'Atlas Grotesk', 'Atlas Typewriter', 'Canela', 'Canela Text', 'Lyon Text', 'Lyon Display', 'Publico', 'Publico Text', 'Publico Headline', 'Austin', 'Styrene A', 'Styrene B', 'Druk', 'Druk Wide', 'Druk Text', 'Guardian Egyptian', 'Produkt', 'Platform', 'Marr Sans', 'Robinson', 'Caponi']);
add('Lineto', 'https://lineto.com', 'commercial', ['Circular', 'Circular Std', 'Circular XX', 'Akkurat', 'Akkurat Mono', 'Brown', 'Replica', 'Simplon', 'Simplon Mono', 'Unica77', 'Riforma']);
add('Hoefler&Co', 'https://www.typography.com', 'commercial', ['Gotham', 'Gotham Rounded', 'Gotham Narrow', 'Mercury', 'Mercury Text', 'Whitney', 'Ideal Sans', 'Sentinel', 'Archer', 'Chronicle Text', 'Chronicle Display', 'Operator Mono', 'Decimal', 'Inkwell', 'Surveyor', 'Verlag', 'Forza', 'Knockout', 'Tungsten', 'Obsidian', 'Quarto', 'Ringside']);
add('Colophon Foundry', 'https://www.colophon-foundry.org', 'commercial', ['Apercu', 'Apercu Mono', 'Apercu Pro', 'Basis Grotesque', 'Basis Grotesque Mono', 'Raisonne', 'Value Serif', 'Value Sans']);
add('CoType Foundry', 'https://cotypefoundry.com', 'commercial', ['Aeonik', 'Aeonik Pro', 'Aeonik Mono', 'Aeonik Fono']);
add('Pangram Pangram Foundry', 'https://pangrampangram.com', 'commercial', ['Neue Montreal', 'PP Neue Montreal', 'Editorial New', 'PP Editorial New', 'PP Mori', 'Neue Machina', 'PP Neue Machina', 'PP Formula', 'Right Grotesk', 'PP Right Grotesk', 'PP Fragment', 'PP Telegraf', 'Telegraf', 'PP Neue World', 'PP Eiko', 'PP Supply Mono', 'PP Supply Sans'], 'Free trial versions exist for personal use. Commercial use needs a paid licence.');
add('Swiss Typefaces', 'https://www.swisstypefaces.com', 'commercial', ["Suisse Int'l", 'Suisse Intl', 'Suisse Intl Mono', 'Suisse Works', 'Suisse Screen', 'Euclid Circular A', 'Euclid Circular B', 'Euclid Flex', 'Euclid Square']);
add('Milieu Grotesque', 'https://www.milieugrotesque.com', 'commercial', ['Maison Neue', 'Maison Neue Mono', 'Maison Neue Extended', 'Chapeau']);
add('Dinamo', 'https://abcdinamo.com', 'commercial', ['ABC Diatype', 'Diatype', 'ABC Diatype Mono', 'ABC Favorit', 'Favorit', 'ABC Monument Grotesk', 'Monument Grotesk', 'ABC Whyte', 'Whyte', 'ABC Arizona Flare', 'ABC Arizona Text', 'ABC Oracle', 'ABC Social']);
add('Sharp Type', 'https://sharptype.co', 'commercial', ['Sharp Grotesk', 'Sharp Sans', 'Sharp Sans Display', 'Ogg', 'Ogg Text']);
add('Mark Simonson Studio', 'https://www.marksimonson.com', 'commercial', ['Proxima Nova', 'Proxima Soft', 'Coquette', 'Bookmania']);
add('Monotype', 'https://www.monotype.com', 'commercial', ['Helvetica Neue', 'Helvetica Now', 'Helvetica Now Display', 'Helvetica Now Text', 'Neue Helvetica', 'Avenir Next', 'Univers', 'Univers Next', 'Frutiger', 'Neue Frutiger', 'DIN Next', 'Neue Haas Unica', 'Neue Haas Grotesk', 'Neue Haas Grotesk Display', 'Gill Sans Nova', 'Trade Gothic Next', 'Futura Now']);
add('Fontfabric', 'https://www.fontfabric.com', 'commercial', ['Nexa', 'Mont', 'Intro']);
add('OH no Type Co', 'https://ohnotype.co', 'commercial', ['Obviously', 'Degular', 'Degular Display', 'Vulf Mono', 'Vulf Sans', 'Swear Display', 'Swear Text']);
add('Typotheque', 'https://www.typotheque.com', 'commercial', ['Fedra Sans', 'Fedra Serif', 'Fedra Mono', 'Greta Text']);
add('TypeMates', 'https://www.type-mates.com', 'commercial', ['Cera Pro', 'Cera Round Pro', 'Cera Condensed Pro']);
add('Optimo', 'https://optimo.ch', 'commercial', ['Theinhardt', 'Theinhardt Mono']);
add('205TF', 'https://www.205.tf', 'commercial', ['Maax', 'Maax Mono']);
add('ParaType', 'https://www.paratype.com', 'commercial', ['Futura PT']);
add('Dalton Maag', 'https://www.daltonmaag.com', 'commercial', ['Aktiv Grotesk', 'Effra']);
add('Adobe', 'https://fonts.adobe.com', 'commercial', ['Myriad Pro', 'Minion Pro', 'Acumin Pro']);
add('The U.S. Graphics Company', 'https://usgraphics.com', 'commercial', ['Berkeley Mono']);
add('Apple', 'https://developer.apple.com/fonts/', 'apple', ['SF Pro', 'SF Pro Display', 'SF Pro Text', 'SF Pro Rounded', 'SF Compact', 'SF Mono', 'New York', 'San Francisco']);

// Free fonts that are not on Google Fonts.
add('Indian Type Foundry (Fontshare)', 'https://www.fontshare.com', 'fontshare', ['Satoshi', 'General Sans', 'Cabinet Grotesk', 'Clash Display', 'Clash Grotesk', 'Switzer', 'Supreme', 'Sentient', 'Zodiak', 'Erode', 'Gambetta', 'Ranade', 'Chillax', 'Panchang', 'Boska', 'Bespoke Serif', 'Synonym', 'Tanker', 'Author', 'Melodrama', 'Telma', 'Pally', 'Stardom', 'Britney', 'Excon', 'Nippo', 'Bevellier', 'Rowan', 'Technor', 'Recia']);
add('GitHub', 'https://github.com/githubnext/monaspace', 'OFL', ['Monaspace Neon', 'Monaspace Argon', 'Monaspace Xenon', 'Monaspace Radon', 'Monaspace Krypton']);
add('GitHub', 'https://github.com/github/mona-sans', 'OFL', ['Mona Sans', 'Hubot Sans']);
add('Microsoft', 'https://github.com/microsoft/cascadia-code', 'OFL', ['Cascadia Code', 'Cascadia Mono']);
add('Belleve Invis', 'https://github.com/be5invis/Iosevka', 'OFL', ['Iosevka']);
add('Eigil Nikolajsen', 'https://commitmono.com', 'OFL', ['Commit Mono']);
add('Helena Zhang', 'https://departuremono.com', 'OFL', ['Departure Mono']);

/** A font we know about by name. Longer names win ("GT America Mono" over "GT America"). */
export function knownFont(family: string): KnownFont | null {
  const s = squash(family);
  const exact = KNOWN.get(s);
  if (exact) return exact;
  let best: [string, KnownFont] | null = null;
  for (const [k, v] of KNOWN) {
    if (k.length >= 4 && s.startsWith(k) && (!best || k.length > best[0].length)) best = [k, v];
  }
  return best ? best[1] : null;
}

/** Licence type for the badge, from a known-font entry. */
export function licenceTypeFor(k: KnownFont): LicenseType {
  if (k.licence === 'OFL') return 'OFL';
  if (k.licence === 'fontshare') return 'free-other';
  return 'commercial';
}

export function summaryFor(type: LicenseType, known: KnownFont | null, source: string): LicenceSummary {
  if (known?.licence === 'apple') {
    return {
      ...SUMMARIES.commercial,
      name: 'Apple font licence',
      short: 'Apple licenses this font for designing and building apps for Apple platforms. Other uses are not covered.',
      url: known.url,
      uses: { web: { a: 'no' }, print: { a: 'check' }, apps: { a: 'conditions', note: 'Apps for Apple platforms.' }, logos: { a: 'no' }, modify: { a: 'no' }, sell: { a: 'no' } },
      notes: [],
    };
  }
  if (known?.licence === 'fontshare') return SUMMARIES.fontshare;
  if (type === 'OFL' || type === 'APACHE' || type === 'UFL') return SUMMARIES[type];
  if (type === 'commercial') return { ...SUMMARIES.commercial, url: known?.url ?? null };
  if (source === 'adobe') return SUMMARIES.adobe;
  if (type === 'system') return SUMMARIES.system;
  return SUMMARIES.unknown;
}

export const ALLOWED_LABEL: Record<Allowed, string> = {
  yes: 'Yes',
  conditions: 'Yes, with conditions',
  licence: 'Licence needed',
  check: 'Check the licence',
  no: 'No',
  unknown: 'Unknown',
};
