// Backend for the home-screen web page.
// Every request must send the header  x-app-token: <APP_TOKEN>.
//
// POST { action: "summary" }                               -> balance + last 60 days
// POST { action: "flag", id, excluded }                    -> mark/unmark big purchase
// POST { action: "add", amount, merchant, occurred_at? }   -> manual entry (cash, refund = negative)
// POST { action: "delete", id }                            -> delete a manual entry
// POST { action: "settings", daily_budget?, start_date? }  -> change budget settings

import { db, getBalance } from "../_shared/db.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-app-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: cors });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return reply({ error: "POST only" }, 405);

  const appToken = Deno.env.get("APP_TOKEN");
  if (!appToken || req.headers.get("x-app-token") !== appToken) {
    return reply({ error: "Wrong app token" }, 401);
  }

  try {
    const body = await req.json();

    switch (body.action) {
      case "summary": {
        const since = new Date(Date.now() - 60 * 86400_000).toISOString();
        const [balance, txs] = await Promise.all([
          getBalance(),
          db.from("transactions")
            .select("id, occurred_at, merchant, amount, currency, source, excluded, note")
            .gte("occurred_at", since)
            .order("occurred_at", { ascending: false }),
        ]);
        if (txs.error) throw txs.error;
        return reply({ balance, transactions: txs.data });
      }

      case "flag": {
        const { error } = await db.from("transactions")
          .update({ excluded: !!body.excluded })
          .eq("id", body.id);
        if (error) throw error;
        return reply({ ok: true, balance: await getBalance() });
      }

      case "add": {
        const amount = Number(body.amount);
        if (!Number.isFinite(amount) || amount === 0) {
          return reply({ error: "Amount must be a number" }, 400);
        }
        const { error } = await db.from("transactions").insert({
          occurred_at: body.occurred_at ?? new Date().toISOString(),
          merchant: String(body.merchant || (amount < 0 ? "Refund" : "Cash")).slice(0, 100),
          amount,
          currency: "CNY",
          source: "manual",
        });
        if (error) throw error;
        return reply({ ok: true, balance: await getBalance() });
      }

      case "delete": {
        const { error } = await db.from("transactions")
          .delete().eq("id", body.id).eq("source", "manual");
        if (error) throw error;
        return reply({ ok: true, balance: await getBalance() });
      }

      case "settings": {
        const patch: Record<string, unknown> = {};
        if (body.daily_budget != null) patch.daily_budget = Number(body.daily_budget);
        if (body.start_date) patch.start_date = body.start_date;
        const { error } = await db.from("settings").update(patch).eq("id", 1);
        if (error) throw error;
        return reply({ ok: true, balance: await getBalance() });
      }

      default:
        return reply({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    console.error(e);
    return reply({ error: String(e) }, 500);
  }
});
