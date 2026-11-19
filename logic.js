// Orbit's rules, with no screen code, so they can be tested on the laptop (tests/logic.test.mjs).
import { guessCategory, isOneTimeCode, maskSensitive, parseMoneyMessage, toFils } from "./bank.js";

export { toFils };

// ----- Dates (Dubai) as "YYYY-MM-DD" -----
export const todayKey = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(now);
const toUTC = (key) => { const [y, m, d] = key.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fromUTC = (dt) => dt.toISOString().slice(0, 10);
export const addDays = (key, n) => { const d = toUTC(key); d.setUTCDate(d.getUTCDate() + n); return fromUTC(d); };
/** 0 = Sunday … 6 = Saturday. */
export const weekday = (key) => toUTC(key).getUTCDay();
/** Monday to Sunday around this day. */
export const weekRange = (key) => { const start = addDays(key, -((weekday(key) + 6) % 7)); return [start, addDays(start, 6)]; };
export const monthRange = (key) => { const end = toUTC(key.slice(0, 8) + "01"); end.setUTCMonth(end.getUTCMonth() + 1, 0); return [key.slice(0, 8) + "01", fromUTC(end)]; };
export const previousRange = (kind, [start]) => (kind === "week" ? weekRange : monthRange)(addDays(start, -1));
export const inRange = (d, [a, b]) => d >= a && d <= b;
export function daysIn([a, b]) { const out = []; for (let d = a; d <= b; d = addDays(d, 1)) out.push(d); return out; }

// ----- Saved data -----
// routines: [{ id, name, days: [0-6], exercises: [{ id, name, sets, reps, kg, failure, note }] }]
// habits: [{ id, name, emoji, perDay }], with each day's taps in days[date].habits[habitId]
export const emptyState = () => ({
  v: 1,
  settings: { waterMl: 3000, proteinG: 170 },
  tasks: [], days: {}, money: [], shifts: [], sarwa: [], routines: [], workouts: [], goals: [], habits: [],
  seen: {}, lastBackup: null,
});

const LISTS = ["tasks", "money", "shifts", "sarwa", "routines", "workouts", "goals", "habits"];
const clampNum = (v, lo, hi, dflt) => (Number.isFinite(v) && v >= lo && v <= hi ? v : dflt);
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/** Checks a saved copy or a backup file and fills in anything missing. Throws on something that isn't an Orbit backup. */
export function normalize(raw) {
  if (!raw || typeof raw !== "object" || raw.v !== 1) throw new Error("This isn't an Orbit backup.");
  const s = emptyState();
  for (const k of LISTS) {
    if (raw[k] !== undefined && !Array.isArray(raw[k])) throw new Error(`The backup's ${k} part is damaged.`);
    s[k] = (raw[k] ?? []).filter((x) => x && typeof x === "object" && typeof x.id === "string");
  }
  for (const k of ["days", "seen"]) if (raw[k] && typeof raw[k] === "object" && !Array.isArray(raw[k])) s[k] = raw[k];
  // The first version kept one workout per weekday in `plan`; each becomes a routine on that day.
  if (raw.plan && typeof raw.plan === "object" && !raw.routines) {
    for (const [wd, p] of Object.entries(raw.plan)) {
      if (p?.exercises?.length) s.routines.push({ id: uid(), name: p.name || "Workout", days: [Number(wd)], exercises: p.exercises });
    }
  }
  for (const r of s.routines) { r.days = Array.isArray(r.days) ? r.days : []; r.exercises = Array.isArray(r.exercises) ? r.exercises : []; }
  s.settings.waterMl = clampNum(raw.settings?.waterMl, 250, 8000, 3000);
  s.settings.proteinG = clampNum(raw.settings?.proteinG, 10, 500, 170);
  s.lastBackup = typeof raw.lastBackup === "string" ? raw.lastBackup : null;
  return s;
}

// ----- "Paste from Claude": data Claude read from your screenshots, added to what's already in Orbit -----
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v, lo, hi) => (Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Adds what's new and skips what's already there, so pasting the same text twice changes nothing. */
export function mergeImport(s, text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("That text isn't complete. Copy the whole block from Claude and paste it again."); }
  if (!data || data.orbit !== "import") throw new Error("That isn't an Orbit import from Claude.");
  const out = { routines: 0, habits: 0, shifts: 0, money: 0, sarwa: 0 };
  for (const r of data.routines ?? []) {
    const name = str(r?.name, 30);
    if (!name) continue;
    const exercises = (r.exercises ?? []).map((e) => ({ id: uid(), name: str(e?.name, 60), sets: num(e?.sets, 1, 10) ?? 2, reps: num(e?.reps, 1, 100) ?? 10, kg: num(e?.kg, 0, 500), failure: e?.failure === true, note: str(e?.note, 40) })).filter((e) => e.name);
    const old = s.routines.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (old) { if (JSON.stringify(old.exercises.map(({ id, ...e }) => e)) !== JSON.stringify(exercises.map(({ id, ...e }) => e))) { old.exercises = exercises; out.routines++; } continue; }
    s.routines.push({ id: uid(), name, days: (r.days ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6), exercises });
    out.routines++;
  }
  for (const h of data.habits ?? []) {
    const name = str(h?.name, 60);
    if (!name || s.habits.some((x) => x.name.toLowerCase() === name.toLowerCase())) continue;
    s.habits.push({ id: uid(), name, emoji: str(h.emoji, 8), perDay: num(h.perDay, 1, 20) ?? 1 });
    out.habits++;
  }
  for (const x of data.shifts ?? []) {
    const fils = toFils(String(x?.aed ?? ""));
    const title = str(x?.title, 80) || "Liveforce shift";
    if (!isDate(x?.date) || !fils || s.shifts.some((y) => y.date === x.date && (y.title ?? "") === title)) continue;
    s.shifts.push({ id: uid(), date: x.date, title, hours: num(x.hours, 0.25, 24) ?? 0, fils, paid: x.paid === true });
    out.shifts++;
  }
  for (const m of data.money ?? []) {
    const fils = toFils(String(m?.aed ?? ""));
    const type = ["expense", "income", "fee"].includes(m?.type) ? m.type : "expense";
    const note = str(m?.note, 60);
    if (!isDate(m?.date) || !fils || s.money.some((y) => y.date === m.date && y.fils === fils && (y.note ?? "") === note)) continue;
    s.money.push({ id: uid(), date: m.date, type, fils, note, category: str(m.category, 20) || "Other", source: "claude" });
    out.money++;
  }
  for (const v of data.sarwa ?? []) {
    const usd = num(v?.usd, 0, 1e9);
    if (!isDate(v?.date) || usd === null || s.sarwa.some((y) => y.date === v.date && y.value === usd)) continue;
    s.sarwa = s.sarwa.filter((y) => y.date !== v.date);
    s.sarwa.push({ id: uid(), date: v.date, value: usd });
    out.sarwa++;
  }
  return out;
}

// ----- Bank SMS and Apple Pay, from the file the iPhone Shortcut keeps -----
// Each message starts with a line "=== <date> | <sender>", then the message text.

const fingerprint = (text) => {
  let h = 2166136261; // FNV-1a: enough to spot the same message twice
  for (const c of text.replace(/\s+/g, " ").trim().toLowerCase()) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0;
  return h.toString(36);
};

/** Reads the Shortcut file. Returns new money entries plus counts; `seen` is updated so a second import adds nothing. */
export function importMessages(fileText, seen, today) {
  const oldest = addDays(today, -60);
  const out = { entries: [], added: 0, already: 0, skipped: 0, needsAed: [] };
  const blocks = String(fileText).slice(0, 5_000_000).split(/^===\s*/m).map((b) => b.trim()).filter(Boolean);
  for (const block of blocks.slice(-3000)) {
    const [head, ...rest] = block.split("\n");
    const text = rest.join("\n").trim();
    const date = head.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? today;
    if (!text || date < oldest || date > today || isOneTimeCode(text)) { out.skipped++; continue; }
    const fp = fingerprint(date + text);
    if (seen[fp]) { out.already++; continue; }
    const p = parseMoneyMessage(text);
    if (p.fils === null) {
      if (p.foreign) out.needsAed.push(`${p.foreign}${p.merchant ? ` at ${p.merchant}` : ""}`);
      else { out.skipped++; continue; }
      seen[fp] = date;
      continue;
    }
    seen[fp] = date;
    const type = p.type ?? "expense";
    out.entries.push({ id: uid(), date, type, fils: p.fils, note: p.merchant || (head.split("|")[1] ?? "").trim() || "Bank message", category: guessCategory(p.merchant, type, text), source: "shortcut", text: maskSensitive(text).slice(0, 300) });
    out.added++;
  }
  for (const [fp, d] of Object.entries(seen)) if (d < addDays(today, -90)) delete seen[fp]; // older messages are never imported again anyway
  return out;
}

/** One pasted message, for the "Paste a bank SMS" box. */
export function readPasted(text) {
  if (isOneTimeCode(text)) return { error: "That's a one-time code. Nothing was saved." };
  const p = parseMoneyMessage(text);
  if (p.fils === null) return { error: p.foreign ? `It says ${p.foreign}. Add the AED amount yourself below.` : "No AED amount found in that message." };
  const type = p.type ?? "expense";
  return { type, fils: p.fils, note: p.merchant || "Bank message", category: guessCategory(p.merchant, type, text) };
}

// ----- Screenshots: what Orbit finds in the text read from one picture -----
// Bank SMS (SIB), Screen Time / Battery, Sarwa, and Liveforce earnings. You check and edit before anything is saved.

const MONTH = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const pad2 = (n) => String(n).padStart(2, "0");

/** A date heading in Messages ("Today", "Yesterday 8:08 PM", "Tue", "17 Nov") → "YYYY-MM-DD", or null. */
export function messageDay(line, today) {
  const l = line.trim().toLowerCase();
  if (/^today\b/.test(l)) return today;
  if (/^yesterday\b/.test(l)) return addDays(today, -1);
  const wd = l.match(/^(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/);
  if (wd) { const back = (weekday(today) - WEEKDAYS.indexOf(wd[1]) + 7) % 7 || 7; return addDays(today, -back); }
  const dm = l.match(/^(?:[a-z]{3},?\s+)?(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/) ?? l.match(/^(?:[a-z]{3},?\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})\b/);
  if (dm) {
    const [d, m] = /\d/.test(dm[1]) ? [Number(dm[1]), MONTH[dm[2]]] : [Number(dm[2]), MONTH[dm[1]]];
    let y = Number(today.slice(0, 4));
    if (`${y}-${pad2(m)}-${pad2(d)}` > today) y -= 1;
    return d >= 1 && d <= 31 ? `${y}-${pad2(m)}-${pad2(d)}` : null;
  }
  return null;
}

const money2 = (s) => toFils(String(s).replace(/\s+/g, ""));
const duration = (text) => {
  const m = text.match(/(\d{1,2})\s*h(?:rs?|ours?)?\s*(\d{1,2})\s*m(?:in)?\b/i) ?? text.match(/(\d{1,2})\s*h(?:rs?|ours?)?\b()/i) ?? text.match(/()(\d{1,2})\s*m(?:in)?\b/i);
  return m ? Number(m[1] || 0) * 60 + Number(m[2] || 0) : null;
};

/** Returns { kind, items } where kind is "sms" | "phone" | "sarwa" | "liveforce" | null. */
export function readScreenshot(rawText, today) {
  const text = String(rawText).replace(/\r/g, "");
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  if (/estimated earnings|salary\s*\|/i.test(text)) {
    const items = [];
    lines.forEach((l, i) => {
      const m = l.match(/(\d{2})-(\d{2})-(\d{4}).*?\((\d+(?:\.\d+)?)\s*hrs?\)/i);
      if (!m) return;
      const title = lines.slice(Math.max(0, i - 2), i).filter((x) => !/DH\b|salary|upcoming|pending|paid|earnings|outstanding/i.test(x)).join(" ").replace(/\((promoter|sales)[^)]*\)/gi, "").replace(/\s+/g, " ").trim();
      const after = lines.slice(i + 1, i + 3).join(" ");
      const pay = after.match(/([\d][\d\s,]*\.\d{2})\s*DH/i);
      if (!pay) return;
      items.push({ kind: "shift", date: `${m[3]}-${m[2]}-${m[1]}`, title: title.slice(0, 80) || "Liveforce shift", hours: Number(m[4]), fils: money2(pay[1]), paid: /\bpaid\b/i.test(after) && !/unpaid/i.test(after) });
    });
    return { kind: "liveforce", items: items.filter((x) => x.fils) };
  }

  if (/account balance/i.test(text) && /total return|equities|your cash/i.test(text)) {
    const after = text.slice(text.search(/account balance/i));
    const m = after.match(/\$\s?([\d,]+\.\d{2})/);
    return { kind: "sarwa", items: m ? [{ kind: "sarwa", date: today, usd: Number(m[1].replace(/,/g, "")) }] : [] };
  }

  if (/screen time|screen on|screen active|battery usage|daily average/i.test(text)) {
    const at = text.search(/screen on|screen active|yesterday|today|daily average|screen time/i);
    const minutes = duration(text.slice(Math.max(0, at)));
    const date = /yesterday/i.test(text) || !/\btoday\b/i.test(text) ? addDays(today, -1) : today;
    return { kind: "phone", items: minutes !== null && minutes <= 1440 ? [{ kind: "phone", date, minutes }] : [] };
  }

  // Bank messages: split at each message start, remembering the last date heading above it.
  const items = [];
  let date = today, chunk = [];
  const flush = () => {
    const t = chunk.join(" ");
    chunk = [];
    if (!t || isOneTimeCode(t)) return;
    const p = parseMoneyMessage(t);
    if (p.fils === null) return;
    const type = p.type ?? "expense";
    items.push({ kind: "money", date, type, fils: p.fils, note: p.merchant || "Bank message", category: guessCategory(p.merchant, type, t) });
  };
  for (const l of lines) {
    const d = messageDay(l, today);
    if (d) { flush(); date = d; continue; }
    if (/^(a\/c|your |dear |acct|card )/i.test(l)) flush();
    chunk.push(l);
  }
  flush();
  return { kind: items.length ? "sms" : null, items };
}

// ----- Week and month report -----
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

export function summary(s, range, today) {
  const r = [range[0], range[1] < today ? range[1] : today];
  const days = r[0] > r[1] ? [] : daysIn(r);
  const day = (d) => s.days[d] ?? {};
  const phone = days.map((d) => day(d).phoneMin).filter((v) => Number.isFinite(v));
  const shifts = s.shifts.filter((x) => inRange(x.date, r));
  return {
    days: days.length,
    tasksDone: s.tasks.filter((t) => t.done && t.doneOn && inRange(t.doneOn, r)).length,
    workouts: s.workouts.filter((w) => w.done && inRange(w.date, r)).length,
    waterDays: days.filter((d) => (day(d).waterMl ?? 0) >= s.settings.waterMl).length,
    proteinDays: days.filter((d) => (day(d).proteinG ?? 0) >= s.settings.proteinG).length,
    spentFils: sum(s.money.filter((m) => m.type !== "income" && inRange(m.date, r)).map((m) => m.fils)),
    workHours: sum(shifts.map((x) => x.hours)),
    workFils: sum(shifts.map((x) => x.fils)),
    phoneMin: sum(phone),
    phoneDays: phone.length,
    habitsDone: sum(days.map((d) => s.habits.filter((hb) => (day(d).habits?.[hb.id] ?? 0) >= hb.perDay).length)),
  };
}

const perDay = (n, days) => (days ? n / days : 0);

/**
 * Rows comparing this period with the one before.
 * better: true / false / null (nothing to compare). Lower is better for spending and phone time.
 */
export function report(s, kind, today) {
  const range = (kind === "week" ? weekRange : monthRange)(today);
  const prevRange = previousRange(kind, range);
  const cur = summary(s, range, today);
  const prev = summary(s, prevRange, today);
  // Before Orbit was used there is nothing to compare with, so no arrows.
  const used = Object.keys(s.days).some((d) => inRange(d, prevRange)) || [s.money, s.workouts].some((xs) => xs.some((x) => inRange(x.date, prevRange))) || s.tasks.some((t) => t.doneOn && inRange(t.doneOn, prevRange));
  const cmp = (a, b, lowerIsBetter = false) => (!used || b === null || a === b ? null : lowerIsBetter ? a < b : a > b);
  const rate = (n, d) => (d ? Math.round((n / d) * 100) : 0);
  const avgPhone = (x) => (x.phoneDays ? Math.round(x.phoneMin / x.phoneDays) : null);
  return {
    range, prevRange, cur, prev,
    rows: [
      { key: "workouts", label: "Gym workouts", now: cur.workouts, before: prev.workouts, better: cmp(cur.workouts, prev.workouts) },
      { key: "tasks", label: "Tasks finished", now: cur.tasksDone, before: prev.tasksDone, better: cmp(cur.tasksDone, prev.tasksDone) },
      { key: "habits", label: "Habits done a day", now: cur.days ? Math.round((cur.habitsDone / cur.days) * 10) / 10 : 0, before: prev.days ? Math.round((prev.habitsDone / prev.days) * 10) / 10 : 0, better: cmp(cur.days ? cur.habitsDone / cur.days : 0, prev.days ? prev.habitsDone / prev.days : 0) },
      { key: "water", label: "Water goal days", now: `${cur.waterDays} of ${cur.days}`, before: `${prev.waterDays} of ${prev.days}`, better: cmp(rate(cur.waterDays, cur.days), rate(prev.waterDays, prev.days)) },
      { key: "protein", label: "Protein goal days", now: `${cur.proteinDays} of ${cur.days}`, before: `${prev.proteinDays} of ${prev.days}`, better: cmp(rate(cur.proteinDays, cur.days), rate(prev.proteinDays, prev.days)) },
      { key: "phone", label: "Phone time a day", now: avgPhone(cur), before: avgPhone(prev), better: avgPhone(cur) === null ? null : cmp(avgPhone(cur), avgPhone(prev), true), minutes: true },
      { key: "spent", label: "Spent a day", now: Math.round(perDay(cur.spentFils, cur.days)), before: Math.round(perDay(prev.spentFils, prev.days)), better: cur.days ? cmp(Math.round(perDay(cur.spentFils, cur.days)), Math.round(perDay(prev.spentFils, prev.days)), true) : null, fils: true },
      { key: "work", label: "Liveforce hours", now: cur.workHours, before: prev.workHours, better: null },
    ],
  };
}
