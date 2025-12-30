#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function generateTemplate(bundleRelPath) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>GitHub Unfollowers</title>
  <meta name="description" content="See who doesn't follow you back on GitHub" />
  <style>
    body{font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; margin:0; padding:24px; background:#0b0b0c; color:#f3f3f4}
    .container{max-width:900px;margin:0 auto}
    h1{font-size:28px;margin:0 0 12px}
    p{color:#b5b5b8}
    .actions{margin:20px 0;display:flex;gap:12px;flex-wrap:wrap}
    button{background:#1f6feb;border:none;color:white;padding:10px 16px;border-radius:8px;cursor:pointer}
    button.secondary{background:#2d2d30}
    code, pre{background:#161617;color:#d1d1d4;border-radius:8px}
    pre{padding:12px;overflow:auto}
    footer{margin-top:40px;color:#8a8a8f;font-size:12px}
  </style>
</head>
<body>
  <div class="container">
    <h1>GitHub Unfollowers</h1>
    <p>Build generated at ${new Date().toISOString()}</p>
    <div class="actions">
      <button id="copyBtn">COPY SCRIPT</button>
      <button class="secondary" id="downloadBtn">DOWNLOAD dist.js</button>
    </div>
    <pre id="preview" hidden></pre>
  </div>
  <script>
    const bundlePath = ${JSON.stringify(bundleRelPath)};
    async function getBundle() {
      const res = await fetch(bundlePath + '?t=' + Date.now());
      if (!res.ok) throw new Error('Failed to load bundle: ' + res.status);
      return await res.text();
    }
    document.getElementById('copyBtn').addEventListener('click', async () => {
      try {
        const text = await getBundle();
        await navigator.clipboard.writeText(text);
        alert('Script copied to clipboard!');
      } catch (e) {
        console.error(e);
        alert('Failed to copy: ' + e.message);
      }
    });
    document.getElementById('downloadBtn').addEventListener('click', async () => {
      try {
        const text = await getBundle();
        const blob = new Blob([text], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'dist.js';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (e) {
        console.error(e);
        alert('Failed to download: ' + e.message);
      }
    });
  </script>
</body>
</html>`;
}

(function main() {
  const [, , htmlPathArg, bundlePathArg] = process.argv;
  const cwd = process.cwd();

  const htmlPath = path.resolve(cwd, htmlPathArg || 'public/index.html');
  const bundlePath = path.resolve(cwd, bundlePathArg || 'dist/dist.js');

  // Compute relative path from html to bundle for the script src/fetch
  const bundleRelPath = path.relative(path.dirname(htmlPath), bundlePath).split(path.sep).join('/');

  ensureDir(htmlPath);

  let html;
  if (fs.existsSync(htmlPath)) {
    try {
      html = fs.readFileSync(htmlPath, 'utf8');
    } catch (_) {
      html = '';
    }
  } else {
    html = '';
  }
  // Heuristics: if the file is empty, very small, or contains a <noscript> placeholder,
  // or lacks our expected UI markers, regenerate fully.
  const hasScriptTag = /<script[^>]+src=["'].*dist\.js["'][^>]*><\/script>/i.test(html);
  const isTiny = (html || '').length < 400; // minimal placeholder is ~200b
  const hasNoScript = /<noscript>/i.test(html || '');
  const hasOurUiMarkers = /COPY SCRIPT|DOWNLOAD dist\.js/i.test(html || '');
  const shouldGenerate = !html || isTiny || hasNoScript || !hasOurUiMarkers || !hasScriptTag;

  if (shouldGenerate) {
    const content = generateTemplate(bundleRelPath);
    fs.writeFileSync(htmlPath, content, 'utf8');
    console.log('[update-index] wrote full template', htmlPath, '->', bundleRelPath);
    return;
  }

  // Otherwise, update only the script src to the right relative bundle path
  const updated = html.replace(/(<script[^>]+src=["'])(.*?dist\.js)(["'][^>]*><\/script>)/i, `$1${bundleRelPath}$3`);
  fs.writeFileSync(htmlPath, updated, 'utf8');
  console.log('[update-index] updated script src', htmlPath, '->', bundleRelPath);
})();
