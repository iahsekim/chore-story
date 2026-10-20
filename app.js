/* Chore Story — allowance, job board, reading log and weekend screen clock for families. */
const CFG = window.CHORE_JAR_CONFIG;
const APP = CFG.appName || 'Chore Story';
const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

const COLORS = { green: '#1FA34A', blue: '#2F6BFF', purple: '#7A3FF2', orange: '#FF6B1A', pink: '#F0418C', teal: '#0FA3A3' };
const S = {
  user: null, family: null, members: [], invites: [], kids: [], jobs: [], weeks: [], credits: [], reading: [], screen: [], adjust: [],
  view: 'loading', profile: null, parentOk: false, tab: 'home', ptab: 'kids', jobKid: null, jobFilter: 'All',
  authEmail: '', authStep: 'email', onboard: null
};
const store = {
  get(k) { try { return localStorage.getItem('cj-' + k) } catch (e) { return null } },
  set(k, v) { try { v == null ? localStorage.removeItem('cj-' + k) : localStorage.setItem('cj-' + k, v) } catch (e) { } }
};
try { S.parentOk = sessionStorage.getItem('cj-parent') === '1' } catch (e) { }

/* ---------- dates in the family's time zone ---------- */
const tz = () => S.family?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Denver';
const localDate = (ms = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const parseD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)) };
const fmtD = d => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = parseD(s); d.setUTCDate(d.getUTCDate() + n); return fmtD(d) };
const dow = s => parseD(s).getUTCDay();
const monday = s => addDays(s, -((dow(s) + 6) % 7));
const today = () => localDate();
const thisWeek = () => monday(today());
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const md = s => { const d = parseD(s); return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}` };
const short = s => `${DOW[dow(s)]}, ${md(s)}`;
const clockTime = ms => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: tz() });
const pad = n => String(n).padStart(2, '0');
const fmt = ms => { const t = Math.max(0, Math.ceil(ms / 1000)); return `${pad(Math.floor(t / 60))}:${pad(t % 60)}` };
const r2 = n => Math.round(n * 100) / 100;
const money = n => (n < 0 ? '−' : '') + '$' + Math.abs(n).toFixed(2);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ms = iso => iso ? new Date(iso).getTime() : 0;
const $ = id => document.getElementById(id);

/* ---------- data access ---------- */
async function q(p) { const { data, error } = await p; if (error) throw error; return data }
async function loadAll() {
  const fid = S.family.id, since = addDays(today(), -70);
  const [fam, members, invites, kids, jobs, weeks, credits, reading, screen, adjust] = await Promise.all([
    q(sb.from('families').select('*').eq('id', fid).single()),
    q(sb.from('family_members').select('email,user_id').eq('family_id', fid)),
    q(sb.from('family_invites').select('email').eq('family_id', fid)),
    q(sb.from('kids').select('*').eq('family_id', fid).order('created_at')),
    q(sb.from('jobs').select('*').eq('family_id', fid).order('sort')),
    q(sb.from('weeks').select('*').eq('family_id', fid)),
    q(sb.from('credits').select('*').eq('family_id', fid).order('created_at', { ascending: false })),
    q(sb.from('reading_sessions').select('*').eq('family_id', fid).gte('local_date', since).order('started_at', { ascending: false })),
    q(sb.from('screen_sessions').select('*').eq('family_id', fid).gte('local_date', since)),
    q(sb.from('screen_adjust').select('*').eq('family_id', fid).gte('week_start', since)),
  ]);
  Object.assign(S, { family: fam, members, invites, kids, jobs, weeks, credits, reading, screen, adjust });
  await ensureWeeks();
}
/* Each Monday a kid's week starts fresh at their allowance. Rows are created lazily. */
async function ensureWeeks() {
  const cur = thisWeek(), rows = [];
  for (const k of S.kids) {
    let w = k.start_week > cur ? cur : k.start_week, guard = 0;
    while (w <= cur && guard++ < 400) {
      if (!S.weeks.some(x => x.kid_id === k.id && x.week_start === w)) rows.push({ family_id: S.family.id, kid_id: k.id, week_start: w, allowance: Number(k.weekly_allowance) });
      w = addDays(w, 7);
    }
  }
  if (rows.length) {
    await q(sb.from('weeks').upsert(rows, { onConflict: 'kid_id,week_start', ignoreDuplicates: true }));
    S.weeks = await q(sb.from('weeks').select('*').eq('family_id', S.family.id));
  }
}
async function refresh() { try { await loadAll() } catch (e) { toast(errMsg(e)) } render() }
const errMsg = e => (e && e.message && /fetch|network/i.test(e.message)) ? 'You’re offline. Try again when you’re connected.' : 'That didn’t save. Try again.';
async function act(fn, ok) { try { await fn(); if (ok) toast(ok); await refresh() } catch (e) { console.error(e); toast(errMsg(e)) } }

/* ---------- money math ---------- */
const kidById = id => S.kids.find(k => k.id === id);
const weekRow = (kid, ws) => S.weeks.find(w => w.kid_id === kid.id && w.week_start === ws);
const weekCredits = (kid, ws) => S.credits.filter(c => c.kid_id === kid.id && c.week_start === ws);
function weekTotal(kid, ws) {
  const w = weekRow(kid, ws);
  const base = w ? Number(w.allowance) : (ws === thisWeek() ? Number(kid.weekly_allowance) : 0);
  return r2(base + weekCredits(kid, ws).reduce((a, c) => a + Number(c.amount), 0));
}
function kidWeeks(kid) { return S.weeks.filter(w => w.kid_id === kid.id).sort((a, b) => b.week_start.localeCompare(a.week_start)) }
function stats(kid) {
  const cur = thisWeek(), month = today().slice(0, 7);
  let lifetime = 0, monthT = 0, paid = 0, owed = 0;
  for (const w of kidWeeks(kid)) {
    const t = w.paid_at ? Number(w.paid_total) : weekTotal(kid, w.week_start);
    lifetime += t;
    if (w.week_start.slice(0, 7) === month) monthT += t;
    if (w.paid_at) paid += t; else if (w.week_start < cur) owed += t;
  }
  return { week: weekTotal(kid, cur), month: r2(monthT), lifetime: r2(lifetime), paid: r2(paid), owed: r2(owed), curPaid: !!weekRow(kid, cur)?.paid_at };
}
/* New money goes to this week, or next week if this week is already paid. */
function creditWeek(kid) { const cur = thisWeek(); return weekRow(kid, cur)?.paid_at ? addDays(cur, 7) : cur }

/* ---------- reading + screen math ---------- */
const readMin = (r, kid) => r.ended_at ? Number(r.minutes) || 0 : Math.min(Math.floor((Date.now() - ms(r.started_at)) / 60000), Number(kid.max_read_session) || 60);
const activeRead = kid => S.reading.find(r => r.kid_id === kid.id && !r.ended_at && Date.now() - ms(r.started_at) < (Number(kid.max_read_session) || 60) * 60000);
function readWeek(kid, ws = thisWeek()) { const m = S.reading.filter(r => r.kid_id === kid.id && r.week_start === ws).reduce((a, r) => a + readMin(r, kid), 0); return { minutes: m, bonus: Math.min(m, Number(kid.reading_cap) || 0) } }
function screenWeek(kid, ws = thisWeek()) {
  const base = Number(kid.base_screen_minutes) || 0, bonus = readWeek(kid, ws).bonus;
  const adj = S.adjust.filter(a => a.kid_id === kid.id && a.week_start === ws).reduce((a, x) => a + Number(x.minutes), 0);
  const sess = S.screen.filter(x => x.kid_id === kid.id && x.week_start === ws).sort((a, b) => ms(a.started_at) - ms(b.started_at));
  const used = sess.reduce((a, x) => a + Number(x.minutes), 0), total = Math.max(0, base + bonus - adj);
  const active = sess.find(x => ms(x.started_at) + x.minutes * 60000 > Date.now());
  return { base, bonus, adj, used, total, left: Math.max(0, total - used), sess, active };
}
const isScreenDay = kid => (kid.screen_days || [6, 0]).includes(dow(today()));
const screenDayNames = kid => { const d = (kid.screen_days || [6, 0]).slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)); return d.map(x => DAYS[x]).join(' & ') || 'no days' };

/* ---------- icons ---------- */
const I = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  jobs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="17" rx="2"/><path d="M9 4V3h6v1M8 11l2 2 4-4M8 17h8"/></svg>',
  read: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6.5C10 5 7 4.5 3 5v14c4-.5 7 0 9 1.5 2-1.5 5-2 9-1.5V5c-4-.5-7 0-9 1.5zM12 6.5V20"/></svg>',
  screen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2.5h5"/></svg>',
  kids: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-3.5 3.2-5.5 6.5-5.5s6 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .7 3.2 2.5 3.5 5.2"/></svg>',
  pay: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="19" height="13" rx="2"/><path d="M2.5 10h19M6 15h4"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  coin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .8-3 2s1.3 1.7 3 2 3 .8 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6.5v11"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.7 4.5c2.1 0 3.6 1.1 4.3 2.5h2c.7-1.4 2.2-2.5 4.3-2.5 3.7 0 5.8 3.8 4.3 7.2C19.5 16.4 12 21 12 21z"/></svg>'
};
const avatar = (k, cls = '') => `<span class="avatar ${cls}" style="background:${COLORS[k.color] || COLORS.green}">${esc((k.name || '?').slice(0, 1))}</span>`;
const supportHTML = () => `<div class="support"><span>Free to use. Like it?</span>
  <a class="venmo" href="https://venmo.com/u/${encodeURIComponent(CFG.venmo)}" target="_blank" rel="noopener">${I.heart} Venmo @${esc(CFG.venmo)}</a>
  <a class="cash" href="https://cash.app/$${encodeURIComponent(CFG.cashapp)}" target="_blank" rel="noopener">${I.heart} Cash App $${esc(CFG.cashapp)}</a></div>`;

const brandName = () => { const w = APP.split(' '); return w.length > 1 ? `${esc(w.slice(0, -1).join(' '))} <span class="story">${esc(w[w.length - 1])}</span>` : esc(APP) };
/* ---------- top-level render ---------- */
const app = $('app');
function render() {
  document.title = APP;
  const v = S.view;
  if (v === 'loading') app.innerHTML = `<div class="loading">Loading…</div>`;
  else if (v === 'auth') app.innerHTML = authHTML();
  else if (v === 'onboard') app.innerHTML = onboardHTML();
  else if (v === 'who') app.innerHTML = whoHTML();
  else if (v === 'kid') app.innerHTML = kidAppHTML();
  else if (v === 'parent') app.innerHTML = parentAppHTML();
  bindAll();
}

/* ---------- sign in ---------- */
function authHTML() {
  const code = S.authStep === 'code';
  return `<section class="screen-center">
    <div class="brand"><img src="icon.svg" alt=""><h1>${brandName()}</h1></div>
    <p class="lede">Allowance, chores, reading and screen time for kids. One weekly number they can see and trust.</p>
    <div class="card form">
      ${code ? `<div class="field"><label class="label" for="codeIn">Enter the 6-digit code we sent to ${esc(S.authEmail)}</label>
        <input id="codeIn" class="code-in" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000"></div>
        <button class="save" id="codeGo" type="button">Sign in</button>
        <p class="hint">Or tap the link in the email on this device. <button class="link" id="authBack" type="button">Use a different email</button></p>`
      : `<div class="field"><label class="label" for="emailIn">Parent email</label>
        <input id="emailIn" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" value="${esc(S.authEmail)}"></div>
        <button class="save" id="emailGo" type="button">Email me a sign-in code</button>
        <p class="hint">No password. We email you a code each time you sign in on a new device. Kids sign in with your email too, then pick their name.</p>`}
    </div>
    <div class="foot">${supportHTML()}<a href="privacy.html">Privacy</a></div></section>`;
}
async function sendCode() {
  const email = $('emailIn').value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast('Enter a valid email address.');
  const b = $('emailGo'); b.disabled = true; b.textContent = 'Sending…';
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname } });
  if (error) { b.disabled = false; b.textContent = 'Email me a sign-in code'; return toast(/rate/i.test(error.message) ? 'Too many tries. Wait a minute and try again.' : 'Couldn’t send the email. Check the address and try again.') }
  S.authEmail = email; S.authStep = 'code'; render(); setTimeout(() => $('codeIn')?.focus(), 50);
}
async function verifyCode() {
  const token = $('codeIn').value.replace(/\D/g, '');
  if (token.length < 6) return toast('Enter all 6 digits.');
  const { error } = await sb.auth.verifyOtp({ email: S.authEmail, token, type: 'email' });
  if (error) return toast('That code didn’t work. Check the newest email and try again.');
}

/* ---------- onboarding ---------- */
function onboardHTML() {
  const O = S.onboard;
  const steps = `<div class="steps">${[0, 1, 2].map(i => `<i class="${i <= O.step ? 'on' : ''}"></i>`).join('')}</div>`;
  if (O.step === 0) return `<section class="screen-center">${steps}<h2 style="font:600 34px/1.05 var(--display)">Welcome</h2>
    <p class="lede">Set up your family in about a minute.</p>
    <div class="card form"><div class="field"><label class="label" for="famName">Family name</label><input id="famName" maxlength="60" placeholder="The Smiths" value="${esc(O.name)}"></div>
    <p class="hint">Weeks start Monday in your time zone: <b>${esc(O.tz)}</b>.</p>
    <button class="save" id="ob0" type="button">Next</button></div></section>`;
  if (O.step === 1) return `<section class="screen-center">${steps}<h2 style="font:600 34px/1.05 var(--display)">Parent PIN</h2>
    <p class="lede">Kids use your email to sign in, so a 4-digit PIN keeps parent tools to you.</p>
    <div class="card form"><div class="field"><label class="label" for="pin1">Choose a PIN</label><input id="pin1" class="pin" inputmode="numeric" type="password" maxlength="4" autocomplete="off"></div>
    <div class="field"><label class="label" for="pin2">Type it again</label><input id="pin2" class="pin" inputmode="numeric" type="password" maxlength="4" autocomplete="off"></div>
    <button class="save" id="ob1" type="button">Next</button></div></section>`;
  return `<section class="screen-center">${steps}<h2 style="font:600 34px/1.05 var(--display)">Add your kids</h2>
    <p class="lede">First names only. Each kid gets their own job board, which you can change later.</p>
    <div class="card form">
      ${O.kids.map((k, i) => `<div class="kidrow">${avatar(k)}<span><b>${esc(k.name)}</b><span class="hint" style="display:block">$${Number(k.allowance).toFixed(2)} a week</span></span><button class="link" type="button" data-rmkid="${i}">Remove</button></div>`).join('')}
      <div class="row2"><div class="field"><label class="label" for="kName">First name</label><input id="kName" maxlength="40" autocomplete="off"></div>
      <div class="field"><label class="label" for="kAllow">Weekly $</label><input id="kAllow" type="number" inputmode="decimal" min="0" step="0.5" value="5"></div></div>
      <div class="field"><span class="label">Color</span><div class="swatches">${Object.entries(COLORS).map(([n, c]) => `<button class="sw" type="button" data-sw="${n}" aria-label="${n}" aria-pressed="${O.color === n}" style="background:${c}"></button>`).join('')}</div></div>
      <button class="pill soft" id="kAdd" type="button" style="justify-self:start">+ Add kid</button>
      <button class="save" id="ob2" type="button">Finish setup</button></div></section>`;
}
async function finishOnboard() {
  const O = S.onboard; const b = $('ob2'); b.disabled = true; b.textContent = 'Setting up…';
  try {
    const fid = await q(sb.rpc('create_family', { p_name: O.name, p_tz: O.tz }));
    S.family = { id: fid, timezone: O.tz };
    await q(sb.from('families').update({ pin_hash: await hashPin(fid, O.pin) }).eq('id', fid));
    for (const k of O.kids) await addKid(k.name, k.allowance, k.color);
    S.parentOk = true; try { sessionStorage.setItem('cj-parent', '1') } catch (e) { }
    await loadAll(); setProfile('parent'); S.ptab = 'kids'; render(); toast('You’re all set');
  } catch (e) { console.error(e); b.disabled = false; b.textContent = 'Finish setup'; toast(errMsg(e)) }
}
async function addKid(name, allowance, color) {
  const kid = await q(sb.from('kids').insert({ family_id: S.family.id, name: name.trim(), weekly_allowance: Number(allowance) || 0, color: color || 'green', start_week: thisWeek() }).select().single());
  const rows = CATALOG.map((j, i) => ({ family_id: S.family.id, kid_id: kid.id, title: j.title, done_means: j.done, category: j.cat, price: j.price, enabled: j.on, sort: i }));
  await q(sb.from('jobs').insert(rows));
  return kid;
}
async function hashPin(fid, pin) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fid + ':' + pin));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- who's using ---------- */
function whoHTML() {
  return `<section class="screen-center"><div class="brand"><img src="icon.svg" alt=""><h1>${brandName()}</h1></div>
    <p class="lede">Who's using ${esc(APP)}?</p>
    <div class="who">${S.kids.map(k => `<button type="button" data-who="${k.id}">${avatar(k)}${esc(k.name)}</button>`).join('')}
      <button type="button" class="par" data-who="parent"><span class="avatar">${I.lock}</span>Parent</button></div>
    ${S.kids.length ? '' : '<p class="hint">No kids yet. Choose Parent to add one.</p>'}
    <div class="foot"><button class="link" id="signOutWho" type="button">Switch account</button></div></section>`;
}
function setProfile(p) { S.profile = p; store.set('profile', p); S.view = p === 'parent' ? 'parent' : 'kid'; S.tab = 'home' }
function chooseProfile(p) {
  if (p !== 'parent') { setProfile(p); render(); window.scrollTo(0, 0); return }
  if (S.parentOk) { setProfile('parent'); render(); return }
  pinSheet(() => { setProfile('parent'); render() });
}
function switchProfile() { S.parentOk = false; try { sessionStorage.removeItem('cj-parent') } catch (e) { } S.view = 'who'; store.set('profile', null); render(); window.scrollTo(0, 0) }

/* ---------- kid app ---------- */
const KTABS = [['home', 'Home', 'home'], ['jobs', 'Jobs', 'jobs'], ['read', 'Reading', 'read'], ['screen', 'Screen', 'screen']];
function kidAppHTML() {
  const kid = kidById(S.profile); if (!kid) { S.view = 'who'; return whoHTML() }
  const greet = { home: 'Your money', jobs: 'Ways to earn extra', read: 'Every minute counts', screen: 'Screen time' }[S.tab];
  return `<header><div class="hello"><small>${greet}</small><h1>${esc(kid.name)}</h1></div>
    <button class="lock" id="swapBtn" type="button">${I.swap} Switch</button></header>
    <main>${({ home: kidHome, jobs: kidJobs, read: kidRead, screen: kidScreen })[S.tab](kid)}</main>
    ${tabbar(KTABS, S.tab)}`;
}
function tabbar(tabs, cur, badges = {}) {
  return `<nav class="tabbar" role="tablist"><div class="in">${tabs.map(([k, l, ic]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${cur === k}"><span class="ic">${I[ic]}</span>${l}${badges[k] ? `<span class="badge">${badges[k]}</span>` : ''}</button>`).join('')}</div></nav>`;
}
function creditRow(c) { return `<div class="row"><span class="ico ${c.kind === 'job' ? 'j' : 'm'}">${c.kind === 'job' ? I.check : I.star}</span><span class="t"><b>${esc(c.title)}</b><span>${c.kind === 'job' ? 'Job' : 'Bonus'} · ${short(localDate(ms(c.created_at)))}</span></span><span class="amt up">+${money(Number(c.amount))}</span></div>` }
function kidHome(kid) {
  const st = stats(kid), sw = screenWeek(kid), rw = readWeek(kid), cur = thisWeek();
  const w = weekRow(kid, cur), cr = weekCredits(kid, cur);
  return `<section class="hero" style="--hero:${COLORS[kid.color]}"><div class="label">This week</div><div class="big num">${money(st.week)}</div>
    <div class="hero-foot"><span>Week of ${md(cur)}</span><span>${st.curPaid ? 'Paid' : `Resets Monday to <b>${money(Number(kid.weekly_allowance))}</b>`}</span></div></section>
    <section class="buckets"><div class="bucket ow ${st.owed ? '' : 'zero'}"><span class="label">Waiting to be paid</span><b class="num">${money(st.owed)}</b></div><div class="bucket pd ${st.paid ? '' : 'zero'}"><span class="label">Paid to you</span><b class="num">${money(st.paid)}</b></div></section>
    <section class="tiles">
      <button class="tile scr" type="button" data-tab="screen"><span class="label">Screen left</span><span class="v num">${sw.left}<small> min</small></span><span class="s">${screenDayNames(kid)}</span></button>
      <button class="tile rdg" type="button" data-tab="read"><span class="label">Reading bonus</span><span class="v num">+${rw.bonus}<small> min</small></span><span class="s">${rw.bonus >= kid.reading_cap ? 'Maxed out this week!' : `${kid.reading_cap - rw.bonus} more to earn`}</span></button>
    </section>
    <section class="sect"><div class="sect-h"><h3>This week</h3><span class="label">Lifetime ${money(st.lifetime)}</span></div><div class="list">
      <div class="row"><span class="ico m">${I.coin}</span><span class="t"><b>Weekly allowance</b><span>Every Monday</span></span><span class="amt up">+${money(Number(w?.allowance ?? kid.weekly_allowance))}</span></div>
      ${cr.map(creditRow).join('')}</div></section>
    <section class="ptools"><button class="pill soft" id="rulesBtn" type="button">How it works</button></section>`;
}
function kidJobs(kid) {
  const on = S.jobs.filter(j => j.kid_id === kid.id && j.enabled);
  const cats = ['All', ...new Set(on.map(j => j.category))]; if (!cats.includes(S.jobFilter)) S.jobFilter = 'All';
  return `<section class="card"><p class="hint" style="font-size:15px;color:var(--ink)">Pick any job. When it's done, tell a parent and they'll add the money to this week.</p></section>
    ${on.length ? `<section class="sect"><div class="filters">${cats.map(c => `<button class="chip" type="button" data-cat="${esc(c)}" aria-pressed="${c === S.jobFilter}">${esc(c)}</button>`).join('')}</div>
    <div class="list">${on.filter(j => S.jobFilter === 'All' || j.category === S.jobFilter).sort((a, b) => a.price - b.price).map(j => `<div class="row"><span class="t"><b>${esc(j.title)}</b><span>${esc(j.done_means)}</span></span><span class="price num">${money(Number(j.price))}</span></div>`).join('')}</div></section>`
      : `<div class="list"><div class="empty">No jobs on your board yet.</div></div>`}`;
}
function kidRead(kid) {
  const rw = readWeek(kid), a = activeRead(kid), cap = Number(kid.reading_cap) || 1;
  const mine = S.reading.filter(r => r.kid_id === kid.id && r !== a).slice(0, 30);
  return `<section class="board rdb" id="readBoard">${readBoardHTML(kid)}</section>
    <section class="card progress"><div class="top"><span class="label">Bonus screen minutes</span><span class="v num" style="color:var(--read)">+${rw.bonus}<small> of ${cap}</small></span></div>
    <div class="meter"><i style="width:${Math.min(100, 100 * rw.bonus / cap)}%;background:var(--read)"></i></div>
    <p class="hint">${rw.minutes} minutes read this week. 1 minute reading = 1 screen minute this week. Chapter books and graphic novels count. Starts over every Monday.</p></section>
    <section class="sect"><div class="sect-h"><h3>Reading log</h3></div><div class="list">${mine.length ? mine.map(r => readRow(r, kid, false)).join('') : '<div class="empty">Nothing logged yet. Tap Start reading and the minutes count themselves.</div>'}</div></section>`;
}
function readRow(r, kid, parent) {
  const tg = parent ? 'button' : 'div';
  return `<${tg} ${parent ? `type="button" data-delread="${r.id}"` : ''} class="row"><span class="ico r">${I.read}</span><span class="t"><b>${esc(r.book)}</b><span>${short(r.local_date)} · ${clockTime(ms(r.started_at))}${r.ended_at ? '' : ' · stopped itself'}${parent ? ' · tap to remove' : ''}</span></span><span class="amt rd">+${readMin(r, kid)} min</span></${tg}>`;
}
function readBoardHTML(kid) {
  const a = activeRead(kid);
  if (a) return `<div class="bline"><span class="label">Reading now</span><b>${esc(a.book)}</b></div>
    <div class="digits num" id="readDigits">${fmt(Date.now() - ms(a.started_at))}</div>
    <p class="note">Stops itself after ${kid.max_read_session} minutes.</p><button class="go white" id="stopRead" type="button">I'm done reading</button>`;
  return `<div class="bline"><span class="label">Reading timer</span><span>1 min = <b>1 screen min</b></span></div>
    <div class="digits idle num">00:00</div><button class="go white" id="startRead" type="button">Start reading</button>`;
}
let pick = null, confirming = false;
function kidScreen(kid) {
  const x = screenWeek(kid);
  const rows = [...x.sess].reverse().map(s => `<div class="row"><span class="ico s">${I.screen}</span><span class="t"><b>${s.minutes}-minute session</b><span>${short(s.local_date)} · ${clockTime(ms(s.started_at))}–${clockTime(ms(s.started_at) + s.minutes * 60000)}</span></span><span class="amt">${s.minutes} min</span></div>`)
    .concat(S.adjust.filter(a => a.kid_id === kid.id && a.week_start === thisWeek()).map(a => `<div class="row"><span class="ico d">${I.clock}</span><span class="t"><b>${esc(a.note)}</b><span>Logged ${short(localDate(ms(a.created_at)))}</span></span><span class="amt down">−${a.minutes} min</span></div>`));
  return `<section class="board" id="board">${boardHTML(kid)}</section>${eqHTML(kid, x)}
    <section class="sect"><div class="sect-h"><h3>Sessions</h3></div><div class="list">${rows.length ? rows.join('') : '<div class="empty">No sessions yet this week.</div>'}</div></section>`;
}
function eqHTML(kid, x, extra = '') {
  return `<section class="card"><span class="label">This week · ${screenDayNames(kid)}</span>
    <div class="eq"><span class="term"><b class="num">${x.base}</b><span>Base</span></span><span class="op">+</span><span class="term"><b class="num" style="color:var(--read)">${x.bonus}</b><span>Reading</span></span>
    ${x.adj ? `<span class="op">−</span><span class="term"><b class="num" style="color:var(--danger)">${x.adj}</b><span>No clock</span></span>` : ''}
    ${x.used ? `<span class="op">−</span><span class="term"><b class="num">${x.used}</b><span>Used</span></span>` : ''}
    <span class="op">=</span><span class="term res"><b class="num">${x.left}</b><span>Left</span></span></div>${extra}</section>`;
}
function boardHTML(kid) {
  const x = screenWeek(kid), now = Date.now();
  if (x.active) {
    const end = ms(x.active.started_at) + x.active.minutes * 60000, rem = end - now, pct = 100 * (1 - rem / (x.active.minutes * 60000));
    return `<div class="bline"><span class="label">Clock running</span><span>Ends <b>${clockTime(end)}</b></span></div>
      <div class="digits num" id="digits">${fmt(rem)}</div><div class="bar"><i id="barfill" style="width:${pct}%"></i></div><p class="note">The clock doesn't pause. At zero, screens go off.</p>`;
  }
  if (!isScreenDay(kid)) return `<div class="bline"><span class="label">Screen clock</span><span>Opens <b>${screenDayNames(kid)}</b></span></div>
    <div class="digits idle num">${x.left}<span style="font-size:.4em"> min</span></div><p class="note">That's your total so far. Reading this week adds more.</p>`;
  if (!x.left) return `<div class="bline"><span class="label">Screen clock</span></div><div class="digits idle num">00:00</div><p class="note">All of this week's minutes are used. New minutes start Monday.</p>`;
  const opts = [15, 30, 60].filter(m => m < x.left); opts.push(x.left);
  if (pick == null || !opts.includes(pick)) pick = opts[Math.min(1, opts.length - 1)];
  return `<div class="bline"><span class="label">Ready</span><span><b>${x.left} min</b> left this week</span></div><div class="digits num">${fmt(pick * 60000)}</div>
    ${confirming ? `<p class="note">It won't pause once it starts. It ends at <b style="color:var(--board-ink)">${clockTime(now + pick * 60000)}</b>.</p><div class="row2"><button class="ghost" id="startNo" type="button">Not yet</button><button class="go" id="startYes" type="button">Start now</button></div>`
      : `<div class="opts" style="grid-template-columns:repeat(${opts.length},1fr)">${opts.map(m => `<button class="opt" type="button" data-pick="${m}" aria-pressed="${m === pick}">${m === x.left && opts.length > 1 ? `All<small>${m} min</small>` : `${m}<small>min</small>`}</button>`).join('')}</div>
      <button class="go" id="startBtn" type="button">Start ${pick}-minute clock</button>`}`;
}

/* ---------- parent app ---------- */
const PTABS = [['kids', 'Kids', 'kids'], ['jobs', 'Job boards', 'jobs'], ['pay', 'Payday', 'pay'], ['settings', 'Settings', 'gear']];
function parentAppHTML() {
  const owedKids = S.kids.filter(k => stats(k).owed > 0).length;
  const greet = { kids: 'Parent', jobs: 'Edit each kid’s board', pay: 'Mark weeks paid', settings: 'Family settings' }[S.ptab];
  return `<header><div class="hello"><small>${greet}</small><h1>${esc(S.family.name || APP)}</h1></div>
    <button class="lock on" id="swapBtn" type="button">${I.swap} Switch</button></header>
    <main>${({ kids: pKids, jobs: pJobs, pay: pPay, settings: pSettings })[S.ptab]()}</main>
    ${tabbar(PTABS, S.ptab, { pay: owedKids })}`;
}
function pKids() {
  if (!S.kids.length) return `<div class="card"><p class="hint">Add your first kid to get started.</p><button class="save" id="addKidBtn" type="button">+ Add a kid</button></div>`;
  return S.kids.map(k => {
    const st = stats(k), sw = screenWeek(k), rw = readWeek(k);
    return `<article class="kcard"><div class="kh">${avatar(k)}<h3>${esc(k.name)}</h3><span class="wk num" style="color:color-mix(in srgb, ${COLORS[k.color]} 78%, var(--ink))">${money(st.week)}<small>This week</small></span></div>
      <div class="kstats"><div><b class="num ${st.owed ? 'owed' : ''}">${money(st.owed)}</b><span>Owed</span></div><div><b class="num">${money(st.month)}</b><span>Month</span></div><div><b class="num">${money(st.lifetime)}</b><span>Lifetime</span></div></div>
      <div class="kstats"><div><b class="num">${sw.left}</b><span>Screen min left</span></div><div><b class="num" style="color:var(--read)">+${rw.bonus}</b><span>Reading bonus</span></div><div><b class="num">${rw.minutes}</b><span>Min read</span></div></div>
      <div class="kact"><button class="pill" type="button" data-logjob="${k.id}">Log a job</button><button class="pill ok" type="button" data-bonus="${k.id}">Add money</button><button class="pill soft" type="button" data-more="${k.id}">More</button></div></article>`;
  }).join('') + `<button class="pill soft" id="addKidBtn" type="button" style="justify-self:start">+ Add a kid</button>`;
}
function pJobs() {
  if (!S.kids.length) return `<div class="card"><p class="hint">Add a kid first.</p></div>`;
  if (!kidById(S.jobKid)) S.jobKid = S.kids[0].id;
  const kid = kidById(S.jobKid), every = S.jobs.filter(j => j.kid_id === kid.id), nOn = every.filter(j => j.enabled).length;
  const show = S.jobShow || 'on', all = every.filter(j => show === 'all' || (show === 'on' ? j.enabled : !j.enabled));
  const cats = [...new Set(all.map(j => j.category))];
  return `<div class="kpick">${S.kids.map(k => `<button class="chip" type="button" data-jk="${k.id}" aria-pressed="${k.id === kid.id}"><span class="dot" style="background:${COLORS[k.color]}"></span>${esc(k.name)}</button>`).join('')}</div>
    <section class="card"><p class="hint">${nOn} of ${every.length} jobs are on ${esc(kid.name)}'s board. Switch jobs on or off, or tap a job to edit its name, price or description.</p>
    <div class="seg">${[['on', `On (${nOn})`], ['off', `Off (${every.length - nOn})`], ['all', `All (${every.length})`]].map(([k, l]) => `<button type="button" data-show="${k}" aria-pressed="${show === k}">${l}</button>`).join('')}</div>
    <div class="ptools"><button class="pill" id="newJob" type="button">+ New job</button>${S.kids.length > 1 ? `<button class="pill soft" id="copyBoard" type="button">Copy this board to…</button>` : ''}</div></section>
    ${all.length ? '' : `<div class="list"><div class="empty">${show === 'on' ? 'No jobs switched on yet. Tap Off to find some.' : 'Every job is switched on.'}</div></div>`}${cats.map(c => `<section class="sect"><div class="sect-h"><h3>${esc(c)}</h3></div><div class="list">${all.filter(j => j.category === c).map(j => `<div class="row"><button class="tog" type="button" data-tog="${j.id}" aria-pressed="${j.enabled}" aria-label="Show ${esc(j.title)}"></button><button class="t" type="button" data-editjob="${j.id}" style="text-align:left"><b>${esc(j.title)}</b><span>${esc(j.done_means)}</span></button><span class="price num">${money(Number(j.price))}</span></div>`).join('')}</div></section>`).join('')}`;
}
function pPay() {
  if (!S.kids.length) return `<div class="card"><p class="hint">Add a kid first.</p></div>`;
  const cur = thisWeek();
  return S.kids.map(k => {
    const st = stats(k), weeks = kidWeeks(k).slice(0, 12);
    const owedWeeks = weeks.filter(w => !w.paid_at && w.week_start < cur);
    return `<section class="sect"><div class="sect-h"><h3 style="display:flex;align-items:center;gap:10px">${avatar(k)}${esc(k.name)}</h3></div>
      <div class="buckets"><div class="bucket ow ${st.owed ? '' : 'zero'}"><span class="label">Owed</span><b class="num">${money(st.owed)}</b></div><div class="bucket pd ${st.paid ? '' : 'zero'}"><span class="label">Paid</span><b class="num">${money(st.paid)}</b></div></div>
      ${owedWeeks.length > 1 ? `<button class="save" type="button" data-payall="${k.id}" style="background:var(--money)">Mark all owed paid · ${money(st.owed)}</button>` : ''}
      <div class="list">${weeks.map(w => {
        const t = w.paid_at ? Number(w.paid_total) : weekTotal(k, w.week_start), isCur = w.week_start === cur;
        return `<div class="row weekrow"><span class="t"><b>${md(w.week_start)}–${md(addDays(w.week_start, 6))}</b><span>${w.paid_at ? `<span class="tag paid">Paid</span> ${short(localDate(ms(w.paid_at)))}` : isCur ? '<span class="tag now">This week</span>' : '<span class="tag owed">Owed</span>'}</span></span>
          <span class="amt">${money(t)}</span>${w.paid_at ? '' : `<button class="pill ${isCur ? 'soft' : 'ok'}" type="button" data-paywk="${k.id}|${w.week_start}">Mark paid</button>`}</div>`;
      }).join('')}</div></section>`;
  }).join('');
}
function pSettings() {
  const F = S.family;
  return `<section class="sect"><div class="sect-h"><h3>Kids</h3></div><div class="list">${S.kids.map(k => `<button class="row" type="button" data-editkid="${k.id}">${avatar(k)}<span class="t"><b>${esc(k.name)}</b><span>${money(Number(k.weekly_allowance))} a week · ${k.base_screen_minutes} screen min · reading up to +${k.reading_cap}</span></span></button>`).join('')}</div>
    <button class="pill soft" id="addKidBtn" type="button" style="justify-self:start">+ Add a kid</button></section>
    <section class="card"><span class="label">Family</span>
      <div class="field"><label class="label" for="sFam">Family name</label><input id="sFam" maxlength="60" value="${esc(F.name)}"></div>
      <div class="field"><label class="label" for="sTz">Time zone (weeks reset Monday here)</label><select id="sTz">${tzOptions(F.timezone)}</select></div>
      <button class="save" id="saveFam" type="button">Save</button>
      <button class="pill soft" id="changePin" type="button" style="justify-self:start">Change parent PIN</button></section>
    <section class="card"><span class="label">Parents on this family</span>
      ${S.members.map(m => `<div class="hint" style="color:var(--ink)">${esc(m.email || 'Parent')}${m.user_id === S.user.id ? ' (you)' : ''}</div>`).join('')}
      ${S.invites.map(i => `<div class="hint">${esc(i.email)} · invited</div>`).join('')}
      <div class="field"><label class="label" for="invEmail">Invite another parent</label><input id="invEmail" type="email" placeholder="partner@example.com"></div>
      <button class="pill" id="invGo" type="button" style="justify-self:start">Add parent</button>
      <p class="hint">They sign in at this site with that email and join your family automatically.</p></section>
    <section class="card"><span class="label">Support ${esc(APP)}</span><p class="hint">${esc(APP)} is free. If it helps your family, a coffee keeps it running.</p>${supportHTML()}</section>
    <section class="card"><span class="label">Account</span><p class="hint">Signed in as ${esc(S.user.email)}</p>
      <div class="ptools"><button class="pill soft" id="signOut" type="button">Sign out</button><button class="pill no" id="delAcct" type="button">Delete account and all data</button></div>
      <a class="hint" href="privacy.html">Privacy</a></section>`;
}
function tzOptions(cur) {
  let list = []; try { list = Intl.supportedValuesOf('timeZone') } catch (e) { list = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'] }
  if (!list.includes(cur)) list.unshift(cur);
  return list.map(t => `<option ${t === cur ? 'selected' : ''}>${esc(t)}</option>`).join('');
}

/* ---------- events ---------- */
function bindAll() {
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn };
  const each = (sel, fn) => app.querySelectorAll(sel).forEach(el => el.onclick = () => fn(el));
  // auth
  on('emailGo', sendCode); on('codeGo', verifyCode); on('authBack', () => { S.authStep = 'email'; render() });
  if ($('emailIn')) $('emailIn').onkeydown = e => { if (e.key === 'Enter') sendCode() };
  if ($('codeIn')) $('codeIn').oninput = e => { if (e.target.value.replace(/\D/g, '').length === 6) verifyCode() };
  // onboarding
  on('ob0', () => { S.onboard.name = $('famName').value.trim() || 'Our family'; S.onboard.step = 1; render() });
  on('ob1', () => { const a = $('pin1').value, b = $('pin2').value; if (!/^\d{4}$/.test(a)) return toast('Use 4 digits.'); if (a !== b) return toast('The PINs don’t match.'); S.onboard.pin = a; S.onboard.step = 2; render() });
  each('[data-sw]', el => { if (S.view === 'onboard') { S.onboard.color = el.dataset.sw; render() } });
  on('kAdd', () => { const n = $('kName').value.trim(); if (!n) return toast('Type a first name.'); S.onboard.kids.push({ name: n, allowance: Number($('kAllow').value) || 0, color: S.onboard.color }); const keys = Object.keys(COLORS); S.onboard.color = keys[S.onboard.kids.length % keys.length]; render(); $('kName')?.focus() });
  each('[data-rmkid]', el => { S.onboard.kids.splice(Number(el.dataset.rmkid), 1); render() });
  on('ob2', () => { const n = $('kName')?.value.trim(); if (n) S.onboard.kids.push({ name: n, allowance: Number($('kAllow').value) || 0, color: S.onboard.color }); if (!S.onboard.kids.length) return toast('Add at least one kid.'); finishOnboard() });
  // who
  each('[data-who]', el => chooseProfile(el.dataset.who));
  on('swapBtn', switchProfile);
  // tabs
  each('[data-tab]', el => { if (S.view === 'parent') S.ptab = el.dataset.tab; else S.tab = el.dataset.tab; confirming = false; render(); window.scrollTo(0, 0) });
  each('[data-cat]', el => { S.jobFilter = el.dataset.cat; render() });
  on('rulesBtn', () => rulesSheet(kidById(S.profile)));
  // kid boards
  bindBoards();
  // parent
  each('[data-logjob]', el => logJobSheet(kidById(el.dataset.logjob)));
  each('[data-bonus]', el => bonusSheet(kidById(el.dataset.bonus)));
  each('[data-more]', el => kidMoreSheet(kidById(el.dataset.more)));
  on('addKidBtn', () => kidSheet());
  each('[data-editkid]', el => kidSheet(kidById(el.dataset.editkid)));
  each('[data-jk]', el => { S.jobKid = el.dataset.jk; render() });
  each('[data-show]', el => { S.jobShow = el.dataset.show; render() });
  each('[data-tog]', el => { const j = S.jobs.find(x => x.id === el.dataset.tog); j.enabled = !j.enabled; el.setAttribute('aria-pressed', j.enabled); act(() => q(sb.from('jobs').update({ enabled: j.enabled }).eq('id', j.id))) });
  each('[data-editjob]', el => jobSheet(S.jobs.find(x => x.id === el.dataset.editjob)));
  on('newJob', () => jobSheet(null));
  on('copyBoard', copyBoardSheet);
  each('[data-paywk]', el => { const [kid, ws] = el.dataset.paywk.split('|'); payWeeks(kidById(kid), [ws]) });
  each('[data-payall]', el => { const k = kidById(el.dataset.payall); payWeeks(k, kidWeeks(k).filter(w => !w.paid_at && w.week_start < thisWeek()).map(w => w.week_start)) });
  on('saveFam', () => act(() => q(sb.from('families').update({ name: $('sFam').value.trim() || 'Our family', timezone: $('sTz').value }).eq('id', S.family.id)), 'Saved'));
  on('changePin', () => newPinSheet());
  on('invGo', () => { const e = $('invEmail').value.trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return toast('Enter a valid email.'); act(() => q(sb.from('family_invites').upsert({ family_id: S.family.id, email: e })), 'Invite saved') });
  on('signOutWho', async () => { await sb.auth.signOut(); store.set('profile', null); store.set('signed-in', null); location.reload() });
  on('signOut', async () => { await sb.auth.signOut(); store.set('profile', null); location.reload() });
  on('delAcct', deleteSheet);
}
function bindBoards() {
  const kid = kidById(S.profile); if (!kid) return;
  document.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { pick = Number(b.dataset.pick); rerenderBoards() });
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn };
  on('startBtn', () => { confirming = true; rerenderBoards() });
  on('startNo', () => { confirming = false; rerenderBoards() });
  on('startYes', () => startScreen(kid));
  on('startRead', () => readStartSheet(kid));
  on('stopRead', () => stopRead(kid));
}
function rerenderBoards() { const kid = kidById(S.profile); if (!kid) return; const b = $('board'); if (b) b.innerHTML = boardHTML(kid); const r = $('readBoard'); if (r) r.innerHTML = readBoardHTML(kid); bindBoards() }
async function startScreen(kid) {
  confirming = false; const x = screenWeek(kid), m = Math.min(pick || x.left, x.left); if (!m) return rerenderBoards();
  unlockAudio(); const d = today();
  await act(() => q(sb.from('screen_sessions').insert({ family_id: S.family.id, kid_id: kid.id, local_date: d, week_start: monday(d), started_at: new Date().toISOString(), minutes: m })));
}
async function stopRead(kid) {
  const a = activeRead(kid); if (!a) return; const m = Math.min(Math.floor((Date.now() - ms(a.started_at)) / 60000), Number(kid.max_read_session) || 60);
  await act(() => q(sb.from('reading_sessions').update({ ended_at: new Date().toISOString(), minutes: m }).eq('id', a.id)), m ? `+${m} screen minute${m > 1 ? 's' : ''}` : 'Under a minute, so nothing added');
}
function payWeeks(kid, list) {
  if (!list.length) return;
  const total = r2(list.reduce((a, ws) => a + weekTotal(kid, ws), 0)), cur = list.includes(thisWeek());
  confirmSheet(`Pay ${kid.name} ${money(total)}?`, `${list.length > 1 ? `${list.length} weeks` : `Week of ${md(list[0])}`} moves to Paid.${cur ? ' This week is still going, so anything added after this counts toward next week.' : ''}`, `Mark paid · ${money(total)}`, async () => {
    const now = new Date().toISOString();
    for (const ws of list) await q(sb.from('weeks').update({ paid_at: now, paid_total: weekTotal(kid, ws) }).eq('kid_id', kid.id).eq('week_start', ws));
  }, 'Marked paid', 'ok');
}

/* ticking: display only, no writes */
let wasActive = null, wakeLock = null, audio = null;
setInterval(() => {
  if (S.view !== 'kid') return; const kid = kidById(S.profile); if (!kid) return;
  const x = screenWeek(kid), id = x.active ? x.active.id : null;
  if (id !== wasActive) { if (wasActive && !id) { beep(); releaseWake() } if (id) holdWake(); wasActive = id; render(); return }
  if (x.active) { const end = ms(x.active.started_at) + x.active.minutes * 60000, rem = end - Date.now(); const d = $('digits'); if (d) d.textContent = fmt(rem); const f = $('barfill'); if (f) f.style.width = (100 * (1 - rem / (x.active.minutes * 60000))) + '%' }
  const a = activeRead(kid), rd = $('readDigits'); if (rd && a) rd.textContent = fmt(Date.now() - ms(a.started_at));
  if (S.tab === 'read' && !!rd !== !!a) render();
}, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.family && (S.view === 'kid' || S.view === 'parent')) refresh() });
setInterval(() => { if (!document.hidden && S.family && (S.view === 'kid' || S.view === 'parent') && !$('scrim')) refresh() }, 60000);
function unlockAudio() { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume() } catch (e) { } }
function beep() { try { if (!audio) return;[0, .35, .7].forEach(t => { const o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = 880; o.connect(g); g.connect(audio.destination); g.gain.setValueAtTime(.25, audio.currentTime + t); g.gain.exponentialRampToValueAtTime(.001, audio.currentTime + t + .3); o.start(audio.currentTime + t); o.stop(audio.currentTime + t + .3) }) } catch (e) { } }
async function holdWake() { try { wakeLock = await navigator.wakeLock?.request('screen') } catch (e) { } }
function releaseWake() { try { wakeLock?.release(); wakeLock = null } catch (e) { } }

/* ---------- sheets ---------- */
const layer = $('layer');
function openSheet(html, after) { layer.innerHTML = `<div class="scrim" id="scrim"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`; $('scrim').onclick = e => { if (e.target.id === 'scrim') closeSheet() }; layer.querySelectorAll('[data-close]').forEach(b => b.onclick = closeSheet); after && after() }
function closeSheet() { layer.innerHTML = '' }
let tt; function toast(m) { clearTimeout(tt); let el = $('toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el) } el.textContent = m; tt = setTimeout(() => el.remove(), 2800) }
function confirmSheet(title, body, yes, fn, ok, style = 'red') {
  openSheet(`<h2>${esc(title)}</h2><p class="hint">${esc(body)}</p><button class="save ${style === 'red' ? 'red' : ''}" id="cfYes" type="button" ${style === 'ok' ? 'style="background:var(--money)"' : ''}>${esc(yes)}</button><button class="cancel" data-close type="button">Cancel</button>`,
    () => { $('cfYes').onclick = async () => { $('cfYes').disabled = true; closeSheet(); await act(fn, ok) } });
}
function pinSheet(onOk) {
  openSheet(`<h2>Parent PIN</h2><div class="field"><label class="label" for="pinIn">Enter your 4-digit PIN</label><input id="pinIn" class="pin" inputmode="numeric" type="password" maxlength="4" autocomplete="off"></div>
    <button class="save" id="pinGo" type="button">Unlock</button><button class="cancel" data-close type="button">Cancel</button>
    ${S.canResetPin ? '<button class="cancel" id="pinReset" type="button">Forgot it? Set a new PIN</button>' : '<p class="hint">Forgot it? On the Who\'s using screen, choose Switch account, sign in again with your email, and you can set a new PIN.</p>'}`, () => {
    const r = $('pinReset'); if (r) r.onclick = () => { closeSheet(); newPinSheet(true, onOk) };
    const i = $('pinIn'); i.focus();
    const go = async () => { if (!S.family.pin_hash || await hashPin(S.family.id, i.value) === S.family.pin_hash) { S.parentOk = true; try { sessionStorage.setItem('cj-parent', '1') } catch (e) { } closeSheet(); onOk() } else { i.value = ''; toast('That PIN didn’t match.') } };
    $('pinGo').onclick = go; i.oninput = () => { if (i.value.length === 4) go() };
  });
}
function newPinSheet(force, after) {
  openSheet(`<h2>${force ? 'Set a new PIN' : 'Change PIN'}</h2><div class="field"><label class="label" for="np1">New 4-digit PIN</label><input id="np1" class="pin" inputmode="numeric" type="password" maxlength="4"></div>
    <div class="field"><label class="label" for="np2">Type it again</label><input id="np2" class="pin" inputmode="numeric" type="password" maxlength="4"></div>
    <button class="save" id="npGo" type="button">Save PIN</button>${force ? '' : '<button class="cancel" data-close type="button">Cancel</button>'}`, () => {
    $('npGo').onclick = async () => { const a = $('np1').value, b = $('np2').value; if (!/^\d{4}$/.test(a)) return toast('Use 4 digits.'); if (a !== b) return toast('The PINs don’t match.'); closeSheet(); await act(async () => { await q(sb.from('families').update({ pin_hash: await hashPin(S.family.id, a) }).eq('id', S.family.id)) }, 'PIN saved'); if (after) { S.parentOk = true; try { sessionStorage.setItem('cj-parent', '1') } catch (e) { } after() } };
  });
}
function rulesSheet(kid) {
  openSheet(`<h2>How it works</h2><ol class="rules">
    <li><span><b>Every Monday you start at ${money(Number(kid.weekly_allowance))}.</b> That's your allowance, no matter what.</span></li>
    <li><span><b>Jobs add money.</b> When you finish one, a parent adds it to this week.</span></li>
    <li><span><b>Money only goes up.</b> Nothing gets taken away.</span></li>
    <li><span><b>At the end of the week, a parent pays you</b> and the week moves to "Paid to you." Until then it's "Waiting to be paid."</span></li>
    <li><span><b>${kid.base_screen_minutes} screen minutes each week</b> on ${screenDayNames(kid)}.</span></li>
    <li><span><b>1 minute reading = 1 screen minute,</b> up to ${kid.reading_cap} a week. Chapter books and graphic novels count.</span></li>
    <li><span><b>Screens only while the clock runs.</b> Minutes without the clock come off next week.</span></li>
    <li><span><b>If it's not written here, it's not a rule.</b></span></li></ol><button class="save" data-close type="button">Got it</button>`);
}
function readStartSheet(kid) {
  const books = [...new Set(S.reading.filter(r => r.kid_id === kid.id).map(r => r.book))].slice(0, 6);
  openSheet(`<h2>Start reading</h2><div class="field"><label class="label" for="bookIn">What are you reading?</label><input id="bookIn" maxlength="100" placeholder="Book title" value="${esc(books[0] || '')}">
    ${books.length ? `<div class="chips">${books.map(b => `<button class="chip" type="button" data-book="${esc(b)}">${esc(b)}</button>`).join('')}</div>` : ''}</div>
    <p class="hint">Chapter books and graphic novels count. Audiobooks don't.</p><button class="save" id="rdGo" type="button" style="background:var(--read)">Start the timer</button><button class="cancel" data-close type="button">Cancel</button>`, () => {
    layer.querySelectorAll('[data-book]').forEach(b => b.onclick = () => { $('bookIn').value = b.dataset.book });
    $('rdGo').onclick = async () => { const book = $('bookIn').value.trim(); if (!book) return toast('Type the book’s title.'); if (activeRead(kid)) return closeSheet(); closeSheet(); const d = today();
      await act(() => q(sb.from('reading_sessions').insert({ family_id: S.family.id, kid_id: kid.id, book, local_date: d, week_start: monday(d), started_at: new Date().toISOString() }))) };
  });
}
function logJobSheet(kid) {
  const on = S.jobs.filter(j => j.kid_id === kid.id && j.enabled).sort((a, b) => a.title.localeCompare(b.title)), ws = creditWeek(kid);
  openSheet(`<span class="label">Log a job for ${esc(kid.name)}</span><h2>What did ${esc(kid.name)} do?</h2>
    ${ws !== thisWeek() ? '<p class="hint">This week is already paid, so this counts toward next week.</p>' : ''}
    <div class="field"><label class="label" for="jobSearch">Search</label><input id="jobSearch" placeholder="Dishes, trash, laundry…" autocomplete="off"></div>
    <div class="list" style="box-shadow:none;border:1px solid var(--line)" id="jobList">${on.map(j => `<button class="row" type="button" data-pickjob="${j.id}" data-q="${esc((j.title + ' ' + j.category).toLowerCase())}"><span class="t"><b>${esc(j.title)}</b><span>${esc(j.category)}</span></span><span class="price num">${money(Number(j.price))}</span></button>`).join('') || '<div class="empty">No jobs on this board.</div>'}</div>
    <button class="cancel" data-close type="button">Close</button>`, () => {
    $('jobSearch').oninput = e => { const v = e.target.value.toLowerCase(); layer.querySelectorAll('[data-pickjob]').forEach(b => b.hidden = !b.dataset.q.includes(v)) };
    layer.querySelectorAll('[data-pickjob]').forEach(b => b.onclick = async () => { const j = S.jobs.find(x => x.id === b.dataset.pickjob); closeSheet();
      await act(() => q(sb.from('credits').insert({ family_id: S.family.id, kid_id: kid.id, week_start: ws, kind: 'job', title: j.title, amount: Number(j.price) })), `+${money(Number(j.price))} for ${kid.name}`) });
  });
}
function bonusSheet(kid) {
  const ws = creditWeek(kid);
  openSheet(`<span class="label">Add money for ${esc(kid.name)}</span><h2>Something good happened</h2>
    ${ws !== thisWeek() ? '<p class="hint">This week is already paid, so this counts toward next week.</p>' : ''}
    <div class="chips">${[0.5, 1, 2, 5].map(a => `<button class="chip" type="button" data-amt="${a}">$${a < 1 ? a.toFixed(2) : a}</button>`).join('')}</div>
    <div class="field"><label class="label" for="bAmt">Amount ($)</label><input id="bAmt" type="number" inputmode="decimal" min="0.25" step="0.25" value="1"></div>
    <div class="field"><label class="label" for="bWhy">Reason ${esc(kid.name)} will see</label><input id="bWhy" maxlength="120" placeholder="Helped a neighbor carry groceries"></div>
    <button class="save" id="bGo" type="button" style="background:var(--money)">Add money</button><button class="cancel" data-close type="button">Cancel</button>`, () => {
    layer.querySelectorAll('[data-amt]').forEach(b => b.onclick = () => { $('bAmt').value = b.dataset.amt });
    $('bGo').onclick = async () => { const a = r2(parseFloat($('bAmt').value) || 0), why = $('bWhy').value.trim(); if (a <= 0) return toast('Enter an amount.'); if (!why) return toast('Add a reason so they know why.'); closeSheet();
      await act(() => q(sb.from('credits').insert({ family_id: S.family.id, kid_id: kid.id, week_start: ws, kind: 'bonus', title: why, amount: a })), `+${money(a)} for ${kid.name}`) };
  });
}
function kidMoreSheet(kid) {
  const cur = thisWeek(), cr = weekCredits(kid, cur), x = screenWeek(kid), paid = !!weekRow(kid, cur)?.paid_at;
  const reads = S.reading.filter(r => r.kid_id === kid.id && r.week_start === cur);
  openSheet(`<div style="display:flex;gap:12px;align-items:center">${avatar(kid)}<h2>${esc(kid.name)}</h2></div>
    <div class="sect"><div class="sect-h"><h3>This week's money</h3></div><div class="list" style="box-shadow:none;border:1px solid var(--line)">
      <div class="row"><span class="ico m">${I.coin}</span><span class="t"><b>Weekly allowance</b><span>Monday</span></span><span class="amt up">+${money(Number(weekRow(kid, cur)?.allowance ?? kid.weekly_allowance))}</span></div>
      ${cr.map(c => `<button class="row" type="button" data-undo="${c.id}" ${paid ? 'disabled' : ''}><span class="ico ${c.kind === 'job' ? 'j' : 'm'}">${c.kind === 'job' ? I.check : I.star}</span><span class="t"><b>${esc(c.title)}</b><span>${paid ? 'Paid' : 'Tap to undo a mistake'}</span></span><span class="amt up">+${money(Number(c.amount))}</span></button>`).join('')}</div></div>
    ${eqHTML(kid, x, `<div class="ptools"><button class="pill soft" id="logOver" type="button">Log screens without the clock</button>${x.sess.length ? '<button class="pill soft" id="undoSess" type="button">Undo last session</button>' : ''}</div>`)}
    <div class="sect"><div class="sect-h"><h3>Reading this week</h3></div><div class="list" style="box-shadow:none;border:1px solid var(--line)">${reads.length ? reads.map(r => readRow(r, kid, true)).join('') : '<div class="empty">No reading yet this week.</div>'}</div></div>
    <button class="pill soft" id="editThisKid" type="button" style="justify-self:start">Edit ${esc(kid.name)}'s settings</button>
    <button class="cancel" data-close type="button">Close</button>`, () => {
    layer.querySelectorAll('[data-undo]').forEach(b => b.onclick = () => { const c = S.credits.find(x => x.id === b.dataset.undo); confirmSheet('Undo this entry?', `${c.title} · ${money(Number(c.amount))}. Use this only to fix a mistake.`, 'Undo entry', () => q(sb.from('credits').delete().eq('id', c.id)), 'Entry removed') });
    layer.querySelectorAll('[data-delread]').forEach(b => b.onclick = () => confirmSheet('Remove this reading session?', 'Its minutes come off this week’s bonus.', 'Remove', () => q(sb.from('reading_sessions').delete().eq('id', b.dataset.delread)), 'Removed'));
    const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn };
    on('logOver', () => overSheet(kid));
    on('undoSess', () => { const l = x.sess[x.sess.length - 1]; confirmSheet('Undo the last session?', `${l.minutes} minutes go back to this week.`, 'Undo', () => q(sb.from('screen_sessions').delete().eq('id', l.id)), 'Minutes returned') });
    on('editThisKid', () => kidSheet(kid));
  });
}
function overSheet(kid) {
  openSheet(`<h2>Screens without the clock</h2><p class="hint">These minutes come off ${esc(kid.name)}'s next week. They'll see the line item.</p>
    <div class="chips">${[10, 15, 20, 30].map(m => `<button class="chip" type="button" data-om="${m}">${m} min</button>`).join('')}</div>
    <div class="field"><label class="label" for="oMin">Minutes</label><input id="oMin" type="number" inputmode="numeric" min="1" value="15"></div>
    <div class="field"><label class="label" for="oNote">Line item</label><input id="oNote" maxlength="120" value="Screens without the clock"></div>
    <button class="save red" id="oGo" type="button">Take off next week</button><button class="cancel" data-close type="button">Cancel</button>`, () => {
    layer.querySelectorAll('[data-om]').forEach(b => b.onclick = () => { $('oMin').value = b.dataset.om });
    $('oGo').onclick = async () => { const m = parseInt($('oMin').value) || 0; if (m < 1) return toast('Enter minutes.'); closeSheet();
      await act(() => q(sb.from('screen_adjust').insert({ family_id: S.family.id, kid_id: kid.id, week_start: addDays(thisWeek(), 7), minutes: m, note: $('oNote').value.trim() || 'Screens without the clock' })), `${m} min off next week`) };
  });
}
function kidSheet(kid) {
  const K = kid ? { ...kid, screen_days: [...(kid.screen_days || [6, 0])] } : { name: '', weekly_allowance: 5, color: Object.keys(COLORS)[S.kids.length % 6], base_screen_minutes: 100, reading_cap: 60, max_read_session: 60, screen_days: [6, 0] };
  const draw = () => openSheet(`<h2>${kid ? `Edit ${esc(kid.name)}` : 'Add a kid'}</h2>
    <div class="field"><label class="label" for="kN">First name</label><input id="kN" maxlength="40" value="${esc(K.name)}"></div>
    <div class="field"><span class="label">Color</span><div class="swatches">${Object.entries(COLORS).map(([n, c]) => `<button class="sw" type="button" data-ksw="${n}" aria-label="${n}" aria-pressed="${K.color === n}" style="background:${c}"></button>`).join('')}</div></div>
    <div class="row2"><div class="field"><label class="label" for="kA">Weekly allowance ($)</label><input id="kA" type="number" min="0" step="0.5" value="${K.weekly_allowance}"></div>
    <div class="field"><label class="label" for="kS">Screen min / week</label><input id="kS" type="number" min="0" step="5" value="${K.base_screen_minutes}"></div></div>
    <div class="row2"><div class="field"><label class="label" for="kR">Reading bonus limit</label><input id="kR" type="number" min="0" step="5" value="${K.reading_cap}"></div>
    <div class="field"><label class="label" for="kM">Longest reading session</label><input id="kM" type="number" min="5" step="5" value="${K.max_read_session}"></div></div>
    <div class="field"><span class="label">Screen days</span><div class="chips">${[1, 2, 3, 4, 5, 6, 0].map(d => `<button class="chip" type="button" data-kd="${d}" aria-pressed="${K.screen_days.includes(d)}">${DOW[d]}</button>`).join('')}</div></div>
    ${kid ? '<p class="hint">A new allowance amount starts next Monday. This week stays the same.</p>' : '<p class="hint">Starts with the standard job board. You can edit it after.</p>'}
    <button class="save" id="kGo" type="button">${kid ? 'Save' : 'Add kid'}</button>
    ${kid ? `<button class="cancel danger-link" id="kDel" type="button">Remove ${esc(kid.name)} and their history</button>` : ''}<button class="cancel" data-close type="button">Cancel</button>`, () => {
    const keep = () => { K.name = $('kN').value; K.weekly_allowance = $('kA').value; K.base_screen_minutes = $('kS').value; K.reading_cap = $('kR').value; K.max_read_session = $('kM').value };
    layer.querySelectorAll('[data-ksw]').forEach(b => b.onclick = () => { keep(); K.color = b.dataset.ksw; draw() });
    layer.querySelectorAll('[data-kd]').forEach(b => b.onclick = () => { keep(); const d = Number(b.dataset.kd); K.screen_days = K.screen_days.includes(d) ? K.screen_days.filter(x => x !== d) : [...K.screen_days, d]; draw() });
    $('kGo').onclick = async () => { keep(); const name = K.name.trim(); if (!name) return toast('Type a first name.'); closeSheet();
      const body = { name, color: K.color, weekly_allowance: Math.max(0, Number(K.weekly_allowance) || 0), base_screen_minutes: Math.max(0, parseInt(K.base_screen_minutes) || 0), reading_cap: Math.max(0, parseInt(K.reading_cap) || 0), max_read_session: Math.min(240, Math.max(5, parseInt(K.max_read_session) || 60)), screen_days: K.screen_days };
      if (kid) await act(() => q(sb.from('kids').update(body).eq('id', kid.id)), 'Saved');
      else await act(() => addKid(name, body.weekly_allowance, body.color).then(k => q(sb.from('kids').update(body).eq('id', k.id))), `${name} added`) };
    if (kid) $('kDel').onclick = () => confirmSheet(`Remove ${kid.name}?`, 'This deletes their job board, earnings history, reading and screen time. It can’t be undone.', 'Remove for good', () => q(sb.from('kids').delete().eq('id', kid.id)), 'Removed');
  });
  draw();
}
function jobSheet(job) {
  const kid = kidById(S.jobKid), cats = [...new Set(S.jobs.filter(j => j.kid_id === kid.id).map(j => j.category).concat(CATALOG.map(c => c.cat)))];
  const J = job ? { ...job } : { title: '', done_means: '', price: 1, category: cats[0], enabled: true };
  openSheet(`<span class="label">${esc(kid.name)}'s board</span><h2>${job ? 'Edit job' : 'New job'}</h2>
    <div class="field"><label class="label" for="jT">Job</label><input id="jT" maxlength="80" value="${esc(J.title)}"></div>
    <div class="field"><label class="label" for="jD">Done means</label><input id="jD" maxlength="160" value="${esc(J.done_means)}" placeholder="What finished looks like"></div>
    <div class="row2"><div class="field"><label class="label" for="jP">Price ($)</label><input id="jP" type="number" min="0" step="0.25" value="${J.price}"></div>
    <div class="field"><label class="label" for="jC">Group</label><select id="jC">${cats.map(c => `<option ${c === J.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div></div>
    <button class="save" id="jGo" type="button">${job ? 'Save' : 'Add to board'}</button>${job ? '<button class="cancel danger-link" id="jDel" type="button">Delete job</button>' : ''}<button class="cancel" data-close type="button">Cancel</button>`, () => {
    $('jGo').onclick = async () => { const title = $('jT').value.trim(); if (!title) return toast('Name the job.'); const price = Math.max(0, r2(parseFloat($('jP').value) || 0)); closeSheet();
      const body = { title, done_means: $('jD').value.trim(), price, category: $('jC').value };
      if (job) await act(() => q(sb.from('jobs').update(body).eq('id', job.id)), 'Saved');
      else await act(() => q(sb.from('jobs').insert({ ...body, family_id: S.family.id, kid_id: kid.id, enabled: true, sort: S.jobs.length })), 'Added') };
    if (job) $('jDel').onclick = () => confirmSheet('Delete this job?', 'Money already earned for it stays.', 'Delete', () => q(sb.from('jobs').delete().eq('id', job.id)), 'Deleted');
  });
}
function copyBoardSheet() {
  const src = kidById(S.jobKid), others = S.kids.filter(k => k.id !== src.id);
  openSheet(`<h2>Copy ${esc(src.name)}'s board</h2><p class="hint">Replaces the other kid's job board with this one, including prices and which jobs are on.</p>
    ${others.map(k => `<button class="row" type="button" data-copyto="${k.id}" style="border:1px solid var(--line);border-radius:14px">${avatar(k)}<span class="t"><b>${esc(k.name)}</b></span></button>`).join('')}
    <button class="cancel" data-close type="button">Cancel</button>`, () => {
    layer.querySelectorAll('[data-copyto]').forEach(b => b.onclick = () => { const k = kidById(b.dataset.copyto); confirmSheet(`Replace ${k.name}'s board?`, 'Their current jobs are swapped for a copy of this board.', 'Replace board', async () => {
      await q(sb.from('jobs').delete().eq('kid_id', k.id));
      await q(sb.from('jobs').insert(S.jobs.filter(j => j.kid_id === src.id).map(j => ({ family_id: S.family.id, kid_id: k.id, title: j.title, done_means: j.done_means, category: j.category, price: j.price, enabled: j.enabled, sort: j.sort }))));
    }, 'Board copied') });
  });
}
function deleteSheet() {
  openSheet(`<h2>Delete everything?</h2><p class="hint">This permanently deletes your family, every kid profile, all earnings history, reading and screen time, and your sign-in. Other parents on this family lose access too.</p>
    <div class="field"><label class="label" for="delType">Type DELETE to confirm</label><input id="delType" autocomplete="off"></div>
    <button class="save red" id="delGo" type="button">Delete my account</button><button class="cancel" data-close type="button">Cancel</button>`, () => {
    $('delGo').onclick = async () => { if ($('delType').value.trim() !== 'DELETE') return toast('Type DELETE to confirm.');
      try { await q(sb.rpc('delete_my_account')); await sb.auth.signOut(); store.set('profile', null); location.reload() } catch (e) { toast(errMsg(e)) } };
  });
}

/* ---------- boot ---------- */
async function enter(session) {
  S.user = session.user;
  try {
    let fid = (await q(sb.from('family_members').select('family_id').eq('user_id', S.user.id).limit(1)))[0]?.family_id;
    if (!fid) fid = await q(sb.rpc('accept_invites'));
    if (!fid) { S.onboard = { step: 0, name: '', tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Denver', pin: '', kids: [], color: 'green' }; S.view = 'onboard'; return render() }
    S.family = { id: fid }; await loadAll();
    const fresh = store.get('signed-in') !== S.user.id; store.set('signed-in', S.user.id); S.canResetPin = fresh;
    const p = store.get('profile');
    if (fresh || !S.family.pin_hash) { S.parentOk = false; S.view = 'who'; render(); if (!S.family.pin_hash) newPinSheet(true); return }
    if (p && (p === 'parent' ? S.parentOk : kidById(p))) setProfile(p); else S.view = 'who';
    render();
  } catch (e) { console.error(e); S.view = 'auth'; render(); toast(errMsg(e)) }
}
let entered = null;
sb.auth.onAuthStateChange((ev, session) => {
  if (session && entered !== session.user.id) { entered = session.user.id; enter(session) }
  if (!session && ev === 'SIGNED_OUT') { entered = null; S.view = 'auth'; render() }
});
sb.auth.getSession().then(({ data }) => { if (!data.session) { S.view = 'auth'; render() } });
render();
