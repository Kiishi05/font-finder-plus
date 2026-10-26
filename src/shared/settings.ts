// Settings live in chrome.storage.local only. The Google Fonts API key is never
// written to code, logs or the database.

export interface Settings {
  theme: 'system' | 'light' | 'dark';
  googleFontsApiKey: string;
  tipDismissed: boolean;
  testerText: string;
  testerSize: number;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  googleFontsApiKey: '',
  tipDismissed: false,
  testerText: '',
  testerSize: 32,
};

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  return { ...DEFAULT_SETTINGS, ...stored } as Settings;
}

export async function setSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.local.set(patch);
}

export function onSettingsChanged(cb: (s: Partial<Settings>) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local') return;
    const patch: Partial<Settings> = {};
    for (const [k, v] of Object.entries(changes)) (patch as Record<string, unknown>)[k] = v.newValue;
    cb(patch);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export async function hasAllSitesAccess(): Promise<boolean> {
  return chrome.permissions.contains({ origins: ['<all_urls>'] });
}

/** Must be called from a click handler in an extension page. */
export async function requestAllSitesAccess(): Promise<boolean> {
  return chrome.permissions.request({ origins: ['<all_urls>'] });
}
