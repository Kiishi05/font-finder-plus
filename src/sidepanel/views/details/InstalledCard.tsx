import { useEffect, useState } from 'react';
import { installedFaces, localFontAccessAvailable, quickInstalled, type InstalledFace } from '../../lib/installed';

export function InstalledCard({ family, onFaces }: { family: string; onFaces: (faces: InstalledFace[]) => void }) {
  const [quick, setQuick] = useState<boolean | null>(null);
  const [faces, setFaces] = useState<InstalledFace[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setQuick(quickInstalled(family));
    setFaces(null);
    setError(null);
  }, [family]);

  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      const list = await installedFaces(family);
      setFaces(list);
      onFaces(list);
    } catch (err) {
      setError(err instanceof DOMException && err.name === 'NotAllowedError'
        ? 'Chrome did not allow access to installed fonts. You can allow it in the site settings for this extension.'
        : 'Chrome could not list installed fonts here.');
    } finally {
      setBusy(false);
    }
  };

  const installed = faces ? faces.length > 0 : quick;
  return (
    <section className="section">
      <div className="sechead"><h2>On this computer</h2><span className={`count dinst${installed ? ' on' : ''}`}><i />{installed ? 'Installed' : 'Not installed'}</span></div>
      <p className="sub">
        {installed ? `${family} is installed, so you can use it in design apps on this computer.` : `${family} is not installed on this computer.`}
      </p>
      {faces && faces.length > 0 && (
        <div className="chips">
          {faces.map((f) => <span key={f.postscriptName} className="chip">{f.style}</span>)}
        </div>
      )}
      {localFontAccessAvailable() ? (
        <div className="dfoot">
          <button className="btn sm" onClick={check} disabled={busy}>{busy ? 'Checking…' : faces ? 'Check again' : 'Show installed styles'}</button>
          <span className="dnote">Chrome asks once for access to your installed fonts. Nothing leaves this computer.</span>
        </div>
      ) : (
        <p className="dnote">This version of Chrome cannot list installed styles, so only a quick yes or no is shown.</p>
      )}
      {error && <p className="err" style={{ margin: 0, fontSize: 12.5 }}>{error}</p>}
    </section>
  );
}
