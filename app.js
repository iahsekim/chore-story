/* Chore Story — allowance, job board, reading log and weekend screen clock for families. */
const CFG = window.CHORE_JAR_CONFIG;
const APP = CFG.appName || 'Chore Story';
const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

const COLORS = { green: '#1FA34A', blue: '#2F6BFF', purple: '#7A3FF2', orange: '#FF6B1A', pink: '#F0418C', teal: '#0FA3A3' };
const S = {
  user: null, family: null, members: [], invites: [], kids: [], jobs: [], weeks: [], credits: [], tx: [], reading: [], screen: [], sbonus: [],
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
const titleCase = v => String(v || '').trim().replace(/\s+/g, ' ').replace(/(^|[\s-])(\p{L})/gu, (m, a, c) => a + c.toUpperCase());
const capFirst = v => { const t = String(v || '').trim(); return t ? t[0].toUpperCase() + t.slice(1) : t };
/* Color swatches update in place, so typing in nearby fields is never lost. */
function swatchesHTML(sel, attr = 'data-sw') { return `<div class="swatches" role="radiogroup" aria-label="Color">${Object.entries(COLORS).map(([n, c]) => `<button class="sw" type="button" role="radio" ${attr}="${n}" aria-label="${n}" aria-checked="${sel === n}" aria-pressed="${sel === n}" style="background:${c}"></button>`).join('')}</div>` }
function bindSwatches(root, attr, onPick) { root.querySelectorAll(`[${attr}]`).forEach(b => b.onclick = () => { root.querySelectorAll(`[${attr}]`).forEach(x => { const on = x === b; x.setAttribute('aria-pressed', on); x.setAttribute('aria-checked', on) }); onPick(b.getAttribute(attr)) }) }

/* ---------- data access ---------- */
async function q(p) { const { data, error } = await p; if (error) throw error; return data }
async function loadAll() {
  const fid = S.family.id, since = addDays(today(), -70);
  const [fam, members, invites, kids, jobs, weeks, credits, tx, reading, screen, sbonus] = await Promise.all([
    q(sb.from('families').select('*').eq('id', fid).single()),
    q(sb.from('family_members').select('email,user_id').eq('family_id', fid)),
    q(sb.from('family_invites').select('email').eq('family_id', fid)),
    q(sb.from('kids').select('*').eq('family_id', fid).order('created_at')),
    q(sb.from('jobs').select('*').eq('family_id', fid).order('sort')),
    q(sb.from('weeks').select('*').eq('family_id', fid)),
    q(sb.from('credits').select('*').eq('family_id', fid).order('created_at', { ascending: false })),
    q(sb.from('transactions').select('*').eq('family_id', fid).order('created_at', { ascending: false })),
    q(sb.from('reading_sessions').select('*').eq('family_id', fid).gte('local_date', since).order('started_at', { ascending: false })),
    q(sb.from('screen_sessions').select('*').eq('family_id', fid).gte('local_date', since)),
    q(sb.from('screen_bonus').select('*').eq('family_id', fid).gte('week_start', since)),
  ]);
  Object.assign(S, { family: fam, members, invites, kids, jobs, weeks, credits, tx, reading, screen, sbonus });
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
const isApproved = c => (c.status || 'approved') === 'approved';
const approvedCredits = kid => S.credits.filter(c => c.kid_id === kid.id && isApproved(c));
const pendingClaims = kid => S.credits.filter(c => (!kid || c.kid_id === kid.id) && c.status === 'pending');
const weekCredits = (kid, ws) => approvedCredits(kid).filter(c => c.week_start === ws);
function weekTotal(kid, ws) {
  const w = weekRow(kid, ws);
  const base = w ? Number(w.allowance) : (ws === thisWeek() ? Number(kid.weekly_allowance) : 0);
  return r2(base + weekCredits(kid, ws).reduce((a, c) => a + Number(c.amount), 0));
}
function kidWeeks(kid) { return S.weeks.filter(w => w.kid_id === kid.id).sort((a, b) => b.week_start.localeCompare(a.week_start)) }
/* Bank math. Earned = every week's allowance + jobs + bonuses. Money leaves the balance only
   when a parent pays it out or buys something for the kid with it. Never as a punishment. */
function stats(kid) {
  const cur = thisWeek(), month = today().slice(0, 7);
  let earned = 0, monthT = 0;
  for (const w of kidWeeks(kid)) { const t = weekTotal(kid, w.week_start); earned += t; if (w.week_start.slice(0, 7) === month) monthT += t }
  const tx = S.tx.filter(t => t.kid_id === kid.id);
  const paid = tx.filter(t => t.kind === 'payout').reduce((a, t) => a + Number(t.amount), 0);
  const spent = tx.filter(t => t.kind === 'purchase').reduce((a, t) => a + Number(t.amount), 0);
  return { week: weekTotal(kid, cur), month: r2(monthT), lifetime: r2(earned), paid: r2(paid), spent: r2(spent), balance: r2(earned - paid - spent) };
}
/* How long the balance has been building: last payment, and what each week since added. */
function owedInfo(kid) {
  const st = stats(kid), pays = S.tx.filter(t => t.kid_id === kid.id && t.kind === 'payout').sort((a, b) => b.local_date.localeCompare(a.local_date));
  const last = pays[0]?.local_date || null, since = last ? monday(last) : (kidWeeks(kid).slice(-1)[0]?.week_start || thisWeek());
  const weeks = kidWeeks(kid).filter(w => w.week_start >= since).map(w => ({ ws: w.week_start, amt: weekTotal(kid, w.week_start) })).filter(w => w.amt > 0);
  const days = Math.round((parseD(today()) - parseD(last || since)) / 864e5);
  const saving = goalOf(kid) && st.balance <= Number(kid.goal_amount);
  return { balance: st.balance, last, days, weeks, nudge: st.balance > 0 && days >= 14 && !saving, saving };
}
const goalOf = kid => kid.goal_name && Number(kid.goal_amount) > 0 ? { name: kid.goal_name, amount: Number(kid.goal_amount) } : null;
const ago = d => d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 14 ? `${d} days ago` : `${Math.round(d / 7)} weeks ago`;
/* Every entry in a kid's bank, newest first, each with the balance after it. */
function statement(kid) {
  const L = [];
  for (const w of kidWeeks(kid)) L.push({ date: w.week_start, ts: ms(w.week_start + 'T00:00:00Z'), title: 'Weekly allowance', kind: 'Allowance', v: Number(w.allowance), type: 'allow' });
  for (const c of approvedCredits(kid)) L.push({ date: localDate(ms(c.created_at)), ts: ms(c.created_at), title: c.title, kind: c.kind === 'job' ? 'Job' : 'Bonus', v: Number(c.amount), type: c.kind, id: c.id, week: c.week_start });
  for (const t of S.tx.filter(t => t.kid_id === kid.id)) L.push({ date: t.local_date, ts: ms(t.created_at), title: t.note, kind: t.kind === 'payout' ? 'Paid to ' + kid.name : 'Bought for ' + kid.name, v: -Number(t.amount), type: t.kind, id: t.id });
  L.sort((a, b) => a.date.localeCompare(b.date) || a.ts - b.ts);
  let run = 0; for (const l of L) { run = r2(run + l.v); l.bal = run }
  return L.reverse();
}
/* New money goes to this week, or next week if this week is already paid. */
function creditWeek() { return thisWeek() }
/* ---------- reading + screen math ---------- */
/* Everything is counted in seconds, so 10:40 + 10:20 = 21:00. A timer can be paused;
   its saved seconds plus the running stretch since running_since is the live total. */
const liveSec = r => (Number(r.seconds) || 0) + (r.running_since && !r.ended_at ? Math.max(0, Math.floor((Date.now() - ms(r.running_since)) / 1000)) : 0);
const capSec = kid => (Number(kid.max_read_session) || 60) * 60;
const readSec = (r, kid) => r.source === 'manual' ? Number(r.seconds) || 0 : Math.min(liveSec(r), capSec(kid));
const activeRead = kid => S.reading.find(r => r.kid_id === kid.id && !r.ended_at && r.source !== 'manual' && r.week_start === thisWeek());
function readWeek(kid, ws = thisWeek()) { const sec = S.reading.filter(r => r.kid_id === kid.id && r.week_start === ws).reduce((a, r) => a + readSec(r, kid), 0); const minutes = Math.floor(sec / 60); return { sec, minutes, bonus: Math.min(minutes, Number(kid.reading_cap) || 0) } }
function screenWeek(kid, ws = thisWeek()) {
  const base = Number(kid.base_screen_minutes) || 0, bonus = readWeek(kid, ws).bonus;
  const extra = S.sbonus.filter(a => a.kid_id === kid.id && a.week_start === ws).reduce((a, x) => a + Number(x.minutes), 0) + weekCredits(kid, ws).reduce((a, c) => a + (Number(c.minutes) || 0), 0);
  const sess = S.screen.filter(x => x.kid_id === kid.id && x.week_start === ws).sort((a, b) => ms(a.started_at) - ms(b.started_at));
  const usedSec = sess.reduce((a, x) => a + liveSec(x), 0), totalSec = Math.max(0, (base + bonus + extra) * 60), leftSec = Math.max(0, totalSec - usedSec);
  const active = sess.find(x => !x.ended_at && x.source !== 'manual');
  return { base, bonus, extra, sess, active, usedSec, totalSec, leftSec, left: Math.floor(leftSec / 60) };
}
const hms = sec => { sec = Math.max(0, Math.floor(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), x = sec % 60; return h ? `${h}:${pad(m)}:${pad(x)}` : `${pad(m)}:${pad(x)}` };
const dur = sec => { sec = Math.max(0, Math.floor(sec)); const m = Math.floor(sec / 60), x = sec % 60; return m && x ? `${m} min ${x} sec` : m ? `${m} min` : `${x} sec` };
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
  cash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v5M18 9.5v5"/></svg>',
  bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2"/></svg>',
  coin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .8-3 2s1.3 1.7 3 2 3 .8 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6.5v11"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/></svg>',
  cup: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 10h1.5a2.5 2.5 0 0 1 0 5H17M8 3c0 1.5 1.5 1.5 1.5 3M12 3c0 1.5 1.5 1.5 1.5 3"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.7 4.5c2.1 0 3.6 1.1 4.3 2.5h2c.7-1.4 2.2-2.5 4.3-2.5 3.7 0 5.8 3.8 4.3 7.2C19.5 16.4 12 21 12 21z"/></svg>'
};
const avatar = (k, cls = '') => `<span class="avatar ${cls}" style="background:${COLORS[k.color] || COLORS.green}">${esc((k.name || '?').slice(0, 1))}</span>`;
const supportHTML = (open = false) => `<details class="support" ${open ? 'open' : ''}><summary><span class="cup" aria-hidden="true">${I.cup}</span>Love the app? Buy me a coffee.</summary>
  <div class="support-links"><a class="venmo" href="https://venmo.com/u/${encodeURIComponent(CFG.venmo)}" target="_blank" rel="noopener">Venmo <b>@${esc(CFG.venmo)}</b></a>
  <a class="cash" href="https://cash.app/$${encodeURIComponent(CFG.cashapp)}" target="_blank" rel="noopener">Cash App <b>$${esc(CFG.cashapp)}</b></a>
  ${CFG.paypal ? `<a class="paypal" href="https://www.paypal.com/paypalme/${encodeURIComponent(CFG.paypal)}" target="_blank" rel="noopener">PayPal <b>@${esc(CFG.paypal)}</b></a>` : ''}
  <span class="support-note">It&rsquo;s free! Tips keep it running.</span></div></details>`;

const brandName = () => { const w = APP.split(' '); return w.length > 1 ? `${esc(w.slice(0, -1).join(' '))} <span class="story">${esc(w[w.length - 1])}</span>` : esc(APP) };
/* ---------- playroom backdrop: a few faint paper airplanes, stars and crayon loops drifting slowly behind everything ---------- */
(function playroom() {
  const plane = '<path d="M2 14 30 2 20 30 15 19z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M15 19 30 2" stroke="currentColor" stroke-width="2"/>';
  const star = '<path d="m16 3 3.6 8 8.4.8-6.4 5.6 1.9 8.4L16 21.4 8.5 25.8l1.9-8.4L4 11.8l8.4-.8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>';
  const loop = '<path d="M2 20c6-14 12 6 16-6s8 4 12-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>';
  const items = [[plane, 8, 14, 46, -8, 'a'], [star, 82, 9, 30, 12, 'b'], [loop, 74, 40, 54, 0, 'c'], [plane, 14, 58, 38, 14, 'b'], [star, 88, 72, 26, -10, 'a'], [loop, 6, 86, 48, 8, 'c'], [star, 46, 30, 18, 0, 'b']];
  const el = document.createElement('div'); el.className = 'playroom'; el.setAttribute('aria-hidden', 'true');
  el.innerHTML = items.map(([svg, x, y, size, rot, anim], i) => `<svg class="pr pr-${anim}" style="left:${x}%;top:${y}%;width:${size}px;--r:${rot}deg;animation-delay:-${i * 7}s" viewBox="0 0 32 32">${svg}</svg>`).join('') + '<div class="floor"></div>';
  document.body.prepend(el);
})();
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
    <h1 class="logo-h"><img src="logo-900.png" alt="${esc(APP)}" width="900" height="304"></h1>
    <p class="lede">Allowance, chores, reading and screen time, all in one place kids can see and trust.</p>
    <div class="card form">
      ${code ? `<div class="field"><label class="label" for="codeIn">Enter the code we sent to ${esc(S.authEmail)}</label>
        <input id="codeIn" class="code-in" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="Code"></div>
        <button class="save" id="codeGo" type="button">Sign in</button>
        <p class="hint">Or tap the link in the email on this device. <button class="link" id="authBack" type="button">Use a different email</button></p>`
      : `<div class="field"><label class="label" for="emailIn">Parent email</label>
        <input id="emailIn" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" value="${esc(S.authEmail)}"></div>
        <button class="save" id="emailGo" type="button">Email me a sign-in code</button>
        <p class="hint">No password. We email you a code each time you sign in on a new device. Kids sign in with your email too, then pick their name.</p>`}
    </div>
    <div class="foot">${supportHTML()}<span><button class="link" type="button" data-fb="hi">Contact</button> · <button class="link" type="button" data-privacy>Privacy</button></span></div></section>`;
}
async function sendCode() {
  const email = $('emailIn').value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast('Enter a valid email address.');
  const b = $('emailGo'); b.disabled = true; b.textContent = 'Sending…';
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname } });
  if (error) { b.disabled = false; b.textContent = 'Email me a sign-in code'; console.error(error); return toast(/rate/i.test(error.message) ? 'Too many tries. Wait a minute and try again.' : 'Couldn’t send the email: ' + (error.message || 'unknown error')) }
  S.authEmail = email; S.authStep = 'code'; render(); setTimeout(() => $('codeIn')?.focus(), 50);
}
async function verifyCode() {
  const token = $('codeIn').value.replace(/\D/g, ''), b = $('codeGo');
  if (token.length < 6) return toast('Enter the whole code from the email.');
  if (b.disabled) return; b.disabled = true; b.textContent = 'Checking\u2026';
  let { error } = await sb.auth.verifyOtp({ email: S.authEmail, token, type: 'email' });
  if (error && /expired|invalid/i.test(error.message)) ({ error } = await sb.auth.verifyOtp({ email: S.authEmail, token, type: 'signup' }).then(r => r.error ? { error } : r));
  if (error) { console.error(error); b.disabled = false; b.textContent = 'Sign in'; return toast(/expired|invalid/i.test(error.message) ? 'That code didn\u2019t match or has expired. Use the code in the newest email.' : 'Couldn\u2019t sign in: ' + error.message) }
}

/* ---------- onboarding ---------- */
function onboardHTML() {
  const O = S.onboard;
  const steps = `<div class="steps">${[0, 1, 2].map(i => `<i class="${i <= O.step ? 'on' : ''}"></i>`).join('')}</div>`;
  if (O.step === 0) return `<section class="screen-center">${steps}<h2 style="font:600 34px/1.05 var(--display)">Welcome</h2>
    <p class="lede">Set up your family in about a minute.</p>
    <div class="card form"><div class="field"><label class="label" for="famName">Family name</label><input id="famName" maxlength="60" placeholder="Family name" autocapitalize="words" value="${esc(O.name)}"></div>
    <p class="hint">Weeks start Monday in your time zone: <b>${esc(O.tz)}</b>.</p>
    <button class="save" id="ob0" type="button">Next</button></div></section>`;
  if (O.step === 1) return `<section class="screen-center">${steps}<h2 style="font:600 34px/1.05 var(--display)">Parent PIN</h2>
    <p class="lede">Kids use your email to sign in, so a 4-digit PIN keeps parent tools to you.</p>
    <div class="card form"><div class="field"><label class="label" for="pin1">Choose a PIN</label><input id="pin1" class="pin" inputmode="numeric" type="password" maxlength="4" autocomplete="off"></div>
    <div class="field"><label class="label" for="pin2">Type it again</label><input id="pin2" class="pin" inputmode="numeric" type="password" maxlength="4" autocomplete="off"></div>
    <button class="save" id="ob1" type="button">Next</button></div></section>`;
  const D = O.draft, n = O.kids.length;
  return `<section class="screen-center">${steps}<h2 style="font:600 34px/1.05 var(--display)">Add your kids</h2>
    <p class="lede">First names only. Each kid gets their own job board, which you can change later.</p>
    ${n ? `<div class="card form"><span class="label">Your kids · ${n}</span>${O.kids.map((k, i) => `<div class="kidrow">${avatar(k)}<span><b>${esc(k.name)}</b><span class="hint" style="display:block">${money(Number(k.allowance))} a week</span></span><button class="link" type="button" data-rmkid="${i}">Remove</button></div>`).join('')}</div>` : ''}
    <div class="card form kidform">
      <div class="kidform-h"><span class="avatar" id="kPrev" style="background:${COLORS[D.color]}">${esc((D.name || '?').slice(0, 1).toUpperCase())}</span><span><span class="label">${n ? 'Add another kid' : 'Your first kid'}</span><b id="kPrevName">${esc(D.name || 'First name')}</b></span></div>
      <div class="row2"><div class="field"><label class="label" for="kName">First name</label><input id="kName" maxlength="40" autocomplete="off" autocapitalize="words" value="${esc(D.name)}" placeholder="Name"></div>
      <div class="field"><label class="label" for="kAllow">Weekly allowance ($)</label><input id="kAllow" type="number" inputmode="decimal" min="0" step="0.5" value="${esc(D.allowance)}"></div></div>
      <div class="field"><span class="label">Color</span>${swatchesHTML(D.color)}</div>
      <button class="pill soft" id="kAdd" type="button" style="justify-self:start">+ Save and add another kid</button></div>
    <button class="save" id="ob2" type="button">Finish setup</button></section>`;
}
async function finishOnboard() {
  const O = S.onboard; const b = $('ob2'); b.disabled = true; b.textContent = 'Setting up…';
  try {
    const fid = await q(sb.rpc('create_family', { p_name: titleCase(O.name) || 'Our Family', p_tz: O.tz }));
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
  return `<section class="screen-center"><h1 class="logo-h"><img src="logo-900.png" alt="${esc(APP)}" width="900" height="304"></h1>
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
function stmtRow(l, kid, parent) {
  const ico = l.type === 'job' ? `<span class="ico j">${I.check}</span>` : l.type === 'bonus' ? `<span class="ico m">${I.star}</span>` : l.type === 'payout' ? `<span class="ico s">${I.cash}</span>` : l.type === 'purchase' ? `<span class="ico r">${I.bag}</span>` : `<span class="ico m">${I.coin}</span>`;
  const undoable = parent && l.id && (l.type === 'payout' || l.type === 'purchase' || l.week === thisWeek());
  const tg = undoable ? 'button' : 'div';
  return `<${tg} ${undoable ? `type="button" data-undo="${l.type}|${l.id}"` : ''} class="row">${ico}<span class="t"><b>${esc(l.title)}</b><span>${esc(l.kind)} · ${short(l.date)}</span></span><span class="stack"><span class="amt ${l.v >= 0 ? 'up' : 'out'}">${l.v >= 0 ? '+' : '\u2212'}${money(Math.abs(l.v))}</span><span class="bal num">${money(l.bal)}</span></span></${tg}>`;
}
function kidHome(kid) {
  const st = stats(kid), sw = screenWeek(kid), rw = readWeek(kid), L = statement(kid), g = goalOf(kid), mine = pendingClaims(kid);
  const pct = g ? Math.min(100, Math.round(100 * st.balance / g.amount)) : 0;
  return `<section class="hero" style="--hero:${COLORS[kid.color]}"><div class="label">Held for you</div><div class="big num">${money(st.balance)}</div>
    <div class="hero-foot"><span>This week <b>+${money(st.week)}</b></span><span>Lifetime <b>${money(st.lifetime)}</b></span></div></section>
    <section class="card goal">${g ? `<div class="goal-h"><span class="ico m">${I.star}</span><span class="t"><span class="label">Saving for</span><b>${esc(g.name)}</b></span><span class="num goal-n">${money(Math.min(st.balance, g.amount))} <small>of ${money(g.amount)}</small></span></div>
      <div class="meter"><i style="width:${pct}%;background:var(--money)"></i></div>
      <p class="hint">${st.balance >= g.amount ? `You have enough! Ask a grown-up to buy ${esc(g.name)} with your money.` : `${money(g.amount - st.balance)} to go. Money you leave in your bank counts toward it.`}</p>
      <button class="link" type="button" id="goalBtn" style="justify-self:start">Change goal</button>`
      : `<div class="goal-h"><span class="ico m">${I.star}</span><span class="t"><span class="label">Saving goal</span><b>Saving for something?</b></span></div><p class="hint">Pick something you want and watch your bank fill up toward it.</p><button class="pill" type="button" id="goalBtn" style="justify-self:start">Set a goal</button>`}</section>
    <section class="buckets"><button class="bucket pd ${st.paid ? '' : 'zero'}" type="button" data-txlist="payout"><span class="label">Paid to you</span><b class="num">${money(st.paid)}</b><span class="see">See list</span></button><button class="bucket sp ${st.spent ? '' : 'zero'}" type="button" data-txlist="purchase"><span class="label">Spent on things</span><b class="num">${money(st.spent)}</b><span class="see">See list</span></button></section>
    ${mine.length ? `<section class="sect"><div class="sect-h"><h3>Waiting for a parent</h3></div><div class="list">${mine.map(c => `<div class="row wait-row"><span class="ico j">${I.clock}</span><span class="t"><b>${esc(c.title)}</b><span>You said you did this · ${short(localDate(ms(c.created_at)))}</span></span><span class="amt">+${money(Number(c.amount))}</span></div>`).join('')}</div></section>` : ''}
    <section class="tiles">
      <button class="tile scr" type="button" data-tab="screen"><span class="label">Screen left</span><span class="v num">${sw.left}<small> min</small></span><span class="s">${screenDayNames(kid)}</span></button>
      <button class="tile rdg" type="button" data-tab="read"><span class="label">Reading bonus</span><span class="v num">+${rw.bonus}<small> min</small></span><span class="s">${rw.bonus >= kid.reading_cap ? 'Maxed out this week!' : `${kid.reading_cap - rw.bonus} more to earn`}</span></button>
    </section>
    <section class="sect"><div class="sect-h"><h3>Bank statement</h3>${L.length > 8 ? `<button class="link" type="button" data-allstmt="${kid.id}">See all ${L.length}</button>` : ''}</div>
      <div class="list">${L.slice(0, 8).map(l => stmtRow(l, kid, false)).join('')}</div></section>
    <section class="ptools"><button class="pill soft" id="rulesBtn" type="button">How it works</button></section>`;
}
function kidJobs(kid) {
  const on = S.jobs.filter(j => j.kid_id === kid.id && j.enabled), mine = pendingClaims(kid);
  const cats = ['All', ...new Set(on.map(j => j.category))]; if (!cats.includes(S.jobFilter)) S.jobFilter = 'All';
  return `<section class="card"><p class="hint" style="font-size:15px;color:var(--ink)">Pick any job and do it. Then tap it and press <b>I did it</b>. A parent checks, and the money goes in your bank.</p></section>
    ${mine.length ? `<section class="sect"><div class="sect-h"><h3>Waiting for a parent</h3></div><div class="list">${mine.map(c => `<div class="row wait-row"><span class="ico j">${I.clock}</span><span class="t"><b>${esc(c.title)}</b><span>${short(localDate(ms(c.created_at)))}</span></span><span class="amt">+${money(Number(c.amount))}</span></div>`).join('')}</div></section>` : ''}
    ${on.length ? `<section class="sect"><div class="filters">${cats.map(c => `<button class="chip" type="button" data-cat="${esc(c)}" aria-pressed="${c === S.jobFilter}">${esc(c)}</button>`).join('')}</div>
    <div class="list">${on.filter(j => S.jobFilter === 'All' || j.category === S.jobFilter).sort((a, b) => a.price - b.price).map(j => `<button class="row" type="button" data-claim="${j.id}"><span class="t"><b>${esc(j.title)}</b><span>${esc(j.done_means)}</span></span><span class="stack"><span class="price num">${money(Number(j.price))}</span>${Number(j.bonus_minutes) ? `<span class="bal">+${j.bonus_minutes} screen min</span>` : ''}</span></button>`).join('')}</div></section>`
      : `<div class="list"><div class="empty">No jobs on your board yet.</div></div>`}`;
}
function claimSheet(kid, job) {
  openSheet(`<span class="label">${esc(job.category)}</span><h2>${esc(job.title)}</h2>
    <div class="done-box"><span class="label">Done means</span><b>${esc(job.done_means || 'Finished all the way')}</b></div>
    <p class="hint">A parent will check it. Then <b>${money(Number(job.price))}</b>${Number(job.bonus_minutes) ? ` and <b>${job.bonus_minutes} screen minutes</b>` : ''} go to you.</p>
    <button class="save" id="clGo" type="button" style="background:var(--money)">I did it</button><button class="cancel" data-close type="button">Not yet</button>`, () => {
    $('clGo').onclick = async () => { closeSheet(); await act(() => q(sb.from('credits').insert({ family_id: S.family.id, kid_id: kid.id, week_start: thisWeek(), kind: 'job', title: job.title, amount: Number(job.price), minutes: Number(job.bonus_minutes) || 0, job_id: job.id, status: 'pending' })), 'Sent to a parent to check') };
  });
}
function goalSheet(kid) {
  const g = goalOf(kid);
  openSheet(`<h2>${g ? 'Change your goal' : 'Set a saving goal'}</h2><p class="hint">What are you saving for? Money you leave in your bank counts toward it.</p>
    <div class="field"><label class="label" for="gName">I'm saving for</label><input id="gName" maxlength="60" placeholder="Something you want" value="${esc(g?.name || '')}"></div>
    <div class="field"><label class="label" for="gAmt">It costs ($)</label><input id="gAmt" type="number" inputmode="decimal" min="1" step="0.01" placeholder="0.00" value="${g ? g.amount : ''}"></div>
    <button class="save" id="gGo" type="button" style="background:var(--money)">Save goal</button>${g ? '<button class="cancel danger-link" id="gClear" type="button">Remove goal</button>' : ''}<button class="cancel" data-close type="button">Cancel</button>`, () => {
    $('gGo').onclick = async () => { const name = capFirst($('gName').value), amt = r2(parseFloat($('gAmt').value) || 0); if (!name) return toast('What are you saving for?'); if (amt <= 0) return toast('How much does it cost?'); closeSheet();
      await act(() => q(sb.from('kids').update({ goal_name: name, goal_amount: amt }).eq('id', kid.id)), 'Goal saved') };
    if ($('gClear')) $('gClear').onclick = async () => { closeSheet(); await act(() => q(sb.from('kids').update({ goal_name: null, goal_amount: null }).eq('id', kid.id)), 'Goal removed') };
  });
}
function txListSheet(kid, kind) {
  const rows = S.tx.filter(t => t.kid_id === kid.id && t.kind === kind).sort((a, b) => b.local_date.localeCompare(a.local_date) || ms(b.created_at) - ms(a.created_at));
  const total = rows.reduce((a, t) => a + Number(t.amount), 0);
  openSheet(`<span class="label">${esc(kid.name)} · ${money(total)} total</span><h2>${kind === 'payout' ? 'Paid to you' : 'Spent on things'}</h2>
    <div class="list">${rows.length ? rows.map(t => `<div class="row"><span class="ico ${kind === 'payout' ? 's' : 'r'}">${kind === 'payout' ? I.cash : I.bag}</span><span class="t"><b>${esc(t.note)}</b><span>${short(t.local_date)}</span></span><span class="amt">${money(Number(t.amount))}</span></div>`).join('') : `<div class="empty">${kind === 'payout' ? 'Nothing paid out yet. Your money is waiting in your bank.' : 'Nothing bought yet.'}</div>`}</div>
    <button class="cancel" data-close type="button">Close</button>`);
}
function kidRead(kid) {
  const rw = readWeek(kid), a = activeRead(kid), cap = Number(kid.reading_cap) || 1;
  const mine = S.reading.filter(r => r.kid_id === kid.id && r !== a).sort((x, y) => ms(y.started_at) - ms(x.started_at)).slice(0, 30);
  return `<section class="board rdb" id="readBoard">${readBoardHTML(kid)}</section>
    <section class="card progress"><div class="top"><span class="label">Bonus screen minutes</span><span class="v num" style="color:var(--read)">+${rw.bonus}<small> of ${cap}</small></span></div>
    <div class="meter"><i style="width:${Math.min(100, 100 * rw.bonus / cap)}%;background:var(--read)"></i></div>
    <p class="hint"><b>${dur(rw.sec)}</b> read this week. Every second counts, and each full minute adds a screen minute. Chapter books and graphic novels count. Starts over every Monday.</p>
    <div class="ptools"><button class="pill soft" type="button" data-manual="read">+ Add reading by hand</button></div></section>
    <section class="sect"><div class="sect-h"><h3>Reading log</h3></div><div class="list">${mine.length ? mine.map(r => readRow(r, kid, false)).join('') : '<div class="empty">Nothing logged yet. Tap Start reading and the time counts itself.</div>'}</div></section>`;
}
function readRow(r, kid, parent) {
  const tg = parent ? 'button' : 'div', st = r.source === 'manual' ? 'Added by a parent' : !r.ended_at ? (r.running_since ? 'Reading now' : 'Paused') : clockTime(ms(r.started_at));
  return `<${tg} ${parent ? `type="button" data-delread="${r.id}"` : ''} class="row"><span class="ico r">${I.read}</span><span class="t"><b>${esc(r.book)}</b><span>${short(r.local_date)} · ${st}${parent ? ' · tap to remove' : ''}</span></span><span class="amt rd">+${dur(readSec(r, kid))}</span></${tg}>`;
}
function readBoardHTML(kid) {
  const a = activeRead(kid);
  if (a) { const run = !!a.running_since, sec = readSec(a, kid);
    return `<div class="bline"><span class="label">${run ? 'Reading now' : 'Paused'}</span><b>${esc(a.book)}</b></div>
    <div class="digits num ${run ? '' : 'idle'}" id="readDigits">${hms(sec)}</div>
    <p class="note">${run ? `Stops itself at ${kid.max_read_session}:00. Pause any time.` : 'Your time is saved. Tap Resume when you pick the book back up.'}</p>
    <div class="row2">${run ? '<button class="ghost" id="pauseRead" type="button">Pause</button>' : '<button class="ghost" id="resumeRead" type="button">Resume</button>'}<button class="go white" id="stopRead" type="button">I'm done</button></div>`; }
  return `<div class="bline"><span class="label">Reading timer</span><span>1 min = <b>1 screen min</b></span></div>
    <div class="digits idle num">00:00</div><button class="go white" id="startRead" type="button">Start reading</button>`;
}
let pick = null, confirming = false;
function screenRow(x) {
  const man = x.source === 'manual', st = man ? 'Added by a parent' : !x.ended_at ? (x.running_since ? 'Running now' : 'Paused') : clockTime(ms(x.started_at));
  return `<div class="row"><span class="ico s">${I.screen}</span><span class="t"><b>${man ? esc(x.note || 'Screen time') : 'Screen session'}</b><span>${short(x.local_date)} · ${st}</span></span><span class="amt">${dur(liveSec(x))}</span></div>`;
}
function kidScreen(kid) {
  const x = screenWeek(kid);
  const rows = [...x.sess].reverse().map(screenRow)
    .concat(S.sbonus.filter(a => a.kid_id === kid.id && a.week_start === thisWeek()).map(a => `<div class="row"><span class="ico m">${I.star}</span><span class="t"><b>${esc(a.note)}</b><span>Bonus minutes · ${short(localDate(ms(a.created_at)))}</span></span><span class="amt up">+${a.minutes} min</span></div>`))
    .concat(weekCredits(kid, thisWeek()).filter(c => Number(c.minutes) > 0).map(c => `<div class="row"><span class="ico j">${I.check}</span><span class="t"><b>${esc(c.title)}</b><span>Job bonus minutes</span></span><span class="amt up">+${c.minutes} min</span></div>`));
  return `<section class="board" id="board">${boardHTML(kid)}</section>${eqHTML(kid, x, '<div class="ptools"><button class="pill soft" type="button" data-manual="screen">+ Add screen time by hand</button></div>')}
    <section class="sect"><div class="sect-h"><h3>Sessions</h3></div><div class="list">${rows.length ? rows.join('') : '<div class="empty">No sessions yet this week.</div>'}</div></section>`;
}
function eqHTML(kid, x, extra = '') {
  return `<section class="card"><span class="label">This week · ${screenDayNames(kid)}</span>
    <div class="eq"><span class="term"><b class="num">${x.base}</b><span>Base</span></span><span class="op">+</span><span class="term"><b class="num" style="color:var(--read)">${x.bonus}</b><span>Reading</span></span>
    ${x.extra ? `<span class="op">+</span><span class="term"><b class="num" style="color:var(--money)">${x.extra}</b><span>Bonus</span></span>` : ''}
    ${x.usedSec ? `<span class="op">\u2212</span><span class="term"><b class="num" id="eqUsed">${hms(x.usedSec)}</b><span>Used</span></span>` : ''}
    <span class="op">=</span><span class="term res"><b class="num" id="eqLeft">${hms(x.leftSec)}</b><span>Left</span></span></div>${extra}</section>`;
}
function boardHTML(kid) {
  const x = screenWeek(kid), a = x.active;
  if (a) { const run = !!a.running_since;
    return `<div class="bline"><span class="label">${run ? 'Clock running' : 'Paused'}</span><span>This session <b id="sessUsed">${hms(liveSec(a))}</b></span></div>
      <div class="digits num ${run ? '' : 'idle'}" id="digits">${hms(x.leftSec)}</div><div class="bar"><i id="barfill" style="width:${x.totalSec ? 100 * x.usedSec / x.totalSec : 100}%"></i></div>
      <p class="note">${run ? 'Time left this week. Pause whenever you stop. At zero, screens go off.' : 'Clock is paused, so screens are off. Tap Resume to keep going.'}</p>
      <div class="row2">${run ? '<button class="ghost" id="pauseScr" type="button">Pause</button>' : '<button class="go" id="resumeScr" type="button">Resume</button>'}<button class="ghost" id="doneScr" type="button">I'm done</button></div>`; }
  if (!isScreenDay(kid)) return `<div class="bline"><span class="label">Screen clock</span><span>Opens <b>${screenDayNames(kid)}</b></span></div>
    <div class="digits idle num">${hms(x.leftSec)}</div><p class="note">That's your time so far. Reading this week adds more.</p>`;
  if (!x.leftSec) return `<div class="bline"><span class="label">Screen clock</span></div><div class="digits idle num">00:00</div><p class="note">All of this week's time is used. New time starts Monday.</p>`;
  return `<div class="bline"><span class="label">Ready</span><span><b>${dur(x.leftSec)}</b> left this week</span></div><div class="digits num">${hms(x.leftSec)}</div>
    <p class="note">Start the clock when screens go on. Pause it when you stop.</p><button class="go" id="startBtn" type="button">Start clock</button>`;
}
/* ---------- parent app ---------- */
const PTABS = [['kids', 'Kids', 'kids'], ['jobs', 'Job boards', 'jobs'], ['pay', 'Bank', 'pay'], ['settings', 'Settings', 'gear']];
function parentAppHTML() {
  
  const greet = { kids: 'Parent', jobs: 'Edit each kid’s board', pay: 'What you owe', settings: 'Family settings' }[S.ptab];
  return `<header><div class="hello"><small>${greet}</small><h1>${esc(S.family.name || APP)}</h1></div>
    <button class="lock on" id="swapBtn" type="button">${I.swap} Switch</button></header>
    <main>${({ kids: pKids, jobs: pJobs, pay: pPay, settings: pSettings })[S.ptab]()}</main>
    ${tabbar(PTABS, S.ptab, { kids: pendingClaims().length })}`;
}
function pKids() {
  if (!S.kids.length) return `<div class="card"><p class="hint">Add your first kid to get started.</p><button class="save" id="addKidBtn" type="button">+ Add a kid</button></div>`;
  const pend = pendingClaims();
  let h = pend.length ? `<section class="sect"><div class="sect-h"><h3>Needs your OK</h3><span class="label">${pend.length}</span></div><div class="list">${pend.map(c => { const k = kidById(c.kid_id); return `<div class="row wait-row">${avatar(k)}<span class="t"><b>${esc(c.title)}</b><span>${esc(k?.name || '')} says it's done · ${short(localDate(ms(c.created_at)))}</span></span>
      <span class="decide"><button class="pill soft" type="button" data-notyet="${c.id}">Not yet</button><button class="pill ok" type="button" data-approve="${c.id}">OK +${money(Number(c.amount))}${Number(c.minutes) ? ` +${c.minutes}m` : ''}</button></span></div>` }).join('')}</div></section>` : '';
  for (const k of S.kids) { const o = owedInfo(k); if (o.nudge) h += `<div class="nudge"><span><b>You owe ${esc(k.name)} ${money(o.balance)}</b> · ${o.last ? `last paid ${ago(o.days)}` : `nothing paid yet, ${o.weeks.length} week${o.weeks.length === 1 ? '' : 's'} of earnings`}</span><button class="pill" type="button" data-payall="${k.id}">Paid all ${money(o.balance)}</button></div>` }
  return h + S.kids.map(k => {
    const st = stats(k), sw = screenWeek(k), rw = readWeek(k), o = owedInfo(k), g = goalOf(k);
    return `<article class="kcard"><div class="kh">${avatar(k)}<h3>${esc(k.name)}</h3><span class="wk num" style="color:color-mix(in srgb, ${COLORS[k.color]} 78%, var(--ink))">${money(st.balance)}<small>You owe</small></span></div>
      <div class="owedline">${o.saving ? `Saving for ${esc(g.name)} · ${money(Math.min(st.balance, g.amount))} of ${money(g.amount)}` : o.last ? `Last paid ${short(o.last)} (${ago(o.days)})` : 'Not paid out yet'}</div>
      <div class="kstats"><div><b class="num">${money(st.week)}</b><span>This week</span></div><div><b class="num">${money(st.month)}</b><span>Month</span></div><div><b class="num">${money(st.lifetime)}</b><span>Lifetime</span></div></div>
      <div class="kstats"><div><b class="num">${hms(sw.leftSec)}</b><span>Screen left</span></div><div><b class="num" style="color:var(--read)">+${rw.bonus}</b><span>Reading bonus</span></div><div><b class="num">${hms(rw.sec)}</b><span>Read</span></div></div>
      <div class="kact"><button class="pill" type="button" data-logjob="${k.id}">Log a job</button><button class="pill ok" type="button" data-bonus="${k.id}">Add bonus</button><button class="pill soft" type="button" data-more="${k.id}">More</button></div></article>`;
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
  return S.kids.map(k => {
    const st = stats(k), L = statement(k);
    return `<section class="sect"><div class="sect-h"><h3 style="display:flex;align-items:center;gap:10px">${avatar(k)}${esc(k.name)}</h3></div>
      <div class="card bankcard"><span class="label">You owe ${esc(k.name)}</span><b class="bankbig num">${money(st.balance)}</b>
        ${(() => { const o = owedInfo(k), g = goalOf(k); return `<p class="hint owedhint">${o.last ? `Last paid <b>${short(o.last)}</b>, ${ago(o.days)}.` : 'Nothing paid out yet.'}${g ? ` Saving for <b>${esc(g.name)}</b> (${money(g.amount)}).` : ''}</p>${o.weeks.length ? `<div class="weeksince">${o.weeks.map(w => `<span><small>Week of ${md(w.ws)}</small><b class="num">${money(w.amt)}</b></span>`).join('')}</div>` : ''}` })()}
        <div class="kstats flat"><div><b class="num">${money(st.lifetime)}</b><span>Earned</span></div><div><b class="num">${money(st.paid)}</b><span>Paid out</span></div><div><b class="num">${money(st.spent)}</b><span>Spent</span></div></div>
        <div class="row2"><button class="pill" type="button" data-payout="${k.id}">Paid ${esc(k.name)}</button><button class="pill soft" type="button" data-purchase="${k.id}">Bought something</button></div></div>
      <div class="list">${L.slice(0, 10).map(l => stmtRow(l, k, true)).join('')}</div>
      ${L.length > 10 ? `<button class="link" type="button" data-allstmt="${k.id}" style="justify-self:start">See all ${L.length} entries</button>` : ''}</section>`;
  }).join('') + `<p class="hint">Tap an entry from this week, or any payment or purchase, to undo a mistake.</p>`;
}
function pSettings() {
  const F = S.family;
  return `<section class="sect"><div class="sect-h"><h3>Kids</h3></div><div class="list">${S.kids.map(k => `<button class="row" type="button" data-editkid="${k.id}">${avatar(k)}<span class="t"><b>${esc(k.name)}</b><span>${money(Number(k.weekly_allowance))} a week · ${k.base_screen_minutes} screen min · reading up to +${k.reading_cap}</span></span></button>`).join('')}</div>
    <button class="pill soft" id="addKidBtn" type="button" style="justify-self:start">+ Add a kid</button></section>
    ${S.kids.length ? `<section class="sect"><div class="sect-h"><h3>Screen time</h3></div>${S.kids.map(k => `<div class="card scrset">
      <div class="kidform-h">${avatar(k)}<b>${esc(k.name)}</b></div>
      <div class="row2"><div class="field"><label class="label" for="sb-${k.id}">Base minutes / week</label><input id="sb-${k.id}" type="number" inputmode="numeric" min="0" step="5" value="${k.base_screen_minutes}"></div>
      <div class="field"><label class="label" for="sr-${k.id}">Reading bonus limit</label><input id="sr-${k.id}" type="number" inputmode="numeric" min="0" step="5" value="${k.reading_cap}"></div></div>
      <div class="field"><span class="label">Screen days</span><div class="chips daychips">${[1, 2, 3, 4, 5, 6, 0].map(d => `<button class="chip" type="button" data-sday="${k.id}|${d}" aria-pressed="${(k.screen_days || []).includes(d)}">${DOW[d]}</button>`).join('')}</div></div>
      <button class="pill" type="button" data-savescr="${k.id}" style="justify-self:start">Save ${esc(k.name)}'s screen time</button></div>`).join('')}</section>` : ''}
    <section class="card"><span class="label">Family</span>
      <div class="field"><label class="label" for="sFam">Family name</label><input id="sFam" maxlength="60" autocapitalize="words" value="${esc(F.name)}"></div>
      <div class="field"><label class="label" for="sTz">Time zone (weeks reset Monday here)</label><select id="sTz">${tzOptions(F.timezone)}</select></div>
      <button class="save" id="saveFam" type="button">Save</button>
      <button class="pill soft" id="changePin" type="button" style="justify-self:start">Change parent PIN</button></section>
    <section class="card"><span class="label">Parents on this family</span>
      ${S.members.map(m => `<div class="hint" style="color:var(--ink)">${esc(m.email || 'Parent')}${m.user_id === S.user.id ? ' (you)' : ''}</div>`).join('')}
      ${S.invites.map(i => `<div class="hint">${esc(i.email)} · invited</div>`).join('')}
      <div class="field"><label class="label" for="invEmail">Invite another parent</label><input id="invEmail" type="email" placeholder="Email address"></div>
      <button class="pill" id="invGo" type="button" style="justify-self:start">Add parent</button>
      <p class="hint">They sign in at this site with that email and join your family automatically.</p></section>
    <section class="card"><span class="label">Contact & feedback</span><p class="hint">Found a bug, have an idea, or just want to say hi? It goes straight to the person who makes ${esc(APP)}.</p>
      <div class="ptools"><button class="pill soft" type="button" data-fb="bug">Report a bug</button><button class="pill soft" type="button" data-fb="idea">Request a feature</button><button class="pill soft" type="button" data-fb="hi">Say hi</button></div></section>
    <section class="card"><span class="label">Support ${esc(APP)}</span><p class="hint">${esc(APP)} is free. If it helps your family, a coffee keeps it running.</p>${supportHTML(true)}</section>
    <section class="card"><span class="label">Account</span><p class="hint">Signed in as ${esc(S.user.email)}</p>
      <div class="ptools"><button class="pill soft" id="signOut" type="button">Sign out</button><button class="pill no" id="delAcct" type="button">Delete account and all data</button></div>
      <button class="link" type="button" data-privacy style="justify-self:start">Privacy</button></section>`;
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
  if ($('codeIn')) $('codeIn').onkeydown = e => { if (e.key === 'Enter') verifyCode() };
  // onboarding
  if ($('famName')) $('famName').onblur = e => { e.target.value = titleCase(e.target.value) };
  on('ob0', () => { S.onboard.name = titleCase($('famName').value) || 'Our Family'; S.onboard.step = 1; render() });
  on('ob1', () => { const a = $('pin1').value, b = $('pin2').value; if (!/^\d{4}$/.test(a)) return toast('Use 4 digits.'); if (a !== b) return toast('The PINs don’t match.'); S.onboard.pin = a; S.onboard.step = 2; render() });
  if (S.view === 'onboard' && S.onboard.step === 2) {
    const D = S.onboard.draft, prev = () => { const p = $('kPrev'); if (p) { p.style.background = COLORS[D.color]; p.textContent = (D.name || '?').slice(0, 1).toUpperCase() } const nm = $('kPrevName'); if (nm) nm.textContent = D.name || 'First name' };
    $('kName').oninput = e => { D.name = e.target.value; prev() };
    $('kName').onblur = e => { e.target.value = D.name = capFirst(e.target.value); prev() };
    $('kAllow').oninput = e => { D.allowance = e.target.value };
    bindSwatches(app, 'data-sw', c => { D.color = c; prev() });
    const take = () => { const nm = capFirst(D.name); if (!nm) return false; S.onboard.kids.push({ name: nm, allowance: Number(D.allowance) || 0, color: D.color }); const keys = Object.keys(COLORS); S.onboard.draft = { name: '', allowance: D.allowance || '5', color: keys[S.onboard.kids.length % keys.length] }; return true };
    on('kAdd', () => { if (!take()) { toast('Type a first name first.'); return $('kName').focus() } render(); toast('Added. Add another, or tap Finish setup.'); $('kName')?.focus() });
    on('ob2', () => { take(); if (!S.onboard.kids.length) { toast('Add at least one kid.'); return $('kName').focus() } finishOnboard() });
  }
  each('[data-rmkid]', el => { S.onboard.kids.splice(Number(el.dataset.rmkid), 1); render() });
  // who
  each('[data-who]', el => chooseProfile(el.dataset.who));
  on('swapBtn', switchProfile);
  // tabs
  each('[data-tab]', el => { if (S.view === 'parent') S.ptab = el.dataset.tab; else S.tab = el.dataset.tab; confirming = false; render(); window.scrollTo(0, 0) });
  each('[data-cat]', el => { S.jobFilter = el.dataset.cat; render() });
  each('[data-manual]', el => manualGate(kidById(el.dataset.kid || S.profile), el.dataset.manual));
  on('rulesBtn', () => rulesSheet(kidById(S.profile)));
  // kid boards
  bindBoards();
  // parent
  each('[data-logjob]', el => logJobSheet(kidById(el.dataset.logjob)));
  each('[data-claim]', el => claimSheet(kidById(S.profile), S.jobs.find(j => j.id === el.dataset.claim)));
  each('[data-approve]', el => act(() => q(sb.from('credits').update({ status: 'approved' }).eq('id', el.dataset.approve)), 'Approved'));
  each('[data-notyet]', el => act(() => q(sb.from('credits').delete().eq('id', el.dataset.notyet)), 'Sent back to the board'));
  each('[data-payall]', el => { const k = kidById(el.dataset.payall); txSheet(k, 'payout', { amount: stats(k).balance, note: 'Paid in full' }) });
  each('[data-txlist]', el => txListSheet(kidById(S.profile), el.dataset.txlist));
  on('goalBtn', () => goalSheet(kidById(S.profile)));
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
  each('[data-payout]', el => txSheet(kidById(el.dataset.payout), 'payout'));
  each('[data-purchase]', el => { const k = kidById(el.dataset.purchase), g = goalOf(k); txSheet(k, 'purchase', g && stats(k).balance >= g.amount ? { amount: g.amount, note: g.name } : {}) });
  each('[data-allstmt]', el => statementSheet(kidById(el.dataset.allstmt)));
  bindUndo(app);
  on('saveFam', () => act(() => q(sb.from('families').update({ name: titleCase($('sFam').value) || 'Our Family', timezone: $('sTz').value }).eq('id', S.family.id)), 'Saved'));
  on('changePin', () => newPinSheet());
  on('invGo', () => { const e = $('invEmail').value.trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return toast('Enter a valid email.'); act(() => q(sb.from('family_invites').upsert({ family_id: S.family.id, email: e })), 'Invite saved') });
  on('signOutWho', async () => { await sb.auth.signOut(); store.set('profile', null); store.set('signed-in', null); location.reload() });
  on('signOut', async () => { await sb.auth.signOut(); store.set('profile', null); location.reload() });
  on('delAcct', deleteSheet);
  each('[data-sday]', el => el.setAttribute('aria-pressed', el.getAttribute('aria-pressed') !== 'true'));
  each('[data-savescr]', el => { const id = el.dataset.savescr, days = [...app.querySelectorAll(`[data-sday^="${id}|"]`)].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => Number(b.dataset.sday.split('|')[1]));
    if (!days.length) return toast('Pick at least one screen day.');
    act(() => q(sb.from('kids').update({ base_screen_minutes: Math.max(0, parseInt($('sb-' + id).value) || 0), reading_cap: Math.max(0, parseInt($('sr-' + id).value) || 0), screen_days: days }).eq('id', id)), 'Screen time saved') });
  each('[data-fb]', el => feedbackSheet(el.dataset.fb));
  each('[data-privacy]', () => privacySheet());
}
function bindBoards() {
  const kid = kidById(S.profile); if (!kid) return;
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn };
  on('startBtn', () => startScreen(kid)); on('pauseScr', () => pauseTimer('screen_sessions', screenWeek(kid).active));
  on('resumeScr', () => { unlockAudio(); resumeTimer('screen_sessions', screenWeek(kid).active) }); on('doneScr', () => doneTimer('screen_sessions', screenWeek(kid).active, 'Clock stopped'));
  on('startRead', () => readStartSheet(kid)); on('pauseRead', () => pauseTimer('reading_sessions', activeRead(kid), kid));
  on('resumeRead', () => resumeTimer('reading_sessions', activeRead(kid))); on('stopRead', () => stopRead(kid));
}
function rerenderBoards() { const kid = kidById(S.profile); if (!kid) return; const b = $('board'); if (b) b.innerHTML = boardHTML(kid); const r = $('readBoard'); if (r) r.innerHTML = readBoardHTML(kid); bindBoards() }
async function startScreen(kid) {
  if (screenWeek(kid).active) return; unlockAudio(); const d = today(), now = new Date().toISOString();
  await act(() => q(sb.from('screen_sessions').insert({ family_id: S.family.id, kid_id: kid.id, local_date: d, week_start: monday(d), started_at: now, running_since: now, seconds: 0, source: 'clock' })));
}
const timerSec = (row, kid) => kid ? Math.min(liveSec(row), capSec(kid)) : liveSec(row);
async function pauseTimer(table, row, kid) { if (!row || !row.running_since) return; await act(() => q(sb.from(table).update({ seconds: timerSec(row, kid), running_since: null }).eq('id', row.id)), 'Paused. Your time is saved.') }
async function resumeTimer(table, row) { if (!row || row.running_since) return; await act(() => q(sb.from(table).update({ running_since: new Date().toISOString() }).eq('id', row.id))) }
async function doneTimer(table, row, msg, kid, secOverride) { if (!row) return; const sec = secOverride ?? timerSec(row, kid); await act(() => q(sb.from(table).update({ seconds: sec, running_since: null, ended_at: new Date().toISOString() }).eq('id', row.id)), msg) }
async function stopRead(kid) {
  const a = activeRead(kid); if (!a) return; const sec = timerSec(a, kid);
  await doneTimer('reading_sessions', a, sec >= 60 ? `+${dur(sec)} of reading` : `+${sec} sec. It all adds up.`, kid);
}
function txSheet(kid, kind, pre = {}) {
  const st = stats(kid), pay = kind === 'payout';
  openSheet(`<span class="label">${esc(kid.name)} has ${money(st.balance)}</span><h2>${pay ? `You paid ${esc(kid.name)}` : `You bought something for ${esc(kid.name)}`}</h2>
    <p class="hint">${pay ? 'Cash, a transfer, or anything you handed over. It comes out of what you owe.' : 'Something you paid for with their money. It comes out of their balance.'}</p>
    ${pay && st.balance > 0 ? `<div class="chips"><button class="chip" type="button" data-amt="${st.balance}">All of it · ${money(st.balance)}</button>${[5, 10, 20].filter(a => a < st.balance).map(a => `<button class="chip" type="button" data-amt="${a}">$${a}</button>`).join('')}</div>` : ''}
    <div class="field"><label class="label" for="tAmt">Amount ($)</label><input id="tAmt" type="number" inputmode="decimal" min="0.01" step="0.01" placeholder="0.00" value="${pre.amount ? Number(pre.amount).toFixed(2) : ''}"></div>
    <div class="field"><label class="label" for="tWhy">Explanation ${esc(kid.name)} will see</label><input id="tWhy" maxlength="120" placeholder="${pay ? 'Cash' : 'What you bought'}" value="${esc(pre.note || '')}"></div>
    <div class="field"><label class="label" for="tDate">Date</label><input id="tDate" type="date" value="${today()}" max="${today()}"></div>
    <button class="save" id="tGo" type="button">${pay ? 'Record payment' : 'Record purchase'}</button><button class="cancel" data-close type="button">Cancel</button>`, () => {
    layer.querySelectorAll('[data-amt]').forEach(b => b.onclick = () => { $('tAmt').value = Number(b.dataset.amt).toFixed(2) });
    $('tGo').onclick = async () => {
      const a = r2(parseFloat($('tAmt').value) || 0), why = $('tWhy').value.trim(), d = $('tDate').value || today();
      if (a <= 0) return toast('Enter an amount.');
      if (!why) return toast('Add an explanation so ' + kid.name + ' knows what this was.');
      if (a > stats(kid).balance + 0.001) return toast(`That's more than ${kid.name} has (${money(stats(kid).balance)}).`);
      closeSheet();
      await act(() => q(sb.from('transactions').insert({ family_id: S.family.id, kid_id: kid.id, kind, amount: a, note: why, local_date: d })), pay ? `Paid ${kid.name} ${money(a)}` : `${money(a)} purchase recorded`);
    };
  });
}
function statementSheet(kid) {
  const parent = S.view === 'parent';
  openSheet(`<span class="label">${esc(kid.name)} · ${money(stats(kid).balance)}</span><h2>Bank statement</h2><div class="list">${statement(kid).map(l => stmtRow(l, kid, parent)).join('')}</div><button class="cancel" data-close type="button">Close</button>`, () => bindUndo(layer));
}
function bindUndo(root) {
  root.querySelectorAll('[data-undo]').forEach(b => b.onclick = () => {
    const [type, id] = b.dataset.undo.split('|'), isTx = type === 'payout' || type === 'purchase';
    const row = isTx ? S.tx.find(x => x.id === id) : S.credits.find(x => x.id === id); if (!row) return;
    confirmSheet('Undo this entry?', `${isTx ? row.note : row.title} · ${money(Number(row.amount))}. Use this only to fix a mistake.`, 'Undo entry', () => q(sb.from(isTx ? 'transactions' : 'credits').delete().eq('id', id)), 'Entry removed');
  });
}
/* ticking: updates the display; it only writes to stop a timer that has run out */
let wasActive = null, wakeLock = null, audio = null, autoStopping = false;
setInterval(() => {
  if (S.view !== 'kid') return; const kid = kidById(S.profile); if (!kid) return;
  const x = screenWeek(kid), a = x.active, id = a && a.running_since ? a.id : null;
  if (id !== wasActive) { if (id) holdWake(); else releaseWake(); wasActive = id }
  if (a && a.running_since && x.leftSec <= 0 && !autoStopping) {
    autoStopping = true; beep();
    doneTimer('screen_sessions', a, 'Time\u2019s up for this week', null, Math.max(0, liveSec(a) - (x.usedSec - x.totalSec))).finally(() => { autoStopping = false });
    return;
  }
  if (a && a.running_since) { const d = $('digits'); if (d) d.textContent = hms(x.leftSec); const su = $('sessUsed'); if (su) su.textContent = hms(liveSec(a)); const f = $('barfill'); if (f) f.style.width = (x.totalSec ? 100 * x.usedSec / x.totalSec : 100) + '%'; const el = $('eqLeft'); if (el) el.textContent = hms(x.leftSec); const eu = $('eqUsed'); if (eu) eu.textContent = hms(x.usedSec) }
  const r = activeRead(kid);
  if (r && r.running_since) { if (liveSec(r) >= capSec(kid) && !autoStopping) { autoStopping = true; doneTimer('reading_sessions', r, `Reading timer stopped at ${kid.max_read_session}:00`, kid).finally(() => { autoStopping = false }); return } const rd = $('readDigits'); if (rd) rd.textContent = hms(readSec(r, kid)) }
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
    <li><span><b>Every Monday you get ${money(Number(kid.weekly_allowance))}.</b> That's your allowance, no matter what.</span></li>
    <li><span><b>Jobs add money.</b> Tap a job and press I did it. A parent checks, then it's yours.</span></li>
    <li><span><b>Anything you earn is yours to keep.</b> It stays in your bank until you ask for it or save up for something.</span></li>
    <li><span><b>Your money stays in your bank</b> until you get paid or a parent buys something for you with it. Every entry says why.</span></li>
    <li><span><b>Money is never taken away as a punishment.</b></span></li>
    <li><span><b>${kid.base_screen_minutes} screen minutes each week</b> on ${screenDayNames(kid)}.</span></li>
    <li><span><b>1 minute reading = 1 screen minute,</b> up to ${kid.reading_cap} a week. Chapter books and graphic novels count.</span></li>
    <li><span><b>Screens only while the clock runs.</b> Pause it whenever you stop.</span></li>
    <li><span><b>Extra screen minutes</b> come from reading, some jobs, and bonuses.</span></li>
    <li><span><b>Every second counts.</b> Reading and screen time add up to the second.</span></li>
    <li><span><b>If it's not written here, it's not a rule.</b></span></li></ol><button class="save" data-close type="button">Got it</button>`);
}
function readStartSheet(kid) {
  const books = [...new Set(S.reading.filter(r => r.kid_id === kid.id).map(r => r.book))].slice(0, 6);
  openSheet(`<h2>Start reading</h2><div class="field"><label class="label" for="bookIn">What are you reading?</label><input id="bookIn" maxlength="100" placeholder="Book title" value="${esc(books[0] || '')}">
    ${books.length ? `<div class="chips">${books.map(b => `<button class="chip" type="button" data-book="${esc(b)}">${esc(b)}</button>`).join('')}</div>` : ''}</div>
    <p class="hint">Chapter books and graphic novels count. Audiobooks don't.</p><button class="save" id="rdGo" type="button" style="background:var(--read)">Start the timer</button><button class="cancel" data-close type="button">Cancel</button>`, () => {
    layer.querySelectorAll('[data-book]').forEach(b => b.onclick = () => { $('bookIn').value = b.dataset.book });
    $('rdGo').onclick = async () => { const book = $('bookIn').value.trim(); if (!book) return toast('Type the book’s title.'); if (activeRead(kid)) return closeSheet(); closeSheet(); const d = today();
      const now = new Date().toISOString(); await act(() => q(sb.from('reading_sessions').insert({ family_id: S.family.id, kid_id: kid.id, book, local_date: d, week_start: monday(d), started_at: now, running_since: now, seconds: 0, source: 'timer' }))) };
  });
}
function manualSheet(kid, kind) {
  const read = kind === 'read', books = [...new Set(S.reading.filter(r => r.kid_id === kid.id).map(r => r.book))].slice(0, 6);
  openSheet(`<span class="label">Parent · ${esc(kid.name)}</span><h2>${read ? 'Add reading time' : 'Add screen time used'}</h2>
    <p class="hint">${read ? 'For reading that happened without the timer.' : 'For screen time that happened without the clock, like a family movie. It counts toward this week\u2019s time.'}</p>
    ${read ? `<div class="field"><label class="label" for="mBook">Book</label><input id="mBook" maxlength="100" placeholder="Book title" value="${esc(books[0] || '')}">${books.length ? `<div class="chips">${books.map(b => `<button class="chip" type="button" data-book="${esc(b)}">${esc(b)}</button>`).join('')}</div>` : ''}</div>`
      : `<div class="field"><label class="label" for="mNote">What was it?</label><input id="mNote" maxlength="120" placeholder="What it was"></div>`}
    <div class="row2"><div class="field"><label class="label" for="mMin">Minutes</label><input id="mMin" type="number" inputmode="numeric" min="0" max="600" placeholder="0"></div>
    <div class="field"><label class="label" for="mSec">Seconds</label><input id="mSec" type="number" inputmode="numeric" min="0" max="59" placeholder="0"></div></div>
    <div class="field"><label class="label" for="mDate">Day</label><input id="mDate" type="date" value="${today()}" min="${thisWeek()}" max="${today()}"></div>
    <button class="save" id="mGo" type="button" ${read ? 'style="background:var(--read)"' : ''}>Add ${read ? 'reading' : 'screen time'}</button><button class="cancel" data-close type="button">Cancel</button>`, () => {
    layer.querySelectorAll('[data-book]').forEach(b => b.onclick = () => { $('mBook').value = b.dataset.book });
    $('mGo').onclick = async () => {
      const sec = Math.max(0, parseInt($('mMin').value) || 0) * 60 + Math.min(59, Math.max(0, parseInt($('mSec').value) || 0)), d = $('mDate').value || today();
      if (!sec) return toast('Enter the minutes and seconds.'); if (sec > 600 * 60) return toast('That\u2019s more than 10 hours. Check the minutes.');
      const label = read ? $('mBook').value.trim() : $('mNote').value.trim(); if (!label) return toast(read ? 'Type the book\u2019s title.' : 'Say what it was.');
      closeSheet(); const now = new Date().toISOString();
      const row = { family_id: S.family.id, kid_id: kid.id, local_date: d, week_start: monday(d), started_at: now, ended_at: now, seconds: sec, source: 'manual' };
      await act(() => q(sb.from(read ? 'reading_sessions' : 'screen_sessions').insert(read ? { ...row, book: label } : { ...row, note: label })), `Added ${dur(sec)}`);
    };
  });
}
/* In a kid's view, manual entry needs the parent PIN each time, and doesn't leave parent mode unlocked. */
function manualGate(kid, kind) { if (S.view === 'parent') return manualSheet(kid, kind); pinSheet(() => { S.parentOk = false; try { sessionStorage.removeItem('cj-parent') } catch (e) { } manualSheet(kid, kind) }) }
function logJobSheet(kid) {
  const on = S.jobs.filter(j => j.kid_id === kid.id && j.enabled).sort((a, b) => a.title.localeCompare(b.title)), ws = creditWeek();
  openSheet(`<span class="label">Log a job for ${esc(kid.name)}</span><h2>What did ${esc(kid.name)} do?</h2>
    <div class="field"><label class="label" for="jobSearch">Search</label><input id="jobSearch" placeholder="Dishes, trash, laundry…" autocomplete="off"></div>
    <div class="list" style="box-shadow:none;border:1px solid var(--line)" id="jobList">${on.map(j => `<button class="row" type="button" data-pickjob="${j.id}" data-q="${esc((j.title + ' ' + j.category).toLowerCase())}"><span class="t"><b>${esc(j.title)}</b><span>${esc(j.category)}</span></span><span class="price num">${money(Number(j.price))}</span></button>`).join('') || '<div class="empty">No jobs on this board.</div>'}</div>
    <button class="cancel" data-close type="button">Close</button>`, () => {
    $('jobSearch').oninput = e => { const v = e.target.value.toLowerCase(); layer.querySelectorAll('[data-pickjob]').forEach(b => b.hidden = !b.dataset.q.includes(v)) };
    layer.querySelectorAll('[data-pickjob]').forEach(b => b.onclick = async () => { const j = S.jobs.find(x => x.id === b.dataset.pickjob); closeSheet();
      await act(() => q(sb.from('credits').insert({ family_id: S.family.id, kid_id: kid.id, week_start: ws, kind: 'job', title: j.title, amount: Number(j.price), minutes: Number(j.bonus_minutes) || 0, job_id: j.id, status: 'approved' })), `+${money(Number(j.price))} for ${kid.name}`) });
  });
}
function bonusSheet(kid) {
  const ws = creditWeek(); let mode = 'money';
  const draw = () => openSheet(`<span class="label">Bonus for ${esc(kid.name)}</span><h2>Something good happened</h2>
    <div class="seg" style="grid-template-columns:1fr 1fr"><button type="button" data-bm="money" aria-pressed="${mode === 'money'}">Money</button><button type="button" data-bm="minutes" aria-pressed="${mode === 'minutes'}">Screen minutes</button></div>
    <div class="chips">${(mode === 'money' ? [0.5, 1, 2, 5] : [5, 10, 15, 30]).map(a => `<button class="chip" type="button" data-amt="${a}">${mode === 'money' ? '$' + (a < 1 ? a.toFixed(2) : a) : a + ' min'}</button>`).join('')}</div>
    <div class="field"><label class="label" for="bAmt">${mode === 'money' ? 'Amount ($)' : 'Minutes'}</label><input id="bAmt" type="number" inputmode="decimal" min="${mode === 'money' ? '0.25' : '1'}" step="${mode === 'money' ? '0.25' : '1'}" value="${mode === 'money' ? 1 : 10}"></div>
    <div class="field"><label class="label" for="bWhy">Explanation ${esc(kid.name)} will see</label><input id="bWhy" maxlength="120" placeholder="What they did"></div>
    <button class="save" id="bGo" type="button" style="background:var(--money)">Add ${mode === 'money' ? 'money' : 'minutes'}</button><button class="cancel" data-close type="button">Cancel</button>`, () => {
    layer.querySelectorAll('[data-bm]').forEach(b => b.onclick = () => { draw.why = $('bWhy').value; mode = b.dataset.bm; draw(); $('bWhy').value = draw.why || '' });
    layer.querySelectorAll('[data-amt]').forEach(b => b.onclick = () => { $('bAmt').value = b.dataset.amt });
    $('bGo').onclick = async () => {
      const v = parseFloat($('bAmt').value) || 0, why = $('bWhy').value.trim(); if (v <= 0) return toast('Enter an amount.'); if (!why) return toast('Add an explanation so they know why.'); closeSheet();
      if (mode === 'money') { const a = r2(v); await act(() => q(sb.from('credits').insert({ family_id: S.family.id, kid_id: kid.id, week_start: ws, kind: 'bonus', title: why, amount: a, status: 'approved' })), `+${money(a)} for ${kid.name}`) }
      else { const m = Math.min(600, Math.round(v)); await act(() => q(sb.from('screen_bonus').insert({ family_id: S.family.id, kid_id: kid.id, week_start: ws, minutes: m, note: why })), `+${m} screen minutes for ${kid.name}`) }
    };
  });
  draw();
}
function kidMoreSheet(kid) {
  const cur = thisWeek(), cr = weekCredits(kid, cur), x = screenWeek(kid), paid = false;
  const reads = S.reading.filter(r => r.kid_id === kid.id && r.week_start === cur);
  openSheet(`<div style="display:flex;gap:12px;align-items:center">${avatar(kid)}<h2>${esc(kid.name)}</h2></div>
    <div class="sect"><div class="sect-h"><h3>This week's money</h3></div><div class="list" style="box-shadow:none;border:1px solid var(--line)">
      <div class="row"><span class="ico m">${I.coin}</span><span class="t"><b>Weekly allowance</b><span>Monday</span></span><span class="amt up">+${money(Number(weekRow(kid, cur)?.allowance ?? kid.weekly_allowance))}</span></div>
      ${cr.map(c => `<button class="row" type="button" data-undo="${c.id}" ${paid ? 'disabled' : ''}><span class="ico ${c.kind === 'job' ? 'j' : 'm'}">${c.kind === 'job' ? I.check : I.star}</span><span class="t"><b>${esc(c.title)}</b><span>${paid ? 'Paid' : 'Tap to undo a mistake'}</span></span><span class="amt up">+${money(Number(c.amount))}</span></button>`).join('')}</div></div>
    ${eqHTML(kid, x, `<div class="ptools"><button class="pill soft" id="addScr" type="button">+ Add screen time used</button><button class="pill soft" id="addMin" type="button">+ Bonus minutes</button>${x.sess.length ? '<button class="pill soft" id="undoSess" type="button">Undo last session</button>' : ''}</div>`)}
    <div class="sect"><div class="sect-h"><h3>Reading this week</h3><button class="link" id="addRead" type="button">+ Add reading</button></div><div class="list" style="box-shadow:none;border:1px solid var(--line)">${reads.length ? reads.map(r => readRow(r, kid, true)).join('') : '<div class="empty">No reading yet this week.</div>'}</div></div>
    <button class="pill soft" id="editThisKid" type="button" style="justify-self:start">Edit ${esc(kid.name)}'s settings</button>
    <button class="cancel" data-close type="button">Close</button>`, () => {
    layer.querySelectorAll('[data-undo]').forEach(b => b.onclick = () => { const c = S.credits.find(x => x.id === b.dataset.undo); confirmSheet('Undo this entry?', `${c.title} · ${money(Number(c.amount))}. Use this only to fix a mistake.`, 'Undo entry', () => q(sb.from('credits').delete().eq('id', c.id)), 'Entry removed') });
    layer.querySelectorAll('[data-delread]').forEach(b => b.onclick = () => confirmSheet('Remove this reading session?', 'Its minutes come off this week’s bonus.', 'Remove', () => q(sb.from('reading_sessions').delete().eq('id', b.dataset.delread)), 'Removed'));
    const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn };
    on('addMin', () => bonusSheet(kid)); on('addScr', () => manualSheet(kid, 'screen')); on('addRead', () => manualSheet(kid, 'read'));
    on('undoSess', () => { const l = x.sess[x.sess.length - 1]; confirmSheet('Undo the last session?', `${dur(liveSec(l))} goes back to this week.`, 'Undo', () => q(sb.from('screen_sessions').delete().eq('id', l.id)), 'Minutes returned') });
    on('editThisKid', () => kidSheet(kid));
  });
}

function kidSheet(kid) {
  const K = kid ? { ...kid, screen_days: [...(kid.screen_days || [6, 0])] } : { name: '', weekly_allowance: 5, color: Object.keys(COLORS)[S.kids.length % 6], base_screen_minutes: 100, reading_cap: 60, max_read_session: 60, screen_days: [6, 0] };
  const draw = () => openSheet(`<h2>${kid ? `Edit ${esc(kid.name)}` : 'Add a kid'}</h2>
    <div class="field"><label class="label" for="kN">First name</label><input id="kN" maxlength="40" value="${esc(K.name)}"></div>
    <div class="field"><span class="label">Color</span>${swatchesHTML(K.color, 'data-ksw')}</div>
    <div class="row2"><div class="field"><label class="label" for="kA">Weekly allowance ($)</label><input id="kA" type="number" min="0" step="0.5" value="${K.weekly_allowance}"></div>
    <div class="field"><label class="label" for="kS">Screen min / week</label><input id="kS" type="number" min="0" step="5" value="${K.base_screen_minutes}"></div></div>
    <div class="row2"><div class="field"><label class="label" for="kR">Reading bonus limit</label><input id="kR" type="number" min="0" step="5" value="${K.reading_cap}"></div>
    <div class="field"><label class="label" for="kM">Longest reading session</label><input id="kM" type="number" min="5" step="5" value="${K.max_read_session}"></div></div>
    <div class="field"><span class="label">Screen days</span><div class="chips">${[1, 2, 3, 4, 5, 6, 0].map(d => `<button class="chip" type="button" data-kd="${d}" aria-pressed="${K.screen_days.includes(d)}">${DOW[d]}</button>`).join('')}</div></div>
    ${kid ? '<p class="hint">A new allowance amount starts next Monday. This week stays the same.</p>' : '<p class="hint">Starts with the standard job board. You can edit it after.</p>'}
    <button class="save" id="kGo" type="button">${kid ? 'Save' : 'Add kid'}</button>
    ${kid ? `<button class="cancel danger-link" id="kDel" type="button">Remove ${esc(kid.name)} and their history</button>` : ''}<button class="cancel" data-close type="button">Cancel</button>`, () => {
    const keep = () => { K.name = $('kN').value; K.weekly_allowance = $('kA').value; K.base_screen_minutes = $('kS').value; K.reading_cap = $('kR').value; K.max_read_session = $('kM').value };
    bindSwatches(layer, 'data-ksw', c => { K.color = c });
    $('kN').onblur = e => { e.target.value = capFirst(e.target.value) };
    layer.querySelectorAll('[data-kd]').forEach(b => b.onclick = () => { keep(); const d = Number(b.dataset.kd); K.screen_days = K.screen_days.includes(d) ? K.screen_days.filter(x => x !== d) : [...K.screen_days, d]; draw() });
    $('kGo').onclick = async () => { keep(); const name = capFirst(K.name); if (!name) { toast('Type a first name.'); return $('kN').focus() } closeSheet();
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
    <div class="field"><label class="label" for="jM">Bonus screen minutes (optional)</label><input id="jM" type="number" inputmode="numeric" min="0" max="240" step="5" value="${Number(J.bonus_minutes) || 0}"></div>
    <button class="save" id="jGo" type="button">${job ? 'Save' : 'Add to board'}</button>${job ? '<button class="cancel danger-link" id="jDel" type="button">Delete job</button>' : ''}<button class="cancel" data-close type="button">Cancel</button>`, () => {
    $('jGo').onclick = async () => { const title = $('jT').value.trim(); if (!title) return toast('Name the job.'); const price = Math.max(0, r2(parseFloat($('jP').value) || 0)); closeSheet();
      const body = { title, done_means: $('jD').value.trim(), price, category: $('jC').value, bonus_minutes: Math.min(240, Math.max(0, parseInt($('jM').value) || 0)) };
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
      await q(sb.from('jobs').insert(S.jobs.filter(j => j.kid_id === src.id).map(j => ({ family_id: S.family.id, kid_id: k.id, title: j.title, done_means: j.done_means, category: j.category, price: j.price, bonus_minutes: j.bonus_minutes || 0, enabled: j.enabled, sort: j.sort }))));
    }, 'Board copied') });
  });
}
const FB = { bug: ['Report a bug', 'What happened, and what did you expect? Which screen were you on?'], idea: ['Request a feature', 'What would make this more useful for your family?'], hi: ['Say hi', 'Questions, thanks, anything.'] };
function feedbackSheet(kind) {
  let K = FB[kind] ? kind : 'hi';
  const draw = () => openSheet(`<h2>${FB[K][0]}</h2>
    <div class="seg">${Object.entries(FB).map(([k, v]) => `<button type="button" data-fk="${k}" aria-pressed="${k === K}">${({ bug: 'Bug', idea: 'Feature idea', hi: 'Say hi' })[k]}</button>`).join('')}</div>
    <div class="field"><label class="label" for="fbMsg">Message</label><textarea id="fbMsg" class="textarea" maxlength="2000" placeholder="${esc(FB[K][1])}">${esc(draw.msg || '')}</textarea></div>
    <div class="field"><label class="label" for="fbEmail">Your email (so I can reply, optional)</label><input id="fbEmail" type="email" value="${esc(draw.email ?? (S.user?.email || ''))}" placeholder="you@example.com"></div>
    <button class="save" id="fbGo" type="button">Send</button><button class="cancel" data-close type="button">Cancel</button>`, () => {
    const keep = () => { draw.msg = $('fbMsg').value; draw.email = $('fbEmail').value };
    layer.querySelectorAll('[data-fk]').forEach(b => b.onclick = () => { keep(); K = b.dataset.fk; draw() });
    $('fbGo').onclick = async () => {
      keep(); const msg = draw.msg.trim(); if (msg.length < 3) { toast('Write a short message first.'); return $('fbMsg').focus() }
      const b = $('fbGo'); b.disabled = true; b.textContent = 'Sending\u2026';
      const body = new URLSearchParams({ 'form-name': 'feedback', 'bot-field': '', type: FB[K][0], message: msg, email: draw.email.trim(), page: S.view + (S.view === 'parent' ? '/' + S.ptab : S.view === 'kid' ? '/' + S.tab : ''), app: navigator.userAgent.slice(0, 200) });
      try { const r = await fetch('/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() }); if (!r.ok) throw new Error(r.status); draw.msg = ''; closeSheet(); toast('Sent. Thank you!') }
      catch (e) { b.disabled = false; b.textContent = 'Send'; toast(CFG.contactEmail ? `Couldn\u2019t send. Email ${CFG.contactEmail} instead.` : 'Couldn\u2019t send. Try again in a minute.') }
    };
  });
  draw.msg = ''; draw.email = undefined; draw();
}
const PRIVACY = [
  ['The short version', `${APP} is a free tool for families. It keeps as little as possible, never sells or shares it, and has no ads, trackers or analytics.`],
  ['What we store', 'The parent\u2019s email address, used only to send sign-in codes. A family name, time zone and a scrambled (hashed) parent PIN. For each kid: a first name and color, allowance amount, job board, jobs and bonuses with their explanations, payments and purchases with their explanations, a saving goal if one is set, reading sessions (book titles and time) and screen-time sessions.'],
  ['What we don\u2019t collect', 'No last names, birthdays, photos, locations, school names, contact details or anything else about kids. Kids never make an account or enter an email. Everything sits under the parent\u2019s account.'],
  ['Who can see it', 'Only the parents signed in to your family. Data is stored with Supabase and protected by database rules that keep each family\u2019s records separate from every other family\u2019s.'],
  ['Feedback messages', 'If you send a bug report, idea or message, it\u2019s delivered to the person who runs this site, along with the email you typed (optional) and which screen you were on.'],
  ['Donations', 'The Venmo, Cash App and PayPal links open those services. This site never sees your payment details.'],
  ['Deleting your data', 'Parent \u2192 Settings \u2192 Delete account and all data permanently removes your family, every kid profile and all history right away.'],
  ['Questions', 'Use Contact on the sign-in screen, or Settings \u2192 Contact & feedback.']
];
function privacySheet() {
  openSheet(`<span class="label">${esc(APP)}</span><h2>Privacy</h2>${PRIVACY.map(([h, t]) => `<div class="field"><b style="font:700 18px var(--display)">${h}</b><p class="hint" style="color:var(--ink);font-size:15px;line-height:1.55">${t}</p></div>`).join('')}<p class="hint">Last updated October 2026.</p><button class="save" data-close type="button">Done</button>`);
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
    if (!fid) { S.onboard = { step: 0, name: '', tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Denver', pin: '', kids: [], draft: { name: '', allowance: '5', color: 'green' } }; S.view = 'onboard'; return render() }
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
