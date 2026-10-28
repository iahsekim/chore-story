// Tells the owner when someone joins Paper Pig: an email, and a new row in the members Google Sheet.
// The database calls this (supabase/schema.sql, "new member alerts") every time a parent joins: a new family,
// or a parent/guardian accepting an invite. Nobody else can call it: the request has to carry the shared secret.
//
// Environment variables in Netlify (Site configuration > Environment variables, scope: Functions):
//   JOINED_HOOK_SECRET  the shared secret; the same text is saved in Supabase Vault as pp_hook_secret
//   NOTIFY_EMAIL        where the "someone joined" email goes (comma-separate for more than one)
//   SHEET_WEBHOOK_URL   the Google Apps Script web app URL of the members sheet (tools/members-sheet.gs)
//   SHEET_URL           optional: the sheet's own link, shown as a button in the email
//   RESEND_API_KEY      already set for invites
// Optional: NOTIFY_FROM (default "Paper Pig <noreply@paperpig.app>").

const crypto = require('crypto');
const FROM = process.env.NOTIFY_FROM || 'Paper Pig <noreply@paperpig.app>';

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y) };
const clip = (s, n) => String(s ?? '').slice(0, n);

exports.handler = async (event) => {
  try { return await run(event) } catch (e) { console.error('joined crashed', e); return json(500, { error: 'crash', detail: String(e && e.message || e) }) }
};

async function run(event) {
  const env = process.env;
  // A plain visit (GET) only reports what is set up, so it's easy to check from a browser.
  if (event.httpMethod === 'GET') return json(200, { secret: !!env.JOINED_HOOK_SECRET, email: !!(env.NOTIFY_EMAIL && env.RESEND_API_KEY), sheet: !!env.SHEET_WEBHOOK_URL });
  if (event.httpMethod !== 'POST') return json(405, { error: 'method' });
  const secret = env.JOINED_HOOK_SECRET;
  const h = event.headers || {};
  if (!secret || !same(h['x-pp-hook'] || h['X-Pp-Hook'] || '', secret)) return json(401, { error: 'secret' });

  let m = {};
  try { m = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : (event.body || '{}')) } catch (e) { return json(400, { error: 'body' }) }
  const p = {
    kind: m.kind === 'joined a family' ? 'joined a family' : 'new family',
    email: clip(m.email, 254), user_id: clip(m.user_id, 64), family: clip(m.family, 80) || 'A family', family_id: clip(m.family_id, 64),
    members: Number(m.members) || 1, timezone: clip(m.timezone, 64), joined_at: clip(m.joined_at, 40) || new Date().toISOString(), backfill: !!m.backfill,
  };
  const out = { email: 'skipped', sheet: 'skipped' };

  // 1. the sheet (every member, including the ones added later with the backfill query)
  if (env.SHEET_WEBHOOK_URL) {
    try {
      const r = await fetch(env.SHEET_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...p, secret }), redirect: 'follow' });
      const t = (await r.text()).trim();
      out.sheet = r.ok && /^(ok|dup)/.test(t) ? t : `failed ${r.status} ${t.slice(0, 120)}`;
    } catch (e) { out.sheet = 'failed ' + (e && e.message) }
  }

  // 2. the email (not for backfilled members: they joined before alerts existed)
  if (!p.backfill && env.NOTIFY_EMAIL && env.RESEND_API_KEY) {
    const when = new Date(p.joined_at);
    const whenText = isNaN(when) ? p.joined_at : when.toLocaleString('en-US', { timeZone: 'America/Denver', dateStyle: 'medium', timeStyle: 'short' }) + ' (Mountain)';
    const subject = p.kind === 'new family' ? `New on Paper Pig: ${p.family}` : `${p.email} joined ${p.family} on Paper Pig`;
    const lead = p.kind === 'new family' ? 'A new family just signed up.' : `A parent/guardian accepted an invite. ${p.family} now has ${p.members} parents.`;
    const rows = [['Email', p.email], ['Family', p.family], ['Joined', whenText], ['Time zone', p.timezone]];
    const text = `${lead}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}${env.SHEET_URL ? `\n\nAll members: ${env.SHEET_URL}` : ''}`;
    const html = `<!doctype html><html><body style="margin:0;background:#FFF0F3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#14101A">
  <div style="max-width:480px;margin:0 auto;padding:32px 20px">
    <div style="background:#fff;border:4px solid #000;border-radius:20px;padding:26px 24px">
      <p style="margin:0 0 6px;font-size:14px;font-weight:600;color:#C70F48">Paper Pig</p>
      <h1 style="margin:0 0 12px;font-size:24px;line-height:1.2">${p.kind === 'new family' ? `New family: ${esc(p.family)}` : `${esc(p.family)} has a new parent`}</h1>
      <p style="margin:0 0 16px;font-size:16px;line-height:1.5">${esc(lead)}</p>
      <table style="border-collapse:collapse;font-size:15px;line-height:1.4">${rows.map(([k, v]) => `<tr><td style="padding:4px 14px 4px 0;color:#6B5C66">${k}</td><td style="padding:4px 0;font-weight:600">${esc(v)}</td></tr>`).join('')}</table>
      ${env.SHEET_URL ? `<p style="margin:20px 0 0"><a href="${esc(env.SHEET_URL)}" style="display:inline-block;background:#FC3067;color:#fff;text-decoration:none;font-weight:700;font-size:16px;padding:12px 20px;border:4px solid #000;border-radius:14px">See all members</a></p>` : ''}
    </div>
  </div></body></html>`;
    try {
      const to = env.NOTIFY_EMAIL.split(',').map(s => s.trim()).filter(Boolean);
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM, to, subject, html, text, ...(p.email ? { reply_to: p.email } : {}) }),
      });
      out.email = r.ok ? 'sent' : `failed ${r.status} ${(await r.text()).slice(0, 160)}`;
    } catch (e) { out.email = 'failed ' + (e && e.message) }
  }

  if (/^failed/.test(out.email) || /^failed/.test(out.sheet)) console.error('joined', out);
  return json(200, out);
}
