# PiggyBoo

A free web app for families: a weekly allowance, a job board with prices, a reading log that earns screen minutes, and a weekend screen clock that can't be paused.

- **Parents** sign in with just an email (a 6-digit code or magic link, no password), add their kids, and set up each kid's job board, allowance and screen-time rules.
- **Kids** sign in on the same email, pick their profile, and see their week: the allowance, every job and bonus with the reason, what's in their bank, and what's been withdrawn or spent.
- **A bank for each kid.** Every Monday the kid earns their allowance, plus any jobs and bonuses. It all builds up as a balance in their bank. Money only comes out when you record a withdrawal (cash or a transfer) or a purchase you made for them with their money. Every entry needs an explanation, and nothing is ever taken away as a punishment.

The site is plain HTML, CSS and JavaScript with no build step. It's hosted on Netlify, and Supabase handles sign-in and the database.

---

## Setup (about 15 minutes)

### 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com), sign up and create a **new project**. The free plan works.
2. Open **SQL Editor → New query**, paste everything in [`supabase/schema.sql`](supabase/schema.sql) and click **Run**.
3. Go to **Project Settings → API** and copy the **Project URL** and the **anon public** key.
4. Paste both into [`config.js`](config.js). The anon key is meant to be public, because the database rules in `schema.sql` keep each family's data private.

### 2. Turn on sign-in codes

1. **Authentication → Providers → Email**: make sure Email is enabled. Leave "Confirm email" on.
2. **Authentication → Email Templates → Magic Link**: replace the body with this, so parents get a code they can type on any device (handy for a kid's iPad):

   ```html
   <h2>Your PiggyBoo sign-in code</h2>
   <p style="font-size:28px;font-weight:700;letter-spacing:6px">{{ .Token }}</p>
   <p>Or tap to sign in on this device: <a href="{{ .ConfirmationURL }}">Sign in</a></p>
   <p>If you didn't ask for this, you can ignore it.</p>
   ```

   Make the same change to the **Confirm signup** template, which a parent receives the very first time.
3. **Authentication → URL Configuration**: set **Site URL** to your Netlify address (for example `https://piggy.boo`) and add it under **Redirect URLs**.

### 3. Set up real email before you share it (important)

Supabase's built-in email is for testing only: it sends just a few emails per hour, and only to people on your Supabase team. Before sharing the link, send sign-in emails through Resend (free tier: 3,000 emails a month).

1. Make a free [Resend](https://resend.com) account, add a domain you own, and add the DNS records Resend shows you. Wait until the domain shows **Verified**.
2. In Resend, create an **API key** (Sending access is enough).
3. In Supabase: **Project Settings → Authentication → SMTP Settings → Enable custom SMTP**
   - Host `smtp.resend.com`, port `465`
   - Username `resend`
   - Password: the Resend API key
   - Sender email: an address on your verified domain, like `hello@yourdomain.com`. Sender name: `PiggyBoo`
4. Under **Authentication → Rate Limits**, set emails to around 30 per hour.

(Alternative with no new account: use a Gmail or Google Workspace address with an app password. Host `smtp.gmail.com`, port `465`.)

### 4. Deploy on Netlify

Feedback (Settings → Contact & feedback) uses **Netlify Forms**, so there's nothing to set up beyond deploying. After the first deploy, turn on email alerts in Netlify: **Site → Forms → Form notifications → Add notification → Email** and enter your address. Messages also show under **Forms → feedback**.


1. Push this repo to GitHub.
2. In Netlify: **Add new site → Import an existing project → GitHub →** pick this repo.
3. Leave the build command empty. The publish directory is `.` (already set in `netlify.toml`). Click **Deploy**.
4. Optional: **Domain settings** to add your own domain. Update the Supabase Site URL if you do.

That's it. Visit the site, sign in with your email, and set up your family.

---

## How it works

| Thing | Rule |
|---|---|
| Week | Monday to Sunday in the family's time zone (set in Settings). |
| Allowance | Each Monday a kid's week starts at their weekly allowance. A change applies from the next Monday. |
| Jobs | The kid taps a job and **I did it**. It waits under **Needs your OK** (with a badge) until a parent taps **OK** or **Not yet**. Parents can also log a job directly. A job can also carry bonus screen minutes. |
| Bonuses | **Add bonus**: money or screen minutes, always with an explanation the kid can see. |
| Saving goal | The kid picks something to save for and sees a progress bar against their balance. When there's enough, **Bought something** fills in the goal. |
| Bank balance | Each kid's card shows what's banked and the last withdrawal. After two weeks with no withdrawal, a reminder with **Withdraw** appears (not while the kid is saving toward a goal). |
| Withdrawals | **Ledger → Money → Withdraw cash**: type the amount you handed over and an explanation. It comes out of the kid's bank. |
| Purchases | **Bank → Bought something**: what you bought for them with their money, with an explanation. You can't go below their balance. |
| Ledger | **Ledger** tab, per kid: Money (every allowance, job, bonus, payment and purchase, with running balance), Screen time and Reading (every session, manual entry and bonus minutes, week by week). Tap any entry to edit its amount, explanation, time or day, or delete it. Adding time lets you pick the day of the week. |
| Taking money away | There's no deduction feature. Parents can correct or delete an entry that was a mistake. |
| Totals per kid | Bank balance, this week, this month, lifetime earned, withdrawn, and spent. Each entry shows the running balance, like a bank statement. |
| Reading | The kid starts a timer and types the book, and can pause and resume it. Time is kept to the second, so 10:40 + 10:20 = 21 minutes, and each full minute adds a screen minute that week, up to the kid's limit. A forgotten timer stops itself. Parents can add reading by hand. |
| Screen time | Base minutes plus reading minutes, used on the kid's screen days. The clock counts down the week's time to the second and can be paused. It stops itself at zero. Parents can add screen time used by hand (it counts this week). Time is never taken away as a punishment. Base minutes, screen days and reading limit are in **Settings → Screen time**. |
| Parent PIN | Kids share the parent's sign-in, so parent tools sit behind a 4-digit PIN. After signing in fresh with the email code, a parent can reset a forgotten PIN. |
| Second parent | Settings → **Invite another parent**. They sign in with that email and join automatically. |
| Delete | Settings → **Delete account and all data** removes the family and the login. |
| Feedback | Settings → **Report a bug / Request a feature / Say hi**, or **Contact** on the sign-in screen. Sent through Netlify Forms. |

## Files

```
index.html            page shell
styles.css            all styles (light + dark)
app.js                the app
jobs.js               default job board (58 jobs, 15 on by default)
config.js             your Supabase URL/key, app name, Venmo + Cash App handles
privacy.html          privacy page
supabase/schema.sql   database tables, security rules and functions
netlify.toml          Netlify settings and security headers
```

To rename the app, change `appName` in `config.js` and the `<title>`/manifest text. To change the donation handles, edit `venmo`, `cashapp` and `paypal` in `config.js`.

## Support

PiggyBoo is free. If it helps your family: **Venmo [@mike-shai](https://venmo.com/u/mike-shai)** · **Cash App [$mikeshai](https://cash.app/$mikeshai)** · **PayPal [mikeshai](https://www.paypal.com/paypalme/mikeshai)**
