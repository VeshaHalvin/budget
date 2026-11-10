// Runs every 2 minutes (via pg_cron). Looks for new BCA emails in Gmail,
// saves each transaction, and sends a Bark notification with the new balance.

import { db, fmt, getBalance } from "../_shared/db.ts";
import { parseBcaEmail } from "../_shared/parse.ts";

const env = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Missing secret ${k}`);
  return v;
};

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const QUERY = "from:kartukreditbca@bca.co.id newer_than:3d";

async function getAccessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("GOOGLE_CLIENT_ID"),
      client_secret: env("GOOGLE_CLIENT_SECRET"),
      refresh_token: env("GOOGLE_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Google token error: ${JSON.stringify(json)}`);
  return json.access_token;
}

function decodeBase64Url(data: string): string {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

// BCA's text/plain part is just "-", so return every body (plain first, then HTML)
// and let the parser try each one.
// deno-lint-ignore no-explicit-any
function extractBodies(payload: any): string[] {
  const plain: string[] = [];
  const html: string[] = [];
  // deno-lint-ignore no-explicit-any
  const walk = (p: any) => {
    if (p.body?.data) {
      if (p.mimeType === "text/plain") plain.push(decodeBase64Url(p.body.data));
      else if (p.mimeType === "text/html") html.push(decodeBase64Url(p.body.data));
    }
    (p.parts ?? []).forEach(walk);
  };
  walk(payload);
  return [...plain, ...html];
}

async function sendBark(title: string, body: string) {
  const key = Deno.env.get("BARK_KEY");
  if (!key) return;
  const server = Deno.env.get("BARK_SERVER") ?? "https://api.day.app";
  const res = await fetch(`${server}/${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      title,
      body,
      group: "budget",
      url: Deno.env.get("APP_PAGE_URL") ?? undefined,
    }),
  });
  if (!res.ok) console.error("Bark failed", res.status, await res.text());
}

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== env("CRON_SECRET")) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const token = await getAccessToken();
    const auth = { Authorization: `Bearer ${token}` };

    const listRes = await fetch(
      `${GMAIL}/messages?maxResults=50&q=${encodeURIComponent(QUERY)}`,
      { headers: auth },
    );
    const list = await listRes.json();
    if (!listRes.ok) throw new Error(`Gmail list error: ${JSON.stringify(list)}`);
    const ids: string[] = (list.messages ?? []).map((m: { id: string }) => m.id);
    if (ids.length === 0) return Response.json({ new: 0 });

    const { data: seen, error: seenErr } = await db
      .from("seen_emails").select("gmail_id").in("gmail_id", ids);
    if (seenErr) throw seenErr;
    const seenSet = new Set((seen ?? []).map((r) => r.gmail_id));
    const fresh = ids.filter((id) => !seenSet.has(id)).reverse(); // oldest first
    if (fresh.length === 0) return Response.json({ new: 0 });

    // First run ever = nothing seen yet. Don't send a flood of notifications
    // for the last 3 days of emails.
    const { count: seenTotal, error: countErr } = await db
      .from("seen_emails").select("gmail_id", { count: "exact", head: true });
    if (countErr) throw countErr;
    const firstRun = seenTotal === 0;

    const added: { merchant: string; amount: number; currency: string; excluded: boolean }[] = [];

    for (const id of fresh) {
      const msgRes = await fetch(`${GMAIL}/messages/${id}?format=full`, { headers: auth });
      const msg = await msgRes.json();
      if (!msgRes.ok) throw new Error(`Gmail get error: ${JSON.stringify(msg)}`);

      const tx = extractBodies(msg.payload).map(parseBcaEmail).find((t) => t) ?? null;
      if (tx) {
        // Non-CNY spending (e.g. IDR back home) is saved but not counted.
        const excluded = tx.currency !== "CNY";
        const { error } = await db.from("transactions").upsert({
          gmail_id: id,
          occurred_at: tx.occurredAt,
          merchant: tx.merchant,
          amount: tx.amount,
          currency: tx.currency,
          source: "email",
          excluded,
          note: excluded ? `Not counted: paid in ${tx.currency}` : null,
        }, { onConflict: "gmail_id", ignoreDuplicates: true });
        if (error) throw error;
        added.push({ merchant: tx.merchant, amount: tx.amount, currency: tx.currency, excluded });
      }
      const { error } = await db.from("seen_emails").insert({ gmail_id: id, parsed: !!tx });
      if (error) throw error;
    }

    if (added.length > 0 && !firstRun) {
      const bal = await getBalance();
      for (const t of added) {
        const left = `Today left: ${fmt(bal.left_today)} RMB`;
        if (t.excluded) {
          await sendBark(`${t.currency} ${fmt(t.amount)} · ${t.merchant}`, `Not counted (not RMB). ${left}`);
        } else {
          await sendBark(
            `💸 -${fmt(t.amount)} RMB · ${t.merchant}`,
            `${left}\nSpent today: ${fmt(bal.spent_today)} · Carried in: ${fmt(bal.carry_in)}`,
          );
        }
      }
    }

    return Response.json({ new: added.length, firstRun });
  } catch (e) {
    console.error(e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
});
