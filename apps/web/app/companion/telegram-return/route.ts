import { createHash } from "node:crypto";

// Standalone handoff: no application shell, analytics, cookies or network calls.
// The fragment stays in the browser and is immediately removed from history.
const script = `
const fragment = location.hash.slice(1);
history.replaceState(null, '', location.pathname);
const fields = new URLSearchParams(fragment);
const token = fields.get('token');
const proof = fields.get('proof');
const valid = /^[A-Za-z0-9_-]{43}$/;
if ([...fields].length === 2 && token && proof && valid.test(token) && valid.test(proof)) {
  const button = document.getElementById('return');
  button.href = 'murph-messaging://telegram/complete#token=' + token + '&proof=' + proof;
  button.hidden = false;
} else {
  document.getElementById('status').textContent = 'Open Telegram from the Murph app to start a new connection.';
}
`;
const style = `
body{margin:0;background:#f5f0e8;color:#2d3436;font:17px/1.55 system-ui,sans-serif}
main{max-width:480px;margin:12vh auto;padding:28px 24px}
h1{font:34px/1.2 Georgia,serif;margin:0 0 28px}
p{color:#736a58;margin:0 0 28px}
a{display:block;background:#5a6e32;color:#fffcf6;text-align:center;padding:14px 24px;border-radius:20px;text-decoration:none}
a[hidden]{display:none}a:focus-visible{outline:3px solid #2d3436;outline-offset:4px}
`;
const hash = (value: string) => `'sha256-${createHash("sha256").update(value).digest("base64")}'`;

export function GET(): Response {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>Return to Murph</title><style>${style}</style></head><body><main><h1>Return to Murph</h1><p id="status">Continue in the app where you started connecting Telegram.</p><a id="return" hidden>Open Murph</a><noscript>Enable JavaScript to return to Murph.</noscript></main><script>${script}</script></body></html>`, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex, nofollow",
      "x-content-type-options": "nosniff",
      "content-security-policy": `default-src 'none'; script-src ${hash(script)}; style-src ${hash(style)}; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
    },
  });
}
