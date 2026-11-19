// Reads bank SMS and Apple Pay notifications with fixed rules, on the phone.
// Ported from the old Planner (projects/anas-planner/src/shared/bankMessages.ts).
// One-time codes are recognised and never stored.

const OTP = [
  /\b(otp|one[\s-]?time\s*(pass(word|code)?|pin|code)|verification\s*code|security\s*code|passcode|auth(entication)?\s*code)\b/i,
  /\b(code|pin)\s*(is|:)\s*\d{4,8}\b/i,
  /\bdo\s*not\s*share\b/i,
  /رمز\s*(التحقق|التفعيل|المرور|سري)|كلمة\s*(المرور|السر)\s*(لمرة|المؤقتة)|لا\s*تشارك/,
];
export const isOneTimeCode = (text) => OTP.some((r) => r.test(text));

/** Hides card/account numbers (keeps the last 4) and available balances. */
export function maskSensitive(text) {
  return text
    .replace(/\b\d(?:[ -]?\d){11,18}\b/g, (m) => `••${m.replace(/\D/g, "").slice(-4)}`)
    .replace(/(?:\b\d+)?[xX*•]{2,}[ -]?\d*(\d{4})\b/g, "••$1")
    .replace(/(avl\.?|avail(able)?\.?|available)\s*(bal(ance)?\.?|limit)\s*(is|:)?\s*(AED|د\.إ)?\s*[+-]?\s*[\d,]+(\.\d+)?\s*(AED|د\.إ)?/gi, "[balance hidden]")
    .replace(/(الرصيد\s*(المتاح|المتوفر)?)\s*(:)?\s*[\d,]+(\.\d+)?\s*(درهم|د\.إ|AED)?/g, "[الرصيد مخفي]");
}

const AED_AMOUNT = [
  /(?:AED|Dhs?\.?|د\.إ\.?|درهم)\s*([\d,]+(?:\.\d{1,2})?)/i,
  /([\d,]+(?:\.\d{1,2})?)\s*(?:AED|Dhs?\.?|د\.إ\.?|درهم)/i,
];
const FOREIGN = /\b(USD|EUR|GBP|SAR|QAR|KWD|OMR|BHD|INR|PKR|EGP|TRY|JPY|CNY|CAD|AUD)\s*([\d,]+(?:\.\d{1,2})?)|([\d,]+(?:\.\d{1,2})?)\s*(USD|EUR|GBP|SAR|QAR|KWD|OMR|BHD|INR|PKR|EGP|TRY|JPY|CNY|CAD|AUD)\b/i;
const FEE = /\b(fee|fees|charges?|commission)\b|رسوم|عمولة/i;
const INCOME = /\b(credited|received|deposit(ed)?|salary|refund(ed)?|reversal|cashback|transfer(red)?\s+to\s+your)\b|إيداع|تم\s*(إضافة|ايداع)|راتب|استرداد|استرجاع/i;
const EXPENSE = /\b(purchase|spent|debited|paid|payment|withdrawn|withdrawal|pos|used\s+for|transaction\s+(of|at|for)|charged)\b|شراء|خصم|سحب|دفع|تم\s*استخدام|عملية/i;

/** "1,234.50" → 123450 fils, or null when it isn't a sensible AED amount. */
export function toFils(s) {
  const n = String(s).replace(/,/g, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(n)) return null;
  const [a, b = ""] = n.split(".");
  const f = Number(a) * 100 + Number((b + "00").slice(0, 2));
  return f > 0 && f < 10_000_000_00 ? f : null;
}

function findMerchant(text) {
  // SIB: "Your transfer of AED 20.00 to <name>, sent on 17-Nov-26"
  const transfer = text.match(/\btransfer of\b.*?\bto\s+([A-Za-z][A-Za-z .'-]{1,40}?)\s*(?=,|\.|\bsent\b|\bon\b|$)/i);
  if (transfer) return `Transfer to ${transfer[1].trim()}`;
  const en = text.match(/\b(?:at|@|from merchant|merchant:?)\s+([A-Za-z0-9][A-Za-z0-9 &'.\-*/]{1,40}?)(?=\s+(?:on|using|via|with|for|in|dated|card|ref|avl|available)\b|[.,;:\n]|\s+\d{1,2}[/-]|$)/i);
  if (en) return en[1].replace(/\s+/g, " ").trim();
  for (const word of ["لدى", "في", "من"]) {
    const ar = text.match(new RegExp(`${word}\\s+([^\\s،.\\d][^،.\\n]{1,40}?)(?=\\s+(?:بتاريخ|باستخدام|ببطاقة|في\\s+\\d)|[،.\\n]|$)`));
    if (ar && !/بطاقت|حساب/.test(ar[1])) return ar[1].trim();
  }
  return "";
}

/** One bank message → { type, fils, foreign, merchant }. type is null when it can't tell. */
export function parseMoneyMessage(raw) {
  const text = String(raw).replace(/\s+/g, " "); // copied or OCR'd messages break lines anywhere
  let fils = null;
  let foreign = null;
  for (const r of AED_AMOUNT) {
    const m = text.match(r);
    if (m) { fils = toFils(m[1]); break; }
  }
  if (fils === null) {
    const f = text.match(FOREIGN);
    if (f) foreign = f[1] ? `${f[1].toUpperCase()} ${f[2]}` : `${f[4].toUpperCase()} ${f[3]}`;
  }
  const type = FEE.test(text) ? "fee" : INCOME.test(text) && !/\b(purchase|spent|debited|paid)\b/i.test(text) ? "income" : EXPENSE.test(text) ? "expense" : null;
  return { type, fils, foreign, merchant: findMerchant(text).slice(0, 60) };
}

const CATEGORIES = [
  [/TALABAT|طلبات|كارفور|لولو|DELIVEROO|NOON ?FOOD|CAREEM ?FOOD|CARREFOUR|LULU|SPINNEYS|WAITROSE|UNION ?COOP|CHOITHRAMS|STARBUCKS|COSTA|TIM ?HORTONS|MCDONALD|KFC|SHAKE ?SHACK|RESTAURANT|CAFE|COFFEE|BAKERY|GROCER|SUPERMARKET|SWEETS|CHEESECAKE|DESSERT|PATISSERIE|KUNAFA|SHAWARMA|BURGER|PIZZA|GRILL|KITCHEN/, "Food"],
  [/CAREEM|كريم|UBER|RTA|SALIK|NOL|ENOC|ADNOC|EMARAT|PARKING|TAXI|METRO|PETROL/, "Transport"],
  [/AMAZON|NOON|نون|أمازون|IKEA|SHEIN|NAMSHI|CENTREPOINT|H ?& ?M|ZARA|MALL|SHARAF ?DG|VIRGIN ?MEGASTORE/, "Shopping"],
  [/DEWA|SEWA|ADDC|FEWA|ETISALAT|\bDU\b|\bE ?&|EMIRATES ?INTEGRATED|RENT|INSURANCE/, "Bills"],
  [/PHARMACY|ASTER|LIFE ?PHARMACY|BOOTS|CLINIC|HOSPITAL|DENTAL|MEDICAL/, "Health"],
  [/NETFLIX|SPOTIFY|ANGHAMI|SHAHID|OSN|VOX|REEL ?CINEMAS|NOVO|PLAYSTATION|STEAM|APPLE\.COM|YOUTUBE/, "Fun"],
];

export function guessCategory(merchant, type, text = "") {
  if (type === "fee") return "Bank fee";
  if (type === "income") return /salary|payroll|راتب/i.test(text) ? "Salary" : /refund|reversal|cashback|استرداد|استرجاع/i.test(text) ? "Refund" : "Other";
  if (merchant.startsWith("Transfer to ")) return "Transfer";
  const up = merchant.toUpperCase();
  return CATEGORIES.find(([r]) => r.test(up))?.[1] ?? "Other";
}
