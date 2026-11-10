// Reads a BCA credit card notification email and pulls out the transaction.
// Works on plain text or HTML bodies (HTML tags are stripped first).

export interface ParsedTransaction {
  merchant: string;
  type: string;
  currency: string;
  amount: number;
  occurredAt: string; // ISO 8601 in UTC
}

// Indonesian time zones used in BCA emails.
const TZ_OFFSETS: Record<string, string> = {
  WIB: "+07:00",
  WITA: "+08:00",
  WIT: "+09:00",
};

export function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/tr|\/li)[^>]*>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"');
}

// "1,6" -> 1.6, "1.234,56" -> 1234.56, "3" -> 3
export function parseAmount(raw: string): number {
  const cleaned = raw.trim().replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) throw new Error(`Bad amount: ${raw}`);
  return n;
}

function field(text: string, label: string): string | null {
  const re = new RegExp(`${label}\\s*:\\s*([^\\n\\r]+)`, "i");
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

export function parseBcaEmail(body: string): ParsedTransaction | null {
  const text = /<[a-z][\s\S]*>/i.test(body) ? htmlToText(body) : body;

  const merchant = field(text, "Merchant\\s*/\\s*ATM");
  const type = field(text, "Jenis Transaksi") ?? "";
  const dateRaw = field(text, "Pada Tanggal");
  const amountRaw = field(text, "Sejumlah");
  if (!merchant || !dateRaw || !amountRaw) return null;

  const am = amountRaw.match(/^([A-Z]{3})\s*([\d.,]+)/);
  if (!am) return null;

  // "09-11-2026 07:00:33 WIB"
  const dm = dateRaw.match(
    /(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s*(WIB|WITA|WIT)?/,
  );
  if (!dm) return null;
  const [, dd, mm, yyyy, h, mi, s, tz] = dm;
  const offset = TZ_OFFSETS[tz ?? "WIB"];
  const occurredAt = new Date(`${yyyy}-${mm}-${dd}T${h}:${mi}:${s}${offset}`);
  if (isNaN(occurredAt.getTime())) return null;

  return {
    merchant,
    type,
    currency: am[1],
    amount: parseAmount(am[2]),
    occurredAt: occurredAt.toISOString(),
  };
}
