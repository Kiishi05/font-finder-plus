# Font Finder Plus accuracy

Version 0.1.0, measured 2026-11-13. Rerun with `npm run accuracy` (also runs before every `npm run package`).

## Identifying a font in an image

A sentence is drawn as a picture in 50 popular Google Fonts families at three qualities, then run through the same steps as the extension: text recognition, cutting out letters, and matching against ~1,900 Google Fonts families on this computer. A family whose letters are the same drawings (for example Inter and Inter Tight) counts as right.

| Picture | Right font first | In the top 5 |
|---|---|---|
| Clean, large text (64px) | 48 of 50 (96%) | 48 of 50 (96%) |
| Small text (22px) | 42 of 50 (84%) | 46 of 50 (92%) |
| Blurry, compressed photo-like (40px, blur, JPEG 50%) | 34 of 50 (68%) | 40 of 50 (80%) |
| **All** | **124 of 150 (83%)** | **134 of 150 (89%)** |

Results labelled **"Likely this font"** (score 80 or more, or 60 or more with a 5-point lead): 74 of 150 pictures, right in 74 of 74 (100%).

Not found in the top 5:

- Montserrat (rough): read "Quick brown foxes jump over lazy dogs", closest Alexandria 62, Gantari 58, Readex Pro 58
- Lora (rough): read "Quick brown foxes jump over lazy dogs", closest Averia Libre 59, Charis SIL 59, Headland One 59
- PT Serif (rough): read "Quick brown foxes jump over lazy dogs", closest Asap Sharp 79, Asap 77, Carlito 76
- Pacifico (clean): read "", closest none
- Pacifico (small): read "", closest none
- Pacifico (rough): read "Quick Brown foxes jump over lazy dogs", closest Edu TAS Beginner 0, Kavoon 0, Edu SA Beginner 0
- Lobster (clean): read "Quick brown foxes jump over lazy dogs", closest Fruktur 0, Agbalumo 0, Kavoon 0
- Lobster (small): read "‘Quick brown foxes jump over lazy dogs", closest Kavoon 0, Fruktur 0, Amaranth 0
- Lobster (rough): read "Quick brown foxes jump over lazy dogs", closest Chela One 0, Spicy Rice 0, Kavoon 0
- Dancing Script (small): read "Quich brown foxes jump ser lagy dogs", closest Belanosima 0, Martian Mono 0, Sono 0
- Dancing Script (rough): read "Quick brown fsxes jump sver lazy dsgs", closest Rubik Glitch 0, Fascinate 0, Oleo Script 0
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
| How the page draws it | 25 of 30 (83%) | 28 of 30 (93%) |

| Font | Should find | Rank (files) | Top 3 found |
|---|---|---|---|
| Liberation Sans | Arimo | 1 | Arimo 100, Archivo 79, Strichpunkt Sans 78 |
| Liberation Serif | Tinos | 1 | Tinos 100, Charis SIL 78, STIX Two Text 75 |
| Liberation Mono | Cousine | 1 | Cousine 100, Fragment Mono 80, Roboto Mono 77 |
| FreeSans (Helvetica copy) | Arimo | 1 | Arimo 84, Almarai 83, Strichpunkt Sans 78 |
| FreeSerif (Times copy) | Tinos or STIX Two Text | 1 | STIX Two Text 82, Charis SIL 77, Libertinus Serif 73 |
| FreeMono (Courier copy) | Courier Prime | 1 | Courier Prime 75, Cutive Mono 54, Libertinus Mono 45 |
| Carlito (Calibri metrics) | Lato | 1 | Lato 84, Source Sans 3 77, Commissioner 76 |
| Noto Sans | Open Sans | 1 | Open Sans 95, Lunasima 93, AR One Sans 87 |
| Open Sans | Noto Sans | 1 | Noto Sans 95, Noto Sans Display 89, Lunasima 82 |
| Public Sans | Libre Franklin | 1 | Libre Franklin 88, Special Gothic 81, Hanken Grotesk 77 |
| Libre Franklin | Public Sans | 1 | Public Sans 88, Special Gothic 82, Zalando Sans 77 |
| Heebo (Roboto Latin) | Roboto | 1 | Roboto 100, Roboto Flex 95, Vazirmatn 95 |
| Yantramanav (Roboto Latin) | Roboto or Heebo | 1 | Roboto 85, Heebo 85, Roboto Flex 82 |
| Assistant (Source Sans Latin) | Source Sans 3 | 2 | Varta 100, Source Sans 3 97, Alegreya Sans 77 |
| Cairo (Titillium Latin) | Titillium Web | 1 | Titillium Web 100, Exo 81, Open Sans 75 |
| Readex Pro (Lexend) | Lexend | 1 | Lexend 92, Funnel Sans 83, Figtree 81 |
| Crimson Pro | Crimson Text | 11 | Yrsa 79, Ancizar Serif 78, Gentium Book Plus 76 |
| Crimson Text | Crimson Pro | 10 | Amiri 89, Libertinus Serif 80, Average 79 |
| Fira Code | Fira Mono | 1 | Fira Mono 100, Noto Sans Mono 83, Oxygen Mono 80 |
| PT Sans Caption | PT Sans | 3 | Golos Text 83, AR One Sans 79, PT Sans 78 |
| PT Serif Caption | PT Serif | 1 | PT Serif 82, Tienne 79, Source Serif 4 76 |
| Ubuntu Sans | Ubuntu | 1 | Ubuntu 93, Encode Sans 75, Encode Sans Semi Expanded 74 |
| Roboto Flex | Roboto | 1 | Roboto 95, Heebo 95, Vazirmatn 90 |
| Atkinson Hyperlegible Next | Atkinson Hyperlegible | 1 | Atkinson Hyperlegible 97, SN Pro 79, TikTok Sans 77 |
| Lato | Carlito | 2 | Commissioner 87, Carlito 84, Open Sans 76 |
| Titillium Web | Cairo | 1 | Cairo 95, Exo 82, Open Sans 75 |
| Source Sans 3 | Assistant or Varta | 1 | Varta 99, Assistant 92, Basic 82 |
| Lexend | Readex Pro | 1 | Readex Pro 87, Be Vietnam Pro 80, Inclusive Sans 77 |
| Fira Mono | Fira Code | 1 | Fira Code 100, Noto Sans Mono 83, Oxygen Mono 80 |
| Inter Tight | Inter | 1 | Inter 98, TikTok Sans 90, Roboto 88 |

## What this does not measure

- Paid fonts in images: the extension only knows free Google Fonts by shape, plus the fonts of the page you are on. For a paid font it finds the closest free ones, not the font itself.
- Joined-up script lettering (Lobster, Pacifico, Dancing Script): letters touch and cannot be cut apart, so these usually fail.
- Photos taken at an angle, unusual colours or very short text. The pictures here are drawn, not photographed.
- Fonts on web pages are read from the page itself (the font the browser actually used), so they are not part of this test.
