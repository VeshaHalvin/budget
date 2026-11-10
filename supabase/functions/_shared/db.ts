import { createClient } from "jsr:@supabase/supabase-js@2";

export const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

export interface Balance {
  today: string;
  start_date: string;
  daily_budget: number;
  carry_in: number;
  spent_today: number;
  left_today: number;
}

export async function getBalance(): Promise<Balance> {
  const { data, error } = await db.rpc("get_balance");
  if (error) throw error;
  return data as Balance;
}

export const fmt = (n: number) =>
  Number(n).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
