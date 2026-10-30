// Update prompt: the server compares version.txt with GitHub on start; when GitHub is newer the page asks
// before downloading. "Later" hides it for that version until the next session.
const dialog = document.getElementById('update-dialog');
const status = await fetch('/api/update').then(r => r.json()).catch(() => null);
const skipKey = 'codex-update-skip';
let skipped = null;
try { skipped = sessionStorage.getItem(skipKey); } catch {}

if (status?.available && skipped !== status.remote) {
  document.getElementById('update-versions').textContent = `${status.local} → ${status.remote}`;
  const msg = document.getElementById('update-msg'), go = document.getElementById('update-go'), later = document.getElementById('update-later');
  later.onclick = () => { try { sessionStorage.setItem(skipKey, status.remote); } catch {} dialog.close(); };
  go.onclick = async () => {
    go.disabled = later.disabled = true;
    msg.textContent = 'Downloading and installing… the workshop restarts when done.';
    const r = await fetch('/api/update', { method: 'POST' }).then(r => r.json()).catch(() => ({ error: 'Connection lost.' }));
    if (r.error) { msg.textContent = r.error; later.disabled = false; return; }
    msg.textContent = `Installed ${status.remote}. Restarting…`;
    // Wait for the restarted server, then reload onto the new files.
    for (let i = 0; i < 60; i++) {
      await new Promise(res => setTimeout(res, 1000));
      const v = await fetch('/api/health', { cache: 'no-store' }).then(r => r.json()).catch(() => null);
      if (v?.version === status.remote) return location.reload();
    }
    msg.textContent = 'The server did not come back; start it again with npm.cmd start.';
  };
  dialog.showModal();
}
