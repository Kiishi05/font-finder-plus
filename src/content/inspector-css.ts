// Styles for the on-page tooltip. It lives in a closed shadow root so the page
// cannot restyle it. Colours follow the V6 design (white card, ink, green signal).
export const css = `
:host { all: initial; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.hl {
  position: fixed; left: 0; top: 0; pointer-events: none;
  border: 2px solid #19C05A; border-radius: 6px;
  box-shadow: 0 0 0 4px rgba(25,192,90,0.18);
  transition: transform 60ms linear, width 60ms linear, height 60ms linear;
}
.marks .mark {
  position: fixed; left: 0; top: 0; pointer-events: none;
  border: 2px solid #19C05A; border-radius: 4px; background: rgba(25,192,90,0.16);
  animation: ffp-pop 240ms ease-out;
}
@keyframes ffp-pop { from { opacity: 0; } }
.card {
  position: fixed; left: 0; top: 0; width: 312px;
  display: flex; flex-direction: column; gap: 10px; padding: 12px;
  border-radius: 18px; background: #FFFFFF; color: #111111;
  font: 12.5px/1.4 "FFP Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
  box-shadow: 0 1px 2px rgba(0,0,0,0.06), 0 18px 44px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.04);
  pointer-events: none;
}
.card.pinned { pointer-events: auto; box-shadow: 0 0 0 2px #111111, 0 18px 44px rgba(0,0,0,0.2); }
.head { display: flex; align-items: center; gap: 6px; padding: 0 2px 0 4px; }
.head .tools { display: flex; align-items: center; gap: 6px; flex: none; }
.titles { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.name { font-size: 20px; line-height: 1.1; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; color: #111111; }
.meta { font: 9.5px/1.5 "FFP JetBrains Mono", ui-monospace, monospace; color: #5C5C5A; letter-spacing: 0.02em; }
.fallback { font-size: 11px; color: #7A4E00; }
.chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 99px; font-size: 11px; font-weight: 600; white-space: nowrap; }
.chip .dot { width: 6px; height: 6px; border-radius: 50%; }
.chip.free { background: #E8F8EE; color: #0B7A37; } .chip.free .dot { background: #19C05A; }
.chip.warn { background: #FFF3DA; color: #7A4E00; } .chip.warn .dot { background: #E39B12; }
.chip.neutral { background: #F2F2F0; color: #5C5C5A; } .chip.neutral .dot { background: #A8A8A4; }
button { font: inherit; color: inherit; cursor: pointer; }
button:focus-visible { outline: 2px solid #111111; outline-offset: 2px; }
.iconbtn { width: 30px; height: 30px; border-radius: 9px; border: none; background: #F2F2F0; color: #111111; display: inline-flex; align-items: center; justify-content: center; flex: none; }
.iconbtn.on { background: #111111; color: #FFFFFF; }
.metrics { width: 288px; height: 104px; display: block; }
.rows { display: flex; flex-direction: column; }
.row {
  display: grid; grid-template-columns: 88px 1fr auto; align-items: center; gap: 8px;
  height: 30px; padding: 0 8px; border: none; border-radius: 9px; background: transparent; text-align: left;
}
.row:hover { background: #F4F4F3; }
.row .k { color: #5C5C5A; }
.row .v { display: flex; align-items: center; gap: 6px; font: 11.5px "FFP JetBrains Mono", ui-monospace, monospace; color: #111111; white-space: nowrap; overflow: hidden; }
.row .s { display: inline-flex; align-items: center; gap: 4px; color: #A8A8A4; font-size: 11px; font-weight: 600; }
.row.copied { background: #E8F8EE; }
.row.copied .s { color: #0B7A37; }
.sw { width: 10px; height: 10px; border-radius: 3px; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.12); flex: none; }
.foot { display: flex; gap: 6px; }
.btn { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 34px; border-radius: 10px; border: 1px solid #DCDCDA; background: #FFFFFF; color: #111111; font-size: 12px; font-weight: 500; }
.btn.primary { border: none; background: #111111; color: #FFFFFF; }
.btn.done { background: #E8F8EE; color: #0B7A37; border-color: #E8F8EE; }
.bar {
  position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%);
  display: inline-flex; align-items: center; gap: 10px; height: 40px; padding: 0 5px 0 14px;
  border-radius: 14px; background: #111111; color: #FFFFFF; white-space: nowrap;
  font: 12px "FFP Inter", system-ui, sans-serif; box-shadow: 0 8px 24px rgba(0,0,0,0.22); pointer-events: auto;
}
.bar .live { width: 8px; height: 8px; border-radius: 50%; background: #19C05A; box-shadow: 0 0 0 3px rgba(25,192,90,0.25); flex: none; }
.bar .keys { color: #A8A8A4; }
.bar kbd { padding: 1px 6px; border-radius: 5px; background: #2A2A2A; color: #FFFFFF; font: 10.5px "FFP JetBrains Mono", ui-monospace, monospace; }
.bar .stop { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border: none; border-radius: 10px; background: #FFFFFF; color: #111111; font-size: 12px; font-weight: 600; }
@media (max-width: 640px) { .bar .keys { display: none; } }
.flag {
  position: fixed; left: 50%; top: 14px; transform: translateX(-50%);
  padding: 7px 12px; border-radius: 10px; background: #19C05A; color: #04210F;
  font: 600 12px "FFP Inter", system-ui, sans-serif; box-shadow: 0 6px 18px rgba(0,0,0,0.18);
}
@media (prefers-reduced-motion: reduce) { .hl { transition: none; } .marks .mark { animation: none; } }
`;
