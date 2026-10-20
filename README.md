# Chore Jar

A free web app for families: a weekly allowance, a job board with prices, a reading log that earns screen minutes, and a weekend screen clock that can't be paused.

- **Parents** sign in with just an email (a 6-digit code or magic link, no password), add their kids, and set up each kid's job board, allowance and screen-time rules.
- **Kids** sign in on the same email, pick their profile, and see their week: the allowance, every job and bonus with the reason, what's waiting to be paid, and what's been paid.
- **Money only goes up.** Every Monday each kid's week starts at their allowance. Parents add jobs and bonuses during the week, then mark the week paid. Unpaid weeks pile up as **Owed**.

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
   <h2>Your Chore Jar sign-in code</h2>
   <p style="font-size:28px;font-weight:700;letter-spacing:6px">{{ .Token }}</p>
   <p>Or tap to sign in on this device: <a href="{{ .ConfirmationURL }}">Sign in</a></p>
   <p>If you didn't ask for this, you can ignore it.</p>
   ```

   Make the same change to the **Confirm signup** template, which a parent receives the very first time.
3. **Authentication → URL Configuration**: set **Site URL** to your Netlify address (for example `https://chorejar.netlify.app`) and add it under **Redirect URLs**.

### 3. Set up real email before you share it (important)

Supabase's built-in email only sends a few emails per hour, which is fine for testing but not for public use. Before sharing the link:

1. Make a free [Resend](https://resend.com) account and verify a domain you own.
2. In Supabase, go to **Project Settings → Authentication → SMTP Settings** and enter Resend's SMTP details (host `smtp.resend.com`, port `465`, user `resend`, password = your Resend API key, sender like `hello@yourdomain.com`).
3. Under **Authentication → Rate Limits**, set email sends to something like 30 per hour.

### 4. Deploy on Netlify

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
| Jobs | A parent taps **Log a job** and picks from that kid's board. The price is added to this week. |
| Bonuses | **Add money** with a reason the kid can see. |
| Removing money | Not possible. A parent can **undo** an entry made by mistake while its week is still unpaid. |
| Payday | **Payday → Mark paid** moves a week to Paid. Past unpaid weeks show as Owed. After this week is paid, new entries count toward next week. |
| Totals per kid | This week, this month, lifetime, owed and paid. |
| Reading | The kid starts a timer and types the book. Each minute adds a screen minute that week, up to the kid's limit. A forgotten timer stops itself. |
| Screen time | Base minutes plus reading minutes, used on the kid's screen days. Each session runs without pausing. Parents can log screen time used without the clock, and it comes off the next week. |
| Parent PIN | Kids share the parent's sign-in, so parent tools sit behind a 4-digit PIN. After signing in fresh with the email code, a parent can reset a forgotten PIN. |
| Second parent | Settings → **Invite another parent**. They sign in with that email and join automatically. |
| Delete | Settings → **Delete account and all data** removes the family and the login. |

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

To rename the app, change `appName` in `config.js` and the `<title>`/manifest text. To change the donation handles, edit `venmo` and `cashapp` in `config.js`.

## Support

Chore Jar is free. If it helps your family: **Venmo [@mike-shai](https://venmo.com/u/mike-shai)** · **Cash App [$mikeshai](https://cash.app/$mikeshai)**
