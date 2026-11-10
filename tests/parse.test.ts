import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAmount, parseBcaEmail } from "../supabase/functions/_shared/parse.ts";

const sample = `Yth. Pemegang Kartu Kredit BCA,
Terima kasih telah bertransaksi menggunakan Kartu Kredit BCA:
Nomor Customer : 0000000000000000
Nomor Kartu : 472647XXXX0000
Merchant / ATM : Alipay*HelloBike
Jenis Transaksi : E-COMMERCE
Otentikasi : TRANSAKSI TANPA OTP
Pada Tanggal : 09-11-2026 07:00:33 WIB
Sejumlah : CNY 1,6
Selalu jaga keamanan fisik kartu`;

test("parses the plain-text email", () => {
  assert.deepEqual(parseBcaEmail(sample), {
    merchant: "Alipay*HelloBike",
    type: "E-COMMERCE",
    currency: "CNY",
    amount: 1.6,
    occurredAt: "2026-11-09T00:00:33.000Z", // 08:00:33 China time
  });
});

test("parses an HTML version of the email", () => {
  const html = `<table><tr><td>Merchant / ATM</td><td>: ALP*QRCode9255</td></tr>
<tr><td>Jenis Transaksi</td><td>: E-COMMERCE</td></tr>
<tr><td>Pada Tanggal</td><td>: 09-11-2026 14:47:27 WIB</td></tr>
<tr><td>Sejumlah</td><td>: CNY&nbsp;3,5</td></tr></table>`;
  const r = parseBcaEmail(html);
  assert.equal(r?.merchant, "ALP*QRCode9255");
  assert.equal(r?.amount, 3.5);
  assert.equal(r?.occurredAt, "2026-11-09T07:47:27.000Z");
});

test("parses BCA's real HTML layout (label, colon, value in separate cells)", () => {
  const td = `<td style="padding:0;Margin:0;font-size:18px;line-height:36px;color:#333333">`;
  const row = (label: string, value: string) =>
    `<tr style="border-collapse:collapse">\r\n  ${td}${label}</td>\r\n  ${td}:&nbsp;</td>\r\n  ${td}<span>${value}</td>\r\n </tr>\r\n`;
  const html = `<html><body><table>` +
    row("Merchant / ATM", "Alipay*QRCode2855") +
    row("Jenis Transaksi", "E-COMMERCE") +
    row("Pada Tanggal", "10-11-2026 08:15:00 WIB") +
    row("Sejumlah", "CNY 12,5") +
    `</table></body></html>`;
  const r = parseBcaEmail(html);
  assert.equal(r?.merchant, "Alipay*QRCode2855");
  assert.equal(r?.type, "E-COMMERCE");
  assert.equal(r?.amount, 12.5);
  assert.equal(r?.occurredAt, "2026-11-10T01:15:00.000Z");
});

test("plain-text part that is just '-' returns null", () => {
  assert.equal(parseBcaEmail("-"), null);
});

test("amount formats", () => {
  assert.equal(parseAmount("3"), 3);
  assert.equal(parseAmount("0,8"), 0.8);
  assert.equal(parseAmount("1.234,56"), 1234.56);
  assert.equal(parseAmount("150.000"), 150000);
});

test("non-transaction email returns null", () => {
  assert.equal(parseBcaEmail("Tagihan Anda bulan ini sudah tersedia."), null);
});
