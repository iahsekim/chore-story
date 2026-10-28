// Feedback from the app (Settings > Contact & feedback, the chat button, "Feedback" on the sign-in screen):
// emails it to the owner through Resend, the same way the member alerts go out.
// The reply-to is the sender's email when they typed one, so replying in your inbox answers them.
//
// Environment variables in Netlify (already set for invites and member alerts):
//   RESEND_API_KEY   the Resend key
//   NOTIFY_EMAIL     where feedback goes (comma-separate for more than one)
// Optional: FEEDBACK_EMAIL (send feedback somewhere other than NOTIFY_EMAIL),
//           NOTIFY_FROM (default "Paper Pig <noreply@paperpig.app>").

const FROM = process.env.NOTIFY_FROM || 'Paper Pig <noreply@paperpig.app>';
const TYPES = ['Report a bug', 'Request a feature', 'Say hi'];

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clip = (s, n) => String(s ?? '').trim().slice(0, n);
const isEmail = s => /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/.test(s);

exports.handler = async (event) => {
  try { return await run(event) } catch (e) { console.error('feedback crashed', e); return json(500, { error: 'crash' }) }
};

async function run(event) {
  const env = process.env;
  const to = (env.FEEDBACK_EMAIL || env.NOTIFY_EMAIL || '').split(',').map(s => s.trim()).filter(Boolean);
  // A plain visit (GET) only reports whether email is set up, so it's easy to check from a browser.
  if (event.httpMethod === 'GET') return json(200, { email: !!(to.length && env.RESEND_API_KEY) });
  if (event.httpMethod !== 'POST') return json(405, { error: 'method' });

  // Only this site's pages send feedback (paperpig.app, Netlify previews, a local copy).
  const h = event.headers || {};
  const from = h.origin || h.Origin || h.referer || h.Referer || '';
  let host = '';
  try { host = new URL(from).hostname } catch (e) { }
  if (from && !/(^|\.)paperpig\.app$|\.netlify\.app$|^localhost$|^127\.0\.0\.1$/.test(host)) return json(403, { error: 'origin' });

  let m = {};
  try { m = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : (event.body || '{}')) } catch (e) { return json(400, { error: 'body' }) }
  if (m.website) return json(200, { ok: true }); // the hidden honeypot field: a bot filled it in
  const p = {
    type: TYPES.includes(m.type) ? m.type : 'Say hi',
    message: clip(m.message, 2000), email: clip(m.email, 254), page: clip(m.page, 60), app: clip(m.app, 200),
  };
  if (p.message.length < 3) return json(400, { error: 'message' });
  const reply = isEmail(p.email) ? p.email : '';

  if (!to.length || !env.RESEND_API_KEY) { console.error('feedback: email is not set up (NOTIFY_EMAIL / RESEND_API_KEY)'); return json(503, { error: 'not set up' }) }

  const when = new Date().toLocaleString('en-US', { timeZone: 'America/Denver', dateStyle: 'medium', timeStyle: 'short' }) + ' (Mountain)';
  const first = p.message.split('\n')[0].slice(0, 60);
  const subject = `Paper Pig ${p.type === 'Report a bug' ? 'bug' : p.type === 'Request a feature' ? 'feature idea' : 'message'}: ${first}${p.message.length > first.length ? '…' : ''}`;
  const rows = [['From', reply || (p.email ? `${p.email} (not a valid email)` : 'No email given')], ['Screen', p.page || '—'], ['Sent', when], ['Device', p.app || '—']];
  const text = `${p.type}\n\n${p.message}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}${reply ? '\n\nReply to this email to answer them.' : ''}`;
  const html = `<!doctype html><html><body style="margin:0;background:#FFF0F3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#14101A">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px">
    <div style="background:#fff;border:4px solid #000;border-radius:20px;padding:26px 24px">
      <p style="margin:0 0 6px;font-size:14px;font-weight:600;color:#C70F48">Paper Pig feedback</p>
      <h1 style="margin:0 0 14px;font-size:24px;line-height:1.2">${esc(p.type)}</h1>
      <p style="margin:0 0 18px;font-size:16px;line-height:1.55;white-space:pre-wrap">${esc(p.message)}</p>
      <table style="border-collapse:collapse;font-size:14px;line-height:1.4">${rows.map(([k, v]) => `<tr><td style="padding:4px 14px 4px 0;color:#6B5C66;vertical-align:top">${k}</td><td style="padding:4px 0;font-weight:600">${esc(v)}</td></tr>`).join('')}</table>
      ${reply ? `<p style="margin:18px 0 0;font-size:14px;color:#6B5C66">Reply to this email to answer them.</p>` : ''}
    </div>
  </div></body></html>`;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to, subject, html, text, ...(reply ? { reply_to: reply } : {}) }),
  });
  if (!r.ok) { const t = (await r.text()).slice(0, 200); console.error('feedback: Resend failed', r.status, t); return json(502, { error: 'send', status: r.status }) }
  return json(200, { ok: true });
}
