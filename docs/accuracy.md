# Font Finder Plus accuracy

Version 0.1.0, measured 2026-11-14. Rerun with `npm run accuracy` (also runs before every `npm run package`).

## Identifying a font in an image

A sentence is drawn as a picture in 50 popular Google Fonts families at three qualities, then run through the same steps as the extension: text recognition, cutting out letters, and matching against ~1,900 Google Fonts families on this computer. A family whose letters are the same drawings (for example Inter and Inter Tight) counts as right.

| Picture | Right font first | In the top 5 |
|---|---|---|
| Clean, large text (64px) | 48 of 50 (96%) | 48 of 50 (96%) |
| Small text (22px) | 42 of 50 (84%) | 46 of 50 (92%) |
| Blurry, compressed photo-like (40px, blur, JPEG 50%) | 34 of 50 (68%) | 40 of 50 (80%) |
| **All** | **124 of 150 (83%)** | **134 of 150 (89%)** |

Results labelled **"Likely this font"** (score 80 or more, or 60 or more with a 5-point lead): 76 of 150 pictures, right in 76 of 76 (100%).

Not found in the top 5:

- Montserrat (rough): read "Quick brown foxes jump over lazy dogs", closest Alexandria 62, Readex Pro 58, Gantari 58
- Lora (rough): read "Quick brown foxes jump over lazy dogs", closest Merriweather Sans 58, Averia Libre 59, Charis SIL 59
- PT Serif (rough): read "Quick brown foxes jump over lazy dogs", closest Asap Sharp 79, Asap 77, Lato 75
- Pacifico (clean): read "Quick Brown foxes jump over lazy dogs", closest Oleo Script 0, Oleo Script Swash Caps 0, Kavoon 0
- Pacifico (small): read "", closest none
- Pacifico (rough): read "Quick Brown foxes jump over lazy dogs", closest Edu TAS Beginner 0, Kavoon 0, Edu SA Beginner 0
- Lobster (clean): read "Quick brown foxes jump over lazy dogs", closest Fruktur 0, Amaranth 0, Agbalumo 0
- Lobster (small): read "‘Quick brown foxes jump over lazy dogs", closest Spicy Rice 0, Kavoon 0, Fruktur 0
- Lobster (rough): read "Quick brown foxes jump over lazy dogs", closest Chela One 0, Spicy Rice 0, Kavoon 0
- Dancing Script (small): read "Quich brown foxes jump ser lagy dogs", closest Passion One 0, Belanosima 0, Martian Mono 0
- Dancing Script (rough): read "Quick brown fsxes jump sver lazy dsgs", closest Rubik Glitch 0, Fascinate 0, Alfa Slab One 0
- Crimson Text (rough): read "Quick brown foxes jump over lazy dogs", closest Averia Serif Libre 63, Averia Libre 61, Charis SIL 61
- EB Garamond (rough): read "Quick brown foxes jump over lazy dogs", closest Ysabeau Office 43, Ysabeau Infant 42, GFS Neohellenic 42
- Cormorant Garamond (small): read "Quick brown foxes jump over lazy dogs", closest Spectral 16, Bellefair 16, Ysabeau Office 16
- Cormorant Garamond (rough): read "Quick brown foxes jump over lazy dogs", closest Dosis 0, Ysabeau Office 0, Quattrocento Sans 0
- Spectral (rough): read "Quick brown foxes jump over lazy dogs", closest Dosis 73, Quattrocento Sans 72, Capriola 72

## Free look-alikes (Make it free, Similar fonts, Figma stand-ins)

Fonts whose right free answer is known: copies of famous fonts that ship with Linux (Helvetica, Times, Courier, Arial, Calibri) and Google Fonts families built from another (Public Sans from Libre Franklin, Noto Sans from Open Sans, Heebo from Roboto...).

| Measured from | Right family first | In the top 3 |
|---|---|---|
| Font files | 25 of 30 (83%) | 28 of 30 (93%) |
| How the page draws it | 24 of 30 (80%) | 29 of 30 (97%) |

| Font | Should find | Rank (files) | Top 3 found |
|---|---|---|---|
| Liberation Sans | Arimo | 1 | Arimo 100, Switzer 77, Archivo 74 |
| Liberation Serif | Tinos | 1 | Tinos 100, STIX Two Text 68, Charis SIL 68 |
| Liberation Mono | Cousine | 1 | Cousine 93, Roboto Mono 66, Fragment Mono 61 |
| FreeSans (Helvetica copy) | Arimo | 2 | Almarai 85, Arimo 74, Switzer 72 |
| FreeSerif (Times copy) | Tinos or STIX Two Text | 1 | STIX Two Text 78, Charis SIL 69, Libertinus Serif 63 |
| FreeMono (Courier copy) | Courier Prime | 1 | Courier Prime 54, Cutive Mono 35, Libertinus Mono 29 |
| Carlito (Calibri metrics) | Lato | 1 | Lato 84, Open Sans 68, Hind Siliguri 68 |
| Noto Sans | Open Sans | 1 | Open Sans 89, Lunasima 81, Telex 74 |
| Open Sans | Noto Sans | 1 | Noto Sans 89, Noto Sans Display 82, Plein 76 |
| Public Sans | Libre Franklin | 1 | Libre Franklin 75, Geist 70, Special Gothic 67 |
| Libre Franklin | Public Sans | 1 | Public Sans 75, Special Gothic 75, Pontano Sans 66 |
| Heebo (Roboto Latin) | Roboto | 1 | Roboto 100, Vazirmatn 97, Roboto Flex 93 |
| Yantramanav (Roboto Latin) | Roboto or Heebo | 1 | Heebo 85, Roboto 84, Roboto Flex 81 |
| Assistant (Source Sans Latin) | Source Sans 3 | 2 | Varta 98, Source Sans 3 95, IBM Plex Sans 68 |
| Cairo (Titillium Latin) | Titillium Web | 1 | Titillium Web 100, Open Sans 66, Plein 66 |
| Readex Pro (Lexend) | Lexend | 1 | Lexend 85, Funnel Sans 72, Figtree 70 |
| Crimson Pro | Crimson Text | 1 | Crimson Text 70, Yrsa 69, Spectral 68 |
| Crimson Text | Crimson Pro | 5 | Amiri 82, Average 71, Spectral 70 |
| Fira Code | Fira Mono | 1 | Fira Mono 100, Noto Sans Mono 67, Spline Sans Mono 66 |
| PT Sans Caption | PT Sans | 3 | Golos Text 72, Excon 66, PT Sans 64 |
| PT Serif Caption | PT Serif | 4 | Sentient 74, Recia 68, Bespoke Serif 68 |
| Ubuntu Sans | Ubuntu | 1 | Ubuntu 89, Excon 61, Commissioner 58 |
| Roboto Flex | Roboto | 1 | Roboto 93, Heebo 93, Vazirmatn 90 |
| Atkinson Hyperlegible Next | Atkinson Hyperlegible | 1 | Atkinson Hyperlegible 95, Nunito Sans 64, Zalando Sans 64 |
| Lato | Carlito | 1 | Carlito 84, Commissioner 80, Open Sans 70 |
| Titillium Web | Cairo | 1 | Cairo 97, Plein 66, Open Sans 65 |
| Source Sans 3 | Assistant or Varta | 1 | Varta 98, Assistant 92, IBM Plex Sans 72 |
| Lexend | Readex Pro | 1 | Readex Pro 81, Be Vietnam Pro 69, Sen 68 |
| Fira Mono | Fira Code | 1 | Fira Code 100, Noto Sans Mono 67, Spline Sans Mono 65 |
| Inter Tight | Inter | 1 | Inter 96, TikTok Sans 83, Liter 83 |

## What this does not measure

- Paid fonts in images: the extension only knows free Google Fonts by shape, plus the fonts of the page you are on. For a paid font it finds the closest free ones, not the font itself.
- Joined-up script lettering (Lobster, Pacifico, Dancing Script): letters touch and cannot be cut apart, so these usually fail.
- Photos taken at an angle, unusual colours or very short text. The pictures here are drawn, not photographed.
- Fonts on web pages are read from the page itself (the font the browser actually used), so they are not part of this test.
