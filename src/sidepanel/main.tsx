import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ShotViewer } from './ShotViewer';
import './styles.css';

// Tell the background the panel is open. When the panel closes the port drops,
// and the background turns the hover card off in this window.
function connectPanel() {
  const q = new URLSearchParams(location.search);
  if (q.get('tab') || q.get('shot')) return; // test page or screenshot viewer, not the side panel
  chrome.windows.getCurrent().then((w) => {
    const port = chrome.runtime.connect({ name: `ffp-panel:${w.id}` });
    // The background can restart; reconnect so it keeps knowing the panel is open.
    port.onDisconnect.addListener(() => setTimeout(connectPanel, 300));
  });
}
connectPanel();

const shot = Number(new URLSearchParams(location.search).get('shot'));
createRoot(document.getElementById('root')!).render(shot ? <ShotViewer id={shot} /> : <App />);
