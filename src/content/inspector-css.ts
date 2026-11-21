// Styles for the on-page dock, hover card and tips. They live in a closed shadow
// root so the page cannot restyle them. Design: docs/redesign/modern/panel-v3.html
// (dark dock, white card, neutral greys; green only means Free, amber only Paid).
export const css = `
:host { all: initial; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
button { font: inherit; color: inherit; cursor: pointer; border: none; background: none; padding: 0; }
button:focus-visible { outline: 2px solid #2F6BFF; outline-offset: 2px; }
svg { display: block; flex: none; }
.kbd { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 6px; background: #FFFFFF; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.12), 0 1px 0 rgba(0,0,0,0.06); font: 500 10.5px/1 "FFP Geist Mono", ui-monospace, monospace; color: #4F4F4F; vertical-align: middle; }

/* The outline around the text under the pointer */
.hl {
  position: fixed; left: 0; top: 0; pointer-events: none;
  border: 1.5px solid #2F6BFF; border-radius: 4px;
  transition: transform 60ms linear, width 60ms linear, height 60ms linear;
}
.marks .mark {
  position: fixed; left: 0; top: 0; pointer-events: none;
  border: 2px solid #2F6BFF; border-radius: 4px; background: rgba(47,107,255,0.08);
  animation: ffp-pop 240ms ease-out;
}
@keyframes ffp-pop { from { opacity: 0; } }

/* Hover card */
.card {
  position: fixed; left: 0; top: 0; width: 300px;
  display: flex; flex-direction: column; gap: 12px; padding: 14px;
  border-radius: 18px; background: #FFFFFF; color: #161616;
  font: 13px/1.4 "FFP Geist", system-ui, -apple-system, "Segoe UI", sans-serif;
  box-shadow: 0 0 0 1px rgba(0,0,0,0.06), 0 16px 36px rgba(0,0,0,0.14);
  pointer-events: none;
}
.card.pinned { pointer-events: auto; box-shadow: 0 0 0 1.5px #161616, 0 16px 36px rgba(0,0,0,0.16); }
.head { display: flex; align-items: flex-start; gap: 8px; }
.titles { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
.name { font-size: 17px; line-height: 1.15; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; color: #161616; }
.meta { font-size: 12px; color: #7A7A7A; }
.fallback { font-size: 12px; color: #8A5A00; }
.head .tools { display: flex; align-items: center; gap: 6px; flex: none; }
.chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 500; white-space: nowrap; margin-top: 2px; }
.chip .dot { width: 7px; height: 7px; border-radius: 50%; }
.chip.free { color: #0B7A37; } .chip.free .dot { background: #19A35A; }
.chip.warn { color: #8A5A00; } .chip.warn .dot { background: #E39B12; }
.chip.neutral { color: #7A7A7A; } .chip.neutral .dot { background: #A8A8A4; }
.pin { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 8px; border-radius: 8px; background: #161616; color: #FFFFFF; font-size: 11.5px; font-weight: 500; }
.pin:hover { background: #333333; }
.pin svg:last-child { opacity: 0.6; }
.metrics { width: 272px; height: 98px; display: block; }
.rows { display: grid; grid-template-columns: 1fr 1fr; gap: 2px; }
.row { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 3px; min-width: 0; padding: 8px 10px; border-radius: 10px; text-align: left; transition: background 120ms; }
.row .k { font-size: 11.5px; color: #7A7A7A; }
.row .v { display: flex; align-items: center; gap: 6px; max-width: 100%; font: 500 12.5px/1.2 "FFP Geist Mono", ui-monospace, monospace; color: #161616; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row .s { position: absolute; right: 8px; top: 8px; color: #7A7A7A; opacity: 0; transition: opacity 120ms; }
.card.pinned .row:hover { background: #F4F4F3; }
.card.pinned .row:hover .s { opacity: 1; }
.row.copied .v, .row.copied .s { color: #0B7A37; opacity: 1; }
.sw { width: 10px; height: 10px; border-radius: 3px; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.12); flex: none; }
.foot { display: flex; gap: 8px; }
.btn { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 38px; border-radius: 11px; background: #F0F0EE; color: #161616; font-size: 13px; font-weight: 500; white-space: nowrap; transition: background 150ms, transform 140ms cubic-bezier(0.23, 1, 0.32, 1); }
.btn:hover { background: #E6E6E4; }
.btn:active { transform: scale(0.97); }
.btn.primary { background: #161616; color: #FFFFFF; }
.btn.primary:hover { background: #2A2A2A; }
.btn.sq { flex: none; width: 38px; }
.btn.done { color: #0B7A37; }
.btn.primary.done { color: #FFFFFF; }
.hint { margin: -2px 0 0; display: flex; align-items: center; gap: 5px; flex-wrap: wrap; font-size: 12px; color: #7A7A7A; }
.hint.pinme { margin: 0; padding: 10px 12px; border-radius: 11px; background: #F4F4F3; color: #4F4F4F; }
.picnote { display: flex; flex-direction: column; gap: 10px; }
.picnote p { margin: 0; font-size: 13px; color: #4F4F4F; }
.picnote .btn { flex: none; }

/* Dock */
.dock {
  position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%);
  display: flex; align-items: center; gap: 2px; padding: 6px; border-radius: 20px;
  background: #1A1A1A; color: rgba(255,255,255,0.72); pointer-events: auto;
  font: 12px "FFP Geist", system-ui, sans-serif;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06), 0 12px 32px rgba(0,0,0,0.28);
  animation: ffp-dock 320ms cubic-bezier(0.23, 1, 0.32, 1);
}
@keyframes ffp-dock { from { opacity: 0; transform: translate(-50%, 12px); } }
.db { position: relative; width: 42px; height: 42px; border-radius: 14px; display: grid; place-items: center; transition: background 150ms, color 150ms, transform 140ms cubic-bezier(0.23, 1, 0.32, 1); }
.db:hover { background: rgba(255,255,255,0.08); color: #FFFFFF; }
.db:active { transform: scale(0.94); }
.db[aria-pressed="true"] { background: rgba(255,255,255,0.15); color: #FFFFFF; }
.dock .sep { width: 1px; height: 22px; margin: 0 4px; background: rgba(255,255,255,0.14); }
.db .tip {
  position: absolute; bottom: calc(100% + 10px); left: 50%; transform: translateX(-50%) translateY(2px);
  display: flex; align-items: center; gap: 8px; white-space: nowrap; padding: 6px 8px 6px 10px; border-radius: 9px;
  background: #1A1A1A; color: #FFFFFF; font-weight: 500; box-shadow: 0 6px 16px rgba(0,0,0,0.25);
  pointer-events: none; opacity: 0; transition: opacity 120ms, transform 160ms cubic-bezier(0.23, 1, 0.32, 1);
}
.db:hover .tip, .db:focus-visible .tip, .db.saytip .tip { opacity: 1; transform: translateX(-50%); }
.db:hover .tip { transition-delay: 250ms; }
.db.saytip .tip { transition-delay: 0ms; }
.tip .k { font: 500 11px/1 "FFP Geist Mono", ui-monospace, monospace; color: rgba(255,255,255,0.55); padding: 3px 5px; border-radius: 5px; background: rgba(255,255,255,0.1); }

/* First-run tips above the dock */
.coach {
  position: fixed; left: 50%; bottom: 80px; transform: translateX(-50%);
  display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 10px; border-radius: 14px;
  background: #FFFFFF; color: #161616; white-space: nowrap; pointer-events: auto;
  font: 13px/1.3 "FFP Geist", system-ui, sans-serif;
  box-shadow: 0 0 0 1px rgba(0,0,0,0.06), 0 10px 28px rgba(0,0,0,0.14);
  animation: ffp-dock 300ms cubic-bezier(0.23, 1, 0.32, 1);
}
.coach .step { font: 500 11px/1 "FFP Geist Mono", ui-monospace, monospace; color: #7A7A7A; padding: 4px 6px; border-radius: 6px; background: #F0F0EE; }
.coach .ctext { display: inline-flex; align-items: center; gap: 5px; }
.coach .cx { width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; color: #7A7A7A; }
.coach .cx:hover { background: #F0F0EE; }

/* Label for "Show on page" */
.flag {
  position: fixed; left: 50%; top: 14px; transform: translateX(-50%);
  padding: 8px 12px; border-radius: 10px; background: #1A1A1A; color: #FFFFFF;
  font: 500 12.5px "FFP Geist", system-ui, sans-serif; box-shadow: 0 6px 18px rgba(0,0,0,0.18);
}
@media (max-width: 640px) { .coach { white-space: normal; width: calc(100vw - 24px); } }
@media (prefers-reduced-motion: reduce) { .hl { transition: none; } .marks .mark, .dock, .coach { animation: none; } .db .tip { transition: none; } }
`;
