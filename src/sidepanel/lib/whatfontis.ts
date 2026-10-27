// Optional exact match from WhatFontIs, with the person's own API key. Called
// only when they click; the image is sent to whatfontis.com.

export interface WfiResult { title: string; url: string | null; image: string | null }

export async function askWhatFontIs(key: string, image: HTMLCanvasElement): Promise<WfiResult[]> {
  const origin = 'https://www.whatfontis.com/*';
  const allowed = (await chrome.permissions.contains({ origins: [origin] })) || (await chrome.permissions.request({ origins: [origin] }));
  if (!allowed) throw new Error('Chrome needs permission to contact whatfontis.com.');
  const base64 = image.toDataURL('image/png').split(',')[1];
  const body = new URLSearchParams({
    API_KEY: key,
    IMAGEBASE64: '1',
    NOTTEXTBOXSDETECTION: '0',
    FREEFONTS: '0',
    urlimage: '',
    urlimagebase64: base64,
    limit: '10',
  });
  const res = await fetch('https://www.whatfontis.com/api2/', { method: 'POST', body, credentials: 'omit' });
  const text = await res.text();
  if (!res.ok) throw new Error(`WhatFontIs answered ${res.status}: ${text.slice(0, 160)}`);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`WhatFontIs said: ${text.slice(0, 200)}`);
  }
  if (!Array.isArray(data)) throw new Error(`WhatFontIs said: ${JSON.stringify(data).slice(0, 200)}`);
  return data
    .map((d: Record<string, unknown>) => ({ title: String(d.title ?? ''), url: typeof d.url === 'string' ? d.url : null, image: typeof d.image === 'string' ? d.image : null }))
    .filter((d) => d.title);
}
