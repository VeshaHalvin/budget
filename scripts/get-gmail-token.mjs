// One-time helper: sign in to Google and save a Gmail refresh token
// (read-only access) into supabase/secrets.env for the poll-gmail function.
//
// Usage:  node scripts/get-gmail-token.mjs
// Reads GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET from supabase/secrets.env.

import http from "node:http";
import fs from "node:fs";
import { exec } from "node:child_process";

const ENV_FILE = new URL("../supabase/secrets.env", import.meta.url);
let envText = fs.readFileSync(ENV_FILE, "utf8");
const get = (k) => envText.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim();

const clientId = get("GOOGLE_CLIENT_ID");
const clientSecret = get("GOOGLE_CLIENT_SECRET");
if (!clientId || !clientSecret) {
  console.error("Fill in GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in supabase/secrets.env first.");
  process.exit(1);
}

const PORT = 8765;
const redirectUri = `http://127.0.0.1:${PORT}`;
const authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: "code",
  scope: "https://www.googleapis.com/auth/gmail.readonly",
  access_type: "offline",
  prompt: "consent",
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, redirectUri);
  const code = url.searchParams.get("code");
  if (!code) {
    res.end(url.searchParams.get("error") ? `Sign-in failed: ${url.searchParams.get("error")}` : "Waiting…");
    if (url.searchParams.get("error")) { console.error("Sign-in error:", url.searchParams.get("error")); server.close(); }
    return;
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirectUri, grant_type: "authorization_code",
    }),
  });
  const json = await tokenRes.json();
  if (!json.refresh_token) {
    res.end("Failed — check the terminal.");
    console.error("No refresh token returned:", json.error, json.error_description);
  } else {
    envText = /^GOOGLE_REFRESH_TOKEN=.*$/m.test(envText)
      ? envText.replace(/^GOOGLE_REFRESH_TOKEN=.*$/m, `GOOGLE_REFRESH_TOKEN=${json.refresh_token}`)
      : envText + `\nGOOGLE_REFRESH_TOKEN=${json.refresh_token}\n`;
    fs.writeFileSync(ENV_FILE, envText);
    res.end("Done! Refresh token saved. You can close this tab.");
    console.log("SUCCESS: refresh token saved to supabase/secrets.env");
  }
  server.close();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("Opening Google sign-in in your browser...");
  const opener = process.platform === "win32" ? `start "" "${authUrl}"`
    : process.platform === "darwin" ? `open "${authUrl}"` : `xdg-open "${authUrl}"`;
  exec(opener);
});
