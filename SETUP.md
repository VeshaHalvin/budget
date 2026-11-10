# Daily Budget: setup guide

How it works:

```
BCA email → Gmail → (every 2 min) Supabase function reads it → saves it → Bark notification on iPhone
                                                     ↑
                         Home-screen web page (flag big purchases, add cash, see history)
```

Budget rule: `left today = 50 × (days since start, incl. today) − everything spent`.
Unspent money rolls forward. Overspending comes out of later days. Big purchases you flag aren't counted.

Takes about 30–40 minutes the first time. Everything is free.

---

## 1. Bark (iPhone notifications) — 2 min

1. Install **Bark** from the App Store and open it.
2. It shows a URL like `https://api.day.app/AbCdEf123456/...`
   The part after `api.day.app/` (here `AbCdEf123456`) is your **BARK_KEY**.

## 2. Supabase project — 3 min

1. Sign up at supabase.com → **New project**. Pick region **Singapore** (closest to China).
2. Note your **project ref**: the `xxxx` in `https://xxxx.supabase.co` (Project Settings → General).

## 3. Gmail access — 10 min

1. Go to console.cloud.google.com → create a project (any name).
2. **APIs & Services → Library** → search **Gmail API** → **Enable**.
3. **APIs & Services → OAuth consent screen** (may be called "Google Auth Platform"):
   - User type **External**, app name anything, your email as support/contact email.
   - Under **Audience / Test users**, add your Gmail address.
   - Then click **Publish app** (→ "In production").
     **Important:** if you leave it in "Testing", Google expires the login after 7 days and the tracker stops.
     You don't need Google to verify it. You'll just see an "unverified app" warning when you sign in. Click *Advanced → Go to (app name)*.
4. **Credentials → Create credentials → OAuth client ID** → type **Desktop app**.
   Copy the **Client ID** and **Client secret**.
5. In this folder, run:

```bash
node scripts/get-gmail-token.mjs YOUR_CLIENT_ID YOUR_CLIENT_SECRET
```

   Sign in, allow read access. The terminal prints your **GOOGLE_REFRESH_TOKEN**.

## 4. Deploy to Supabase — 5 min

Make two random passwords (run twice, one for CRON_SECRET, one for APP_TOKEN):

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Then, from this folder:

```bash
npx supabase login
```

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
```

```bash
npx supabase db push
```

```bash
npx supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... GOOGLE_REFRESH_TOKEN=... BARK_KEY=... CRON_SECRET=... APP_TOKEN=...
```

```bash
npx supabase functions deploy poll-gmail --no-verify-jwt
```

```bash
npx supabase functions deploy api --no-verify-jwt
```

## 5. Turn on the 2-minute check — 1 min

Copy `supabase/cron.example.sql` to `supabase/cron.sql`, replace `YOUR-PROJECT-REF` and `YOUR-CRON-SECRET`,
paste it into Supabase → **SQL Editor** → **Run**.

The first run saves the last 3 days of BCA emails **without** notifying you.
After that, every new purchase sends a notification.

## 6. The home-screen page — 5 min

1. Host the `web` folder anywhere static. Easiest: go to **app.netlify.com/drop** and drag the `web` folder in.
   You get a URL like `https://something.netlify.app`.
2. (Optional) Make notifications open the page when tapped:

```bash
npx supabase secrets set APP_PAGE_URL=https://something.netlify.app
```

3. On iPhone: open that URL in **Safari** → Share → **Add to Home Screen**.
4. Open it from the home screen → tap **⚙︎** → enter:
   - API URL: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/api`
   - App token: your APP_TOKEN
   - Budget started on: the day you want the 50/day to start counting from.

   Safari and the home-screen app keep separate storage, so if you also open the page from a notification in Safari, enter these there once too.

---

## Everyday use

- **Card purchase** → notification within ~2 minutes with today's balance.
- **Big purchase** → open the page, tap **Big?** on it. It's removed from the budget and the balance updates.
- **Cash / Alipay balance / WeChat balance** → tap **+** → Cash spend.
- **Refund** → tap **+** → Refund (adds the money back).
- **Non-RMB card spending** (e.g. IDR in Indonesia) is saved but not counted.

## Checking it's working

- Supabase → **Edge Functions → poll-gmail → Logs**: should show a run every 2 minutes.
- To test the page without the backend: open it with `?demo` on the end of the URL.

## Things to know

- **Free-plan pausing:** Supabase pauses free projects after ~7 days with no activity. The 2-minute check and opening the page should keep it active, but this hasn't been tested yet. If it does pause, you get an email and can restore it in one click. Missed emails within the last 3 days are picked up afterwards.
- **Delay:** BCA emails sometimes arrive a few minutes after the purchase, so notifications can lag a little.
- **Days are China time** (midnight Beijing). BCA's Indonesian timestamps are converted automatically.
