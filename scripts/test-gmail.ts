// Local check: reads your last 10 BCA emails from Gmail and shows what the parser finds.
// Usage: node scripts/test-gmail.ts
import fs from "node:fs";
import { parseBcaEmail } from "../supabase/functions/_shared/parse.ts";

const env = fs.readFileSync(new URL("../supabase/secrets.env", import.meta.url), "utf8");
const get = (k: string) => env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim() ?? "";

const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: get("GOOGLE_CLIENT_ID"),
    client_secret: get("GOOGLE_CLIENT_SECRET"),
    refresh_token: get("GOOGLE_REFRESH_TOKEN"),
    grant_type: "refresh_token",
  }),
});
const tok = await tokenRes.json();
if (!tok.access_token) { console.error("Token error:", tok.error, tok.error_description); process.exit(1); }
const auth = { Authorization: `Bearer ${tok.access_token}` };
const G = "https://gmail.googleapis.com/gmail/v1/users/me";

const list = await (await fetch(`${G}/messages?maxResults=10&q=${encodeURIComponent("from:kartukreditbca@bca.co.id")}`, { headers: auth })).json();
const ids: string[] = (list.messages ?? []).map((m: { id: string }) => m.id);
console.log(`Found ${ids.length} BCA emails (showing up to 10)`);

const dec = (d: string) => Buffer.from(d.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
for (const id of ids) {
  const msg = await (await fetch(`${G}/messages/${id}?format=full`, { headers: auth })).json();
  const plain: string[] = [], html: string[] = [];
  const walk = (p: any) => {
    if (p.body?.data) (p.mimeType === "text/plain" ? plain : p.mimeType === "text/html" ? html : []).push(dec(p.body.data));
    (p.parts ?? []).forEach(walk);
  };
  walk(msg.payload);
  const subject = msg.payload.headers.find((h: any) => h.name === "Subject")?.value;
  const tx = [...plain, ...html].map(parseBcaEmail).find((t) => t) ?? null;
  console.log(tx ? `OK   ${tx.occurredAt}  ${tx.currency} ${tx.amount}  ${tx.merchant}` : `SKIP (not a transaction): ${subject}`);
}
