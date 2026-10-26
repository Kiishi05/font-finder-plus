import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Tell the background the panel is open. When the panel closes the port drops,
// and the background turns the hover card off in this window.
function connectPanel() {
  if (new URLSearchParams(location.search).get('tab')) return; // test page, not a real panel
  chrome.windows.getCurrent().then((w) => {
    const port = chrome.runtime.connect({ name: `ffp-panel:${w.id}` });
    // The background can restart; reconnect so it keeps knowing the panel is open.
    port.onDisconnect.addListener(() => setTimeout(connectPanel, 300));
  });
}
connectPanel();

createRoot(document.getElementById('root')!).render(<App />);
