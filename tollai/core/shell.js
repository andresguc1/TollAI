// Attestation shell served to a browser that navigates to a tolled page
// without a valid session. The human never sees a puzzle: the page quietly
// pays the proof of work in the background and reloads onto real content.
export function createShell({
  scenario = '',
  reloadUrl = '/',
  clientPath = '/tollai/client.js',
} = {}) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TollAI — Verifying</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:#0d1117;color:#e6edf3;font:400 15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  .box{text-align:center;max-width:340px;padding:0 20px}
  .ring{width:34px;height:34px;margin:0 auto 18px;border:3px solid #30363d;border-top-color:#8250df;
    border-radius:50%;animation:spin .8s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  h1{font-size:15px;font-weight:600;margin:0 0 6px}
  p{margin:0;font-size:12.5px;color:#8b949e}
  code{color:#d2a8ff;font-size:11.5px}
</style></head>
<body>
  <div class="box">
    <div class="ring"></div>
    <h1>TollAI</h1>
    <p>Paying the cognitive toll${scenario ? ` for <code>${scenario}</code>` : ''}…</p>
  </div>
  <script>
    window.TOLLAI_RELOAD_URL = ${JSON.stringify(reloadUrl)};
  </script>
  <script src="${clientPath}"></script>
  <script>
    window.TollAI.establish().then(function () { location.reload(); });
  </script>
</body></html>`;
}