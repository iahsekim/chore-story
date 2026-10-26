// Sends the "join our family on Paper Pig" email when a parent/guardian adds another one in Settings.
// Needs one environment variable in Netlify: RESEND_API_KEY (a Resend key with sending access to paperpig.app).
// Optional: INVITE_FROM (default "Paper Pig <noreply@paperpig.app>"), SITE_URL (default https://paperpig.app).
// Only the public Supabase URL and publishable key are used. The caller's own sign-in token proves who they are,
// and the database rules only show them invites for their own family, so nobody can send mail for another family.

const SB_URL = process.env.SUPABASE_URL || 'https://wddbtkmtqunsbpfyzkxd.supabase.co';
const SB_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_nvKmj2yOomzogvrTKwXVNw_jr6EZjSG';
const SITE = (process.env.SITE_URL || 'https://paperpig.app').replace(/\/$/, '');
const FROM = process.env.INVITE_FROM || 'Paper Pig <noreply@paperpig.app>';
const MAX_INVITES = 10;

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method' });
  const key = process.env.RESEND_API_KEY;
  if (!key) return json(503, { error: 'not_configured' });
  const auth = req.headers.get('authorization') || '';
  if (!/^Bearer \S+$/.test(auth)) return json(401, { error: 'signin' });
  let email = '';
  try { email = String((await req.json()).email || '').trim().toLowerCase() } catch (e) { }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json(400, { error: 'email' });

  const sb = path => fetch(`${SB_URL}${path}`, { headers: { apikey: SB_KEY, authorization: auth } });
  const who = await sb('/auth/v1/user');
  if (!who.ok) return json(401, { error: 'signin' });
  const me = await who.json();

  // The invite has to exist in the caller's family (row-level security hides every other family's invites).
  const inv = await sb(`/rest/v1/family_invites?select=family_id,email&email=eq.${encodeURIComponent(email)}`);
  const rows = inv.ok ? await inv.json() : [];
  if (!rows.length) return json(404, { error: 'no_invite' });
  const fid = rows[0].family_id;
  const all = await sb(`/rest/v1/family_invites?select=email&family_id=eq.${fid}`);
  if (all.ok && (await all.json()).length > MAX_INVITES) return json(429, { error: 'too_many' });
  const fam = await sb(`/rest/v1/families?select=name&id=eq.${fid}`);
  const family = (fam.ok && (await fam.json())[0]?.name) || 'your family';

  const link = `${SITE}/#invite=${encodeURIComponent(email)}`;
  const from = me.email || 'A parent';
  const subject = `You're invited to ${family} on Paper Pig`;
  const text = `${from} added you as a parent/guardian for ${family} on Paper Pig, the family app for allowance, jobs, reading and screen time.\n\nTo join, open ${link} and sign in with this email (${email}). There's no password: we email you a code.\n\nIf you weren't expecting this, you can ignore it.`;
  const html = `<!doctype html><html><body style="margin:0;background:#FFF0F3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#14101A">
  <div style="max-width:480px;margin:0 auto;padding:32px 20px">
    <div style="background:#fff;border:4px solid #000;border-radius:20px;padding:28px 24px">
      <p style="margin:0 0 6px;font-size:14px;font-weight:600;color:#C70F48">Paper Pig</p>
      <h1 style="margin:0 0 14px;font-size:26px;line-height:1.15">You're invited to ${esc(family)}</h1>
      <p style="margin:0 0 20px;font-size:16px;line-height:1.5"><b>${esc(from)}</b> added you as a parent/guardian. Together you can track allowance, approve jobs, and manage reading and screen time.</p>
      <a href="${esc(link)}" style="display:inline-block;background:#FC3067;color:#fff;text-decoration:none;font-weight:700;font-size:17px;padding:14px 22px;border:4px solid #000;border-radius:14px">Join ${esc(family)}</a>
      <p style="margin:20px 0 0;font-size:14px;line-height:1.5;color:#6B5C66">Sign in with <b>${esc(email)}</b>. There's no password: we email you a code.</p>
    </div>
    <p style="margin:16px 4px 0;font-size:12px;line-height:1.5;color:#6B5C66">If you weren't expecting this, you can ignore it. Replying to this email goes to ${esc(from)}.</p>
  </div></body></html>`;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [email], subject, html, text, ...(me.email ? { reply_to: me.email } : {}) })
  });
  if (!r.ok) { console.error('resend', r.status, await r.text()); return json(502, { error: 'send_failed' }) }
  return json(200, { ok: true });
};

export const config = { path: '/api/invite' };
