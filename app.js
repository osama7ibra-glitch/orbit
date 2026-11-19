// Orbit's screens. Everything is saved only on this phone (localStorage); nothing is sent anywhere.
import { addDays, emptyState, importMessages, inRange, mergeImport, monthRange, normalize, readPasted, readScreenshot, report, toFils, todayKey, uid, weekday } from "./logic.js";
import { readText } from "./ocr.js";

const KEY = "orbit.v1";
const $ = (sel) => document.querySelector(sel);
const view = $("#view");
const sheet = $("#sheet");

// ----- Saved data -----
function load() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch { return emptyState(); }
  if (!raw) return emptyState();
  try { return normalize(JSON.parse(raw)); } catch {
    // Never write over a copy Orbit can't read: keep it aside and start fresh.
    try { localStorage.setItem(`${KEY}.unreadable.${Date.now()}`, raw); } catch { /* storage full */ }
    return emptyState();
  }
}
let S = load();
let warnedSave = false;
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); return true; } catch {
    if (!warnedSave) { warnedSave = true; toast("Orbit couldn't save on this phone. Save a backup from Settings now."); }
    return false;
  }
}
function commit() { save(); render(); }
navigator.storage?.persist?.().catch(() => {});
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

// ----- Small helpers -----
const today = () => todayKey();
const dayRec = (d) => (S.days[d] ??= {});
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const aed = (fils) => `AED ${(fils / 100).toLocaleString("en-US", { minimumFractionDigits: fils % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const litres = (ml) => `${(ml / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 })} L`;
const hm = (min) => (min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`);
const fmt = (d, opts = { weekday: "short", day: "numeric", month: "short" }) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...opts }).format(new Date(`${d}T00:00:00Z`));
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const SPEND_CATS = ["Food", "Transport", "Shopping", "Bills", "Health", "Fun", "Transfer", "Bank fee", "Other"];
const INCOME_CATS = ["Liveforce", "Salary", "Refund", "Other"];

/** Builds an element. Text always goes in as text, never as HTML. */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "class") el.className = v;
    else if (k === "value") el.value = v;
    else if (k === "checked") el.checked = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
const svg = (path) => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true"); s.innerHTML = path; return s; };
const gear = () => svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>');
const camera = () => svg('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>');
const card = (title, right, ...body) => h("section", { class: "card" }, h("div", { class: "row" }, h("h2", {}, title), right ? h("span", { class: "muted" }, right) : null), ...body);
const bar = (part, whole) => { const i = h("i"); i.style.setProperty("width", `${Math.min(100, whole ? (part / whole) * 100 : 0)}%`); return h("div", { class: "bar" }, i); };
const field = (label, input) => h("label", { class: "field" }, h("span", {}, label), input);
const header = (title, sub, right) => h("header", { class: "top" }, h("div", {}, h("p", { class: "date" }, sub), h("h1", {}, title)), right ?? null);
const delButton = (label, onDelete) => h("button", { class: "x", type: "button", "aria-label": label, onClick: onDelete }, "×");
/** A delete button that asks for a second tap. */
function confirmButton(text, onConfirm) {
  const b = h("button", { class: "btn danger", type: "button" }, text);
  b.addEventListener("click", () => {
    if (b.dataset.armed) return onConfirm();
    b.dataset.armed = "1";
    b.textContent = "Tap again to confirm";
    setTimeout(() => { delete b.dataset.armed; b.textContent = text; }, 3000);
  });
  return b;
}

let toastTimer;
function toast(msg, undo) {
  const t = $("#toast");
  t.replaceChildren(h("span", {}, msg), ...(undo ? [h("button", { type: "button", onClick: () => { undo(); t.hidden = true; } }, "Undo")] : []));
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, undo ? 6000 : 3500);
}

// ----- Screens -----
const SCREENS = { home: viewHome, money: viewMoney, health: viewHealth, goals: viewGoals };
const route = () => (SCREENS[location.hash.slice(1)] ? location.hash.slice(1) : "home");
let sheetFill = null;
function render() {
  const r = route();
  view.replaceChildren(...[SCREENS[r]()].flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false));
  document.querySelectorAll(".tabs a").forEach((a) => (a.dataset.tab === r ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  if (sheet.open && sheetFill) sheetFill();
}
window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });
document.addEventListener("visibilitychange", () => { if (!document.hidden && !sheet.open) render(); }); // a new day starts fresh

// ===== Home =====
function viewHome() {
  const d = today();
  const rec = S.days[d] ?? {};
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  const greet = hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const tasks = S.tasks.filter((t) => !t.done || t.doneOn === d);
  const doneCount = tasks.filter((t) => t.done).length;
  const spent = sum(S.money.filter((m) => m.date === d && m.type !== "income").map((m) => m.fils));
  const yesterday = addDays(d, -1);
  const phone = S.days[yesterday]?.phoneMin;
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const hasData = S.tasks.length || S.money.length || Object.keys(S.days).length || S.goals.length;
  const wk = report(S, "week", d);

  return [
    header(greet, fmt(d, { weekday: "long", day: "numeric", month: "long" }), h("div", { class: "inline" },
      h("button", { class: "icon-btn", type: "button", "aria-label": "Read a screenshot", onClick: openScreenshot }, camera()),
      h("button", { class: "icon-btn", type: "button", "aria-label": "Settings", onClick: openSettings }, gear()))),
    !standalone ? h("div", { class: "notice" }, h("p", {}, "To install Orbit: tap ••• (or the Share button), then Share → Add to Home Screen, keep Open as Web App on, and tap Add. Then always open it from that icon. What you add here in Safari stays in Safari.")) : null,
    standalone && hasData && (!S.lastBackup || S.lastBackup < addDays(d, -14)) ? h("div", { class: "notice warn" }, h("p", {}, S.lastBackup ? `Last backup: ${fmt(S.lastBackup)}. Save a new one so nothing is lost if this phone is lost.` : "You haven't saved a backup yet. If this phone is lost, so is your data."), h("button", { class: "link", type: "button", onClick: saveBackup }, "Save backup now")) : null,

    card("Finish today", tasks.length ? `${doneCount} of ${tasks.length} done` : "",
      tasks.length ? h("ul", { class: "list" }, tasks.map((t) => taskRow(t, d))) : h("p", { class: "muted" }, "Nothing left. Add what you need to finish today."),
      addForm("New task", "Add something to finish today", (text) => { S.tasks.push({ id: uid(), text, done: false, createdOn: d }); commit(); })),

    h("section", { class: "trackers", "aria-label": "Water and protein" },
      counter("Water", `+250 ml a tap`, rec.waterMl ?? 0, S.settings.waterMl, litres, (n) => { dayRec(d).waterMl = Math.max(0, Math.min(10000, (rec.waterMl ?? 0) + n * 250)); commit(); }),
      counter("Protein", `+10 g a tap`, rec.proteinG ?? 0, S.settings.proteinG, (g) => `${g} g`, (n) => { dayRec(d).proteinG = Math.max(0, Math.min(600, (rec.proteinG ?? 0) + n * 10)); commit(); })),

    habitsCard(d),

    workoutCard(d),

    h("section", { class: "pair" },
      h("a", { class: "stat", href: "#money" }, h("span", { class: "label" }, "Spent today"), h("span", { class: "num" }, aed(spent))),
      h("button", { class: "stat", type: "button", onClick: () => openPhone(yesterday) }, h("span", { class: "label" }, "Phone yesterday"), h("span", { class: "num" }, phone === undefined ? "Add" : hm(phone)))),

    card("This week", `${fmt(wk.range[0], { day: "numeric", month: "short" })} – ${fmt(wk.range[1], { day: "numeric", month: "short" })}`,
      h("div", { class: "grid3" },
        miniStat("Workouts", wk.cur.workouts),
        miniStat("Water days", `${wk.cur.waterDays}/${wk.cur.days}`),
        miniStat("Phone a day", wk.cur.phoneDays ? hm(Math.round(wk.cur.phoneMin / wk.cur.phoneDays)) : "–")),
      h("button", { class: "btn ghost wide", type: "button", onClick: () => openReport("week") }, "See week and month report")),
  ];
}
const miniStat = (label, value) => h("div", { class: "field" }, h("span", {}, label), h("strong", {}, String(value)));

function taskRow(t, d) {
  return h("li", { class: t.done ? "done" : "" },
    h("label", { class: "check" },
      h("input", { type: "checkbox", checked: t.done, onChange: (e) => { t.done = e.target.checked; t.doneOn = t.done ? d : undefined; commit(); } }),
      h("span", {}, t.text)),
    !t.done && t.createdOn && t.createdOn < d ? h("span", { class: "tag" }, `since ${fmt(t.createdOn, { weekday: "short" })}`) : null,
    delButton(`Remove ${t.text}`, () => { const i = S.tasks.indexOf(t); S.tasks.splice(i, 1); commit(); toast("Task removed", () => { S.tasks.splice(i, 0, t); commit(); }); }));
}

function addForm(label, placeholder, onAdd) {
  const input = h("input", { type: "text", placeholder, maxlength: "140", autocomplete: "off", "aria-label": label });
  return h("form", { class: "inline", onSubmit: (e) => { e.preventDefault(); const v = input.value.trim(); if (!v) return input.focus(); onAdd(v); } }, input, h("button", { class: "btn", type: "submit" }, "Add"));
}

function counter(label, hint, value, goal, show, change) {
  return h("div", { class: "tile" },
    h("button", { class: "main", type: "button", "aria-label": `${label}: ${show(value)} of ${show(goal)}. ${hint}.`, onClick: () => change(1) },
      h("span", { class: "label" }, `${label} · ${hint}`),
      h("span", { class: "num" }, show(value), h("small", {}, ` / ${show(goal)}`))),
    bar(value, goal),
    h("div", { class: "foot" }, value >= goal ? h("span", { class: "ok" }, "Goal reached") : h("span", { class: "muted" }, `${show(goal - value)} to go`),
      h("button", { class: "minus", type: "button", "aria-label": `Take back one from ${label}`, onClick: () => change(-1) }, "−")));
}

// ----- Habits (like your habits app: tap to count, done when the number is reached) -----
function habitsCard(d) {
  if (!S.habits.length) return card("Habits", "", h("p", { class: "muted" }, "Add the things you do every day, like brush teeth 3 times or pray 5 times."), h("button", { class: "btn ghost wide", type: "button", onClick: openHabits }, "Add habits"));
  const counts = S.days[d]?.habits ?? {};
  const done = S.habits.filter((hb) => (counts[hb.id] ?? 0) >= hb.perDay).length;
  return card("Habits", `${done} of ${S.habits.length} done`,
    bar(done, S.habits.length),
    h("div", { class: "habits" }, S.habits.map((hb) => {
      const n = Math.min(counts[hb.id] ?? 0, hb.perDay);
      const full = n >= hb.perDay;
      return h("button", { class: `habit${full ? " done" : ""}`, type: "button", "aria-label": `${hb.name}: ${n} of ${hb.perDay}. Tap to ${full ? "take one back" : "add one"}.`, onClick: () => { const c = (dayRec(d).habits ??= {}); c[hb.id] = full ? n - 1 : n + 1; commit(); } },
        h("span", { class: "habit-name" }, hb.emoji ? h("span", { "aria-hidden": "true" }, `${hb.emoji} `) : null, hb.name),
        h("span", { class: "habit-n" }, hb.perDay === 1 ? (full ? "✓" : "") : `${n}/${hb.perDay}`));
    })),
    h("button", { class: "link", type: "button", onClick: openHabits }, "Edit habits"));
}

function openHabits() {
  openSheet("Habits", () => {
    const emoji = h("input", { type: "text", placeholder: "🙂", maxlength: "8", "aria-label": "Emoji" });
    const name = h("input", { type: "text", placeholder: "Habit, e.g. Read 10 pages", maxlength: "60", "aria-label": "Habit name" });
    const per = h("input", { type: "number", inputmode: "numeric", min: "1", max: "20", value: "1", "aria-label": "Times a day" });
    const setNum = (hb, v) => { const n = Number(v); if (Number.isInteger(n) && n >= 1 && n <= 20) { hb.perDay = n; save(); } };
    return [
      h("p", { class: "muted" }, "Change a name, emoji or times a day and it saves at once. Tap × to remove a habit."),
      S.habits.length ? h("ul", { class: "list" }, S.habits.map((hb) => h("li", { class: "habit-edit" },
        h("input", { type: "text", value: hb.emoji, maxlength: "8", "aria-label": `Emoji for ${hb.name}`, onChange: (e) => { hb.emoji = e.target.value.trim(); save(); } }),
        h("input", { type: "text", value: hb.name, maxlength: "60", "aria-label": "Habit name", onChange: (e) => { if (e.target.value.trim()) { hb.name = e.target.value.trim(); save(); } } }),
        h("input", { type: "number", inputmode: "numeric", min: "1", max: "20", value: String(hb.perDay), "aria-label": `Times a day for ${hb.name}`, onChange: (e) => setNum(hb, e.target.value) }),
        delButton(`Remove ${hb.name}`, () => { S.habits = S.habits.filter((y) => y !== hb); commit(); toast("Habit removed", () => { S.habits.push(hb); commit(); }); })))) : null,
      h("form", { class: "field", onSubmit: (e) => {
        e.preventDefault();
        if (!name.value.trim()) return name.focus();
        S.habits.push({ id: uid(), name: name.value.trim(), emoji: emoji.value.trim(), perDay: Math.min(20, Math.max(1, Number(per.value) || 1)) });
        commit();
      } }, h("h3", {}, "New habit"), h("div", { class: "habit-edit" }, emoji, name, per), h("button", { class: "btn wide", type: "submit" }, "Add habit")),
    ];
  });
}

// ----- Gym -----
const todaysRoutines = (d) => S.routines.filter((r) => r.days.includes(weekday(d)) && r.exercises.length);
const exLine = (ex) => `${ex.sets} × ${ex.failure ? "to failure" : ex.reps}${ex.kg ? ` · ${ex.kg} kg` : ""}${ex.note ? ` · ${ex.note}` : ""}`;

function workoutCard(d) {
  if (!S.routines.length) return card("Gym", "", h("p", { class: "muted" }, "No routines yet."), h("a", { class: "link", href: "#health" }, "Add your routines"));
  const w = S.workouts.find((x) => x.date === d);
  const r = (w && S.routines.find((x) => x.id === w.routineId)) || todaysRoutines(d)[0];
  if (!r) {
    const next = [1, 2, 3, 4, 5, 6].map((n) => addDays(d, n)).find((x) => todaysRoutines(x).length);
    return card("Gym", "Rest day", h("p", { class: "muted" }, next ? `Next: ${todaysRoutines(next)[0].name} on ${DAY_NAMES[weekday(next)]}.` : "Set days for your routines in Health to see them here."), h("a", { class: "link", href: "#health" }, "Train anyway"));
  }
  const total = sum(r.exercises.map((e) => e.sets));
  const doneSets = w ? sum(Object.values(w.sets ?? {}).map((a) => a.filter(Boolean).length)) : 0;
  return card(`Gym · ${r.name}`, w?.done ? "Done" : `${doneSets} of ${total} sets`,
    bar(w?.done ? total : doneSets, total),
    h("a", { class: "btn ghost wide", href: "#health" }, w?.done ? "See workout" : doneSets ? "Continue workout" : "Start workout"));
}

function openPhone(date) {
  openSheet("Phone time", () => {
    const cur = S.days[date]?.phoneMin;
    const hours = h("input", { type: "number", inputmode: "numeric", min: "0", max: "24", value: cur !== undefined ? String(Math.floor(cur / 60)) : "", placeholder: "0" });
    const mins = h("input", { type: "number", inputmode: "numeric", min: "0", max: "59", value: cur !== undefined ? String(cur % 60) : "", placeholder: "0" });
    const err = h("p", { class: "err", hidden: true });
    return [
      h("p", { class: "muted" }, `How long were you on your phone on ${fmt(date, { weekday: "long", day: "numeric", month: "short" })}? On iPhone: Settings → Screen Time → See All App & Website Activity → Day.`),
      h("form", { class: "field", onSubmit: (e) => {
        e.preventDefault();
        const hh = Number(hours.value || 0), mm = Number(mins.value || 0);
        if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 24 || mm < 0 || mm > 59 || hh * 60 + mm > 1440) { err.textContent = "Enter hours (0–24) and minutes (0–59)."; err.hidden = false; return; }
        dayRec(date).phoneMin = hh * 60 + mm;
        sheet.close();
        commit();
      } },
        h("div", { class: "grid2" }, field("Hours", hours), field("Minutes", mins)), err,
        h("button", { class: "btn wide", type: "submit" }, "Save")),
    ];
  });
}

// ===== Money =====
function viewMoney() {
  const d = today();
  const m = monthRange(d);
  const entries = S.money.filter((x) => inRange(x.date, m)).sort((a, b) => b.date.localeCompare(a.date));
  const spent = sum(entries.filter((x) => x.type !== "income").map((x) => x.fils));
  const received = sum(entries.filter((x) => x.type === "income").map((x) => x.fils));
  const sarwa = [...S.sarwa].sort((a, b) => b.date.localeCompare(a.date));
  const [last, before] = sarwa;
  const change = last && before ? last.value - before.value : null;

  return [
    header("Money", fmt(d, { month: "long", year: "numeric" })),
    h("section", { class: "pair" },
      h("div", { class: "stat" }, h("span", { class: "label" }, "Spent this month"), h("span", { class: "num" }, aed(spent))),
      h("div", { class: "stat" }, h("span", { class: "label" }, "Received this month"), h("span", { class: "num" }, aed(received)))),

    card("Add money", "", moneyForm(d)),
    card("Bank SMS and Apple Pay", "", importBlock(d)),

    liveforceCard(d, m),

    card("Sarwa", last ? `updated ${fmt(last.date)}` : "",
      last ? h("div", { class: "row" }, h("span", { class: "num" }, `$${last.value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`),
        change !== null ? h("span", { class: change >= 0 ? "up" : "down" }, `${change >= 0 ? "+" : "−"}$${Math.abs(change).toLocaleString("en-US", { maximumFractionDigits: 2 })} (${before.value ? `${((change / before.value) * 100).toFixed(1)}%` : "–"}) since ${fmt(before.date, { day: "numeric", month: "short" })}`) : null)
        : h("p", { class: "muted" }, "Open Sarwa, then type your portfolio value here. Orbit shows how it changes."),
      sarwaForm(d)),

    card("This month", entries.length ? `${entries.length} items` : "",
      entries.length ? h("ul", { class: "list" }, entries.map((x) => h("li", {},
        h("span", { class: "grow" }, h("span", {}, x.note || x.category), h("br"), h("span", { class: "muted" }, `${fmt(x.date)} · ${x.category}${x.source === "shortcut" ? " · from bank message" : ""}`)),
        h("span", { class: x.type === "income" ? "up" : "" }, `${x.type === "income" ? "+" : "−"}${aed(x.fils).replace("AED ", "")}`),
        delButton(`Remove ${x.note || x.category}`, () => { S.money = S.money.filter((y) => y !== x); commit(); toast("Removed", () => { S.money.push(x); commit(); }); }))))
        : h("p", { class: "muted" }, "Nothing yet this month.")),
  ];
}

function amountInput() { return h("input", { type: "text", inputmode: "decimal", placeholder: "0.00", autocomplete: "off" }); }
/** "12.50" → 1250 fils, or null. A comma is a thousands separator, as banks write it. */
const readAmount = (input) => toFils(input.value.trim());

function moneyForm(d) {
  const kind = { value: "expense" };
  const amount = amountInput();
  const note = h("input", { type: "text", placeholder: "What for", maxlength: "60", autocomplete: "off" });
  const cat = h("select", {}, SPEND_CATS.map((c) => h("option", {}, c)));
  const date = h("input", { type: "date", value: d, max: d });
  const err = h("p", { class: "err", hidden: true });
  const setKind = (k) => { kind.value = k; cat.replaceChildren(...(k === "income" ? INCOME_CATS : SPEND_CATS).map((c) => h("option", {}, c))); };
  const seg = h("div", { class: "seg", role: "radiogroup", "aria-label": "Money out or in" },
    h("label", {}, h("input", { type: "radio", name: "kind", checked: true, onChange: () => setKind("expense") }), h("span", {}, "Spent")),
    h("label", {}, h("input", { type: "radio", name: "kind", onChange: () => setKind("income") }), h("span", {}, "Received")));
  return h("form", { class: "field", onSubmit: (e) => {
    e.preventDefault();
    const fils = readAmount(amount);
    if (!fils) { err.textContent = "Enter an amount in AED, like 25 or 12.50."; err.hidden = false; return amount.focus(); }
    if (!date.value || date.value > d) { err.textContent = "Pick today or an earlier day."; err.hidden = false; return; }
    const entry = { id: uid(), date: date.value, type: kind.value, fils, note: note.value.trim(), category: cat.value, source: "manual" };
    S.money.push(entry);
    commit();
    toast(`${kind.value === "income" ? "Added" : "Spent"} ${aed(fils)}`, () => { S.money = S.money.filter((y) => y !== entry); commit(); });
  } },
    seg, h("div", { class: "grid2" }, field("Amount (AED)", amount), field("Category", cat)), field("Note", note), field("Date", date), err,
    h("button", { class: "btn wide", type: "submit" }, "Add"));
}

function importBlock(d) {
  const file = h("input", { type: "file", accept: ".txt,text/plain", "aria-label": "Choose the messages file" });
  file.addEventListener("change", () => {
    const f = file.files?.[0];
    if (!f) return;
    if (f.size > 5_000_000) return toast("That file is too big (over 5 MB).");
    const reader = new FileReader();
    reader.onload = () => {
      const r = importMessages(String(reader.result), S.seen, d);
      S.money.push(...r.entries);
      commit();
      const ids = new Set(r.entries.map((e) => e.id));
      const parts = [`Added ${r.added}`];
      if (r.already) parts.push(`${r.already} already in Orbit`);
      if (r.needsAed.length) parts.push(`${r.needsAed.length} in other currencies to add yourself`);
      toast(parts.join(" · "), r.added ? () => { S.money = S.money.filter((x) => !ids.has(x.id)); commit(); } : null);
    };
    reader.onerror = () => toast("Orbit couldn't read that file.");
    reader.readAsText(f);
    file.value = ""; // so the same file can be picked again next time
  });
  const text = h("textarea", { placeholder: "Paste one bank SMS here", maxlength: "2000", "aria-label": "Bank message" });
  const out = h("div", { class: "field" });
  const read = () => {
    const r = readPasted(text.value);
    if (r.error) return out.replaceChildren(h("p", { class: "err" }, r.error));
    out.replaceChildren(h("p", { class: "ok" }, `${r.type === "income" ? "Received" : "Spent"} ${aed(r.fils)} · ${r.note} · ${r.category}`),
      h("button", { class: "btn wide", type: "button", onClick: () => { S.money.push({ id: uid(), date: d, type: r.type, fils: r.fils, note: r.note, category: r.category, source: "pasted" }); text.value = ""; commit(); toast(`Added ${aed(r.fils)}`); } }, "Add it"));
  };
  return [
    h("p", { class: "muted" }, "Your iPhone Shortcut saves each SIB SMS (Apple Pay included) to a file. Import it here; payments already in Orbit are skipped. Set-up steps are in Settings."),
    h("button", { class: "btn wide", type: "button", onClick: openScreenshot }, "Read a screenshot"),
    h("label", { class: "btn ghost wide file-btn" }, "Import messages file", file),
    h("details", {}, h("summary", {}, h("span", {}, "Paste one message")), h("div", { class: "inside" }, text, h("button", { class: "btn ghost", type: "button", onClick: read }, "Read it"), out)),
  ];
}

/** Liveforce: this month's and upcoming shifts, like the Earnings page in the Liveforce app. */
function liveforceCard(d, m) {
  const month = S.shifts.filter((x) => inRange(x.date, m));
  const list = S.shifts.filter((x) => x.date >= m[0] || !x.paid).sort((a, b) => a.date.localeCompare(b.date));
  const owed = sum(S.shifts.filter((x) => !x.paid && x.date <= d).map((x) => x.fils));
  return card("Liveforce", month.length ? `${sum(month.map((x) => x.hours))} h this month` : "",
    h("div", { class: "grid3" },
      miniStat("This month", aed(sum(month.map((x) => x.fils)))),
      miniStat("Paid", aed(sum(month.filter((x) => x.paid).map((x) => x.fils)))),
      miniStat("Owed to you", aed(owed))),
    list.length ? h("ul", { class: "list" }, list.map((x) => {
      const upcoming = !x.paid && x.date > d;
      return h("li", {},
        h("span", { class: "grow" }, h("span", {}, x.title || "Shift"), h("br"), h("span", { class: "muted" }, `${fmt(x.date)} · ${x.hours} h · ${aed(x.fils)}`)),
        h("button", { class: `chip ${x.paid ? "paid" : upcoming ? "" : "owed"}`, type: "button", "aria-pressed": String(!!x.paid), "aria-label": `${x.paid ? "Paid" : upcoming ? "Upcoming" : "Not paid"}. Tap to mark as ${x.paid ? "not paid" : "paid"}.`, onClick: () => { x.paid = !x.paid; commit(); } }, x.paid ? "Paid" : upcoming ? "Upcoming" : "Not paid"),
        delButton(`Remove shift on ${fmt(x.date)}`, () => { S.shifts = S.shifts.filter((y) => y !== x); commit(); toast("Shift removed", () => { S.shifts.push(x); commit(); }); }));
    })) : h("p", { class: "muted" }, "Add your shifts, including upcoming ones, to see what you'll earn and what's still owed."),
    shiftForm(d));
}

function shiftForm(d) {
  const title = h("input", { type: "text", placeholder: "Event or job name", maxlength: "80", "aria-label": "Event" });
  const date = h("input", { type: "date", value: d });
  const hours = h("input", { type: "text", inputmode: "decimal", placeholder: "8" });
  const pay = amountInput();
  const paid = h("input", { type: "checkbox" });
  const err = h("p", { class: "err", hidden: true });
  return h("details", {}, h("summary", {}, h("span", {}, "Add a shift")), h("form", { class: "inside", onSubmit: (e) => {
    e.preventDefault();
    const hrs = Number(hours.value.replace(",", "."));
    const fils = readAmount(pay);
    if (!(hrs > 0 && hrs <= 24)) { err.textContent = "Enter the hours (up to 24)."; err.hidden = false; return; }
    if (!fils) { err.textContent = "Enter what the shift pays in AED."; err.hidden = false; return; }
    if (!date.value) { err.textContent = "Pick the shift's date."; err.hidden = false; return; }
    S.shifts.push({ id: uid(), date: date.value, title: title.value.trim() || "Liveforce shift", hours: Math.round(hrs * 4) / 4, fils, paid: paid.checked });
    commit();
  } }, title, h("div", { class: "grid3" }, field("Date", date), field("Hours", hours), field("Pay (AED)", pay)),
    h("label", { class: "check" }, paid, h("span", {}, "Already paid")), err, h("button", { class: "btn wide", type: "submit" }, "Add shift")));
}

function sarwaForm(d) {
  const value = h("input", { type: "text", inputmode: "decimal", placeholder: "Value in USD" , "aria-label": "Portfolio value in USD" });
  const err = h("p", { class: "err", hidden: true });
  return h("form", { class: "field", onSubmit: (e) => {
    e.preventDefault();
    const v = Number(value.value.replace(/,/g, ""));
    if (!(v >= 0 && v < 1e9) || value.value.trim() === "") { err.textContent = "Enter the value in USD, like 3450.20."; err.hidden = false; return; }
    S.sarwa = S.sarwa.filter((x) => x.date !== d); // one value per day: the latest wins
    S.sarwa.push({ id: uid(), date: d, value: Math.round(v * 100) / 100 });
    commit();
  } }, h("div", { class: "inline" }, value, h("button", { class: "btn", type: "submit" }, "Update")), err);
}

// ===== Health =====
let openRoutine = null; // which routine is unfolded, kept across redraws
let editingEx = null; // the exercise being edited
let pickedRoutine = null; // a routine picked for today when none is planned
function viewHealth() {
  const d = today();
  const last7 = [...Array(7)].map((_, i) => addDays(d, -i));
  const newName = h("input", { type: "text", placeholder: "New routine, e.g. Pull", maxlength: "30", "aria-label": "New routine name" });
  return [
    header("Health", fmt(d, { weekday: "long", day: "numeric", month: "long" })),
    todayWorkout(d),
    card("Your routines", S.routines.length ? String(S.routines.length) : "",
      h("p", { class: "muted" }, "Tap a routine to change it. Pick its days and Orbit shows it on Home that day."),
      S.routines.map((r) => routineEditor(r)),
      h("form", { class: "inline", onSubmit: (e) => {
        e.preventDefault();
        const n = newName.value.trim();
        if (!n) return newName.focus();
        const r = { id: uid(), name: n, days: [], exercises: [] };
        S.routines.push(r);
        openRoutine = r.id;
        commit();
      } }, newName, h("button", { class: "btn", type: "submit" }, "Add"))),
    card("Last 7 days", "", h("div", { class: "scroll" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "Day"), h("th", { class: "r" }, "Water"), h("th", { class: "r" }, "Protein"), h("th", { class: "r" }, "Gym"))),
      h("tbody", {}, last7.map((x) => {
        const r = S.days[x] ?? {};
        const w = S.workouts.find((y) => y.date === x && y.done);
        return h("tr", {}, h("td", {}, x === d ? "Today" : fmt(x)),
          h("td", { class: `r ${(r.waterMl ?? 0) >= S.settings.waterMl ? "up" : ""}` }, r.waterMl ? litres(r.waterMl) : "–"),
          h("td", { class: `r ${(r.proteinG ?? 0) >= S.settings.proteinG ? "up" : ""}` }, r.proteinG ? `${r.proteinG} g` : "–"),
          h("td", { class: "r" }, w ? "✓" : "–"));
      }))))),
  ];
}

function todayWorkout(d) {
  let w = S.workouts.find((x) => x.date === d);
  const options = S.routines.filter((r) => r.exercises.length);
  if (!options.length) return card("Today", "", h("p", { class: "muted" }, "Add a routine below to start."));
  const r = (w && S.routines.find((x) => x.id === w.routineId)) || options.find((x) => x.id === pickedRoutine) || todaysRoutines(d)[0];
  const picker = !w || !Object.values(w.sets ?? {}).some((a) => a.some(Boolean))
    ? h("select", { "aria-label": "Routine for today", onChange: (e) => { pickedRoutine = e.target.value || null; if (w) { S.workouts = S.workouts.filter((x) => x !== w); save(); } render(); } },
      h("option", { value: "" }, r ? "Do a different routine…" : "Pick a routine"),
      options.map((o) => h("option", { value: o.id, selected: !!r && r.id === o.id }, o.name)))
    : null;
  if (!r) return card("Today", "Rest day", h("p", { class: "muted" }, "Nothing planned today. Pick a routine to train anyway."), picker);
  const ensure = () => (w ??= (S.workouts.push({ id: uid(), date: d, routineId: r.id, name: r.name, sets: {}, done: false }), S.workouts.at(-1)));
  return card(`Today · ${r.name}`, w?.done ? "Done" : "", picker,
    h("ul", { class: "list" }, r.exercises.map((ex) => {
      const marks = w?.sets?.[ex.id] ?? [];
      return h("li", {}, h("div", { class: "grow field" },
        h("span", {}, h("strong", {}, ex.name), ` · ${exLine(ex)}`),
        h("div", { class: "sets" }, [...Array(ex.sets)].map((_, i) => h("button", { class: "set", type: "button", "aria-pressed": String(!!marks[i]), "aria-label": `${ex.name}, set ${i + 1}`, onClick: () => {
          const rec = ensure();
          const arr = (rec.sets[ex.id] ??= []);
          arr[i] = !arr[i];
          commit();
        } }, String(i + 1))))));
    })),
    w?.done
      ? h("button", { class: "btn ghost wide", type: "button", onClick: () => { w.done = false; commit(); } }, "Mark as not finished")
      : h("button", { class: "btn wide", type: "button", onClick: () => { ensure().done = true; commit(); toast("Workout saved. Well done."); } }, "Finish workout"));
}

function routineEditor(r) {
  const name = h("input", { type: "text", value: r.name, maxlength: "30", "aria-label": "Routine name" });
  // Saved without redrawing, so the next box you tap keeps the focus.
  name.addEventListener("change", () => { if (name.value.trim()) { r.name = name.value.trim(); save(); } });
  const dayLabel = r.days.length ? WEEK_ORDER.filter((x) => r.days.includes(x)).map((x) => DAY_NAMES[x].slice(0, 3)).join(", ") : "no days set";
  return h("details", { open: openRoutine === r.id, onToggle: (e) => { if (e.target.open) openRoutine = r.id; else if (openRoutine === r.id) openRoutine = null; } },
    h("summary", {}, h("span", {}, h("strong", {}, r.name), h("br"), h("span", { class: "muted" }, `${r.exercises.length} exercises · ${dayLabel}`))),
    h("div", { class: "inside" },
      field("Name", name),
      h("div", { class: "field" }, h("span", {}, "Days"), h("div", { class: "days" }, WEEK_ORDER.map((wd) => h("button", { class: "day", type: "button", "aria-pressed": String(r.days.includes(wd)), "aria-label": DAY_NAMES[wd], onClick: () => {
        r.days = r.days.includes(wd) ? r.days.filter((x) => x !== wd) : [...r.days, wd];
        openRoutine = r.id;
        commit();
      } }, DAY_NAMES[wd].slice(0, 2))))),
      r.exercises.length ? h("ul", { class: "list" }, r.exercises.map((ex) => editingEx === ex.id
        ? h("li", { class: "editing" }, exerciseForm(r, ex))
        : h("li", {},
          h("button", { class: "grow ex-btn", type: "button", "aria-label": `Edit ${ex.name}`, onClick: () => { editingEx = ex.id; openRoutine = r.id; render(); } }, h("span", {}, ex.name), h("br"), h("span", { class: "muted" }, exLine(ex))),
          delButton(`Remove ${ex.name}`, () => { const i = r.exercises.indexOf(ex); r.exercises.splice(i, 1); openRoutine = r.id; commit(); toast("Exercise removed", () => { r.exercises.splice(i, 0, ex); commit(); }); })))) : null,
      h("details", {}, h("summary", {}, h("span", {}, "Add an exercise")), h("div", { class: "inside" }, exerciseForm(r, null))),
      confirmButton("Delete routine", () => { S.routines = S.routines.filter((y) => y !== r); commit(); })));
}

/** Add an exercise (ex = null) or edit one. */
function exerciseForm(r, ex) {
  const name = h("input", { type: "text", value: ex?.name ?? "", placeholder: "Exercise, e.g. Bench Press (Barbell)", maxlength: "60", "aria-label": "Exercise name" });
  const sets = h("input", { type: "number", inputmode: "numeric", min: "1", max: "10", value: String(ex?.sets ?? 3), "aria-label": "Sets" });
  const reps = h("input", { type: "number", inputmode: "numeric", min: "1", max: "100", value: String(ex?.reps ?? 10), "aria-label": "Reps" });
  const kg = h("input", { type: "text", inputmode: "decimal", value: ex?.kg ? String(ex.kg) : "", placeholder: "–", "aria-label": "Weight in kg" });
  const note = h("input", { type: "text", value: ex?.note ?? "", placeholder: "Note (optional)", maxlength: "40", "aria-label": "Note" });
  const failure = h("input", { type: "checkbox", checked: !!ex?.failure });
  const err = h("p", { class: "err", hidden: true });
  return h("form", { class: "field", onSubmit: (e) => {
    e.preventDefault();
    const n = name.value.trim(), s = Number(sets.value), rp = Number(reps.value), k = kg.value.trim() === "" ? null : Number(kg.value.replace(",", "."));
    if (!n) { err.textContent = "Name the exercise."; err.hidden = false; return name.focus(); }
    if (!(Number.isInteger(s) && s >= 1 && s <= 10) || (!failure.checked && !(Number.isInteger(rp) && rp >= 1 && rp <= 100))) { err.textContent = "Sets 1–10 and reps 1–100."; err.hidden = false; return; }
    if (k !== null && !(k >= 0 && k <= 500)) { err.textContent = "Weight 0–500 kg, or leave it empty."; err.hidden = false; return; }
    const vals = { name: n, sets: s, reps: rp || 10, kg: k, failure: failure.checked, note: note.value.trim() };
    if (ex) Object.assign(ex, vals); else r.exercises.push({ id: uid(), ...vals });
    editingEx = null;
    openRoutine = r.id;
    commit();
  } }, name, h("div", { class: "grid3" }, field("Sets", sets), field("Reps", reps), field("Kg", kg)), note,
    h("label", { class: "check" }, failure, h("span", {}, "Last set to failure")), err,
    h("div", { class: "inline" }, ex ? h("button", { class: "btn ghost", type: "button", onClick: () => { editingEx = null; render(); } }, "Cancel") : null, h("button", { class: "btn wide", type: "submit" }, ex ? "Save" : "Add exercise")));
}

// ===== Goals =====
function viewGoals() {
  const d = today();
  const title = h("input", { type: "text", placeholder: "A goal, e.g. Pass the DHA exam", maxlength: "80", "aria-label": "Goal" });
  const due = h("input", { type: "date", min: d, "aria-label": "Target date (optional)" });
  return [
    header("Goals", "Big things, in small steps"),
    card("New goal", "", h("form", { class: "field", onSubmit: (e) => {
      e.preventDefault();
      const t = title.value.trim();
      if (!t) return title.focus();
      S.goals.unshift({ id: uid(), title: t, due: due.value || null, steps: [], createdOn: d });
      commit();
    } }, title, field("Target date (optional)", due), h("button", { class: "btn wide", type: "submit" }, "Add goal"))),
    S.goals.length ? S.goals.map((g) => goalCard(g, d)) : h("p", { class: "muted" }, "Add a goal, then break it into steps. Orbit shows how far along you are."),
  ];
}

function goalCard(g, d) {
  const done = g.steps.filter((s) => s.done).length;
  const daysLeft = g.due ? Math.round((Date.parse(g.due) - Date.parse(d)) / 86_400_000) : null;
  return h("section", { class: "card" },
    h("div", { class: "row" }, h("h2", {}, g.title), h("span", { class: daysLeft !== null && daysLeft < 0 ? "down" : "muted" }, g.due ? (daysLeft < 0 ? `${-daysLeft} days late` : daysLeft === 0 ? "Due today" : `${daysLeft} days left`) : "")),
    bar(done, g.steps.length),
    h("p", { class: "muted" }, g.steps.length ? `${done} of ${g.steps.length} steps done` : "Add the steps to get there."),
    g.steps.length ? h("ul", { class: "list" }, g.steps.map((s) => h("li", { class: s.done ? "done" : "" },
      h("label", { class: "check" }, h("input", { type: "checkbox", checked: s.done, onChange: (e) => { s.done = e.target.checked; commit(); } }), h("span", {}, s.text)),
      delButton(`Remove step ${s.text}`, () => { g.steps = g.steps.filter((y) => y !== s); commit(); })))) : null,
    addForm("New step", "Next step", (text) => { g.steps.push({ id: uid(), text, done: false }); commit(); }),
    confirmButton("Delete goal", () => { S.goals = S.goals.filter((y) => y !== g); commit(); }));
}

// ===== Sheets: report, settings =====
function openSheet(title, fill) {
  sheetFill = () => sheet.replaceChildren(
    h("div", { class: "sheet-head" }, h("h2", { id: "sheet-title" }, title), h("button", { class: "x", type: "button", "aria-label": "Close", onClick: () => sheet.close() }, "×")),
    h("div", { class: "sheet-body" }, fill()));
  sheetFill();
  if (!sheet.open) sheet.showModal();
}
sheet.addEventListener("close", () => { sheetFill = null; render(); });

// ===== Read a screenshot: read on the phone → you check and edit → save =====
const KIND_TITLE = { money: "Payment", phone: "Phone time", sarwa: "Sarwa value", shift: "Liveforce shift" };

function alreadyIn(it) {
  if (it.kind === "money") return S.money.some((m) => m.date === it.date && m.fils === it.fils);
  if (it.kind === "shift") return S.shifts.some((x) => x.date === it.date && x.fils === it.fils);
  if (it.kind === "sarwa") return S.sarwa.some((x) => x.date === it.date && x.value === it.usd);
  return S.days[it.date]?.phoneMin === it.minutes;
}

/** One found item as an editable row. read() returns the checked values or throws a message. */
function itemEditor(it, d) {
  const keep = h("input", { type: "checkbox", checked: !alreadyIn(it), "aria-label": `Save this ${KIND_TITLE[it.kind].toLowerCase()}` });
  const date = h("input", { type: "date", value: it.date, "aria-label": "Date" });
  const head = h("label", { class: "check" }, keep, h("span", {}, h("strong", {}, KIND_TITLE[it.kind]), alreadyIn(it) ? h("span", { class: "muted" }, " · already in Orbit") : null));
  let fieldsEl, read;
  if (it.kind === "money") {
    const amount = h("input", { type: "text", inputmode: "decimal", value: (it.fils / 100).toFixed(2), "aria-label": "Amount in AED" });
    const note = h("input", { type: "text", value: it.note, maxlength: "60", "aria-label": "What for" });
    const cats = it.type === "income" ? INCOME_CATS : SPEND_CATS;
    const cat = h("select", { "aria-label": "Category" }, [...new Set([it.category, ...cats])].map((c) => h("option", { selected: c === it.category }, c)));
    fieldsEl = [h("div", { class: "grid2" }, field("Date", date), field(it.type === "income" ? "Received (AED)" : "Spent (AED)", amount)), h("div", { class: "grid2" }, field("Note", note), field("Category", cat))];
    read = () => { const fils = toFils(amount.value.trim()); if (!fils) throw new Error("Check the amount."); return { ...it, date: date.value, fils, note: note.value.trim(), category: cat.value }; };
  } else if (it.kind === "phone") {
    const hh = h("input", { type: "number", inputmode: "numeric", value: String(Math.floor(it.minutes / 60)), "aria-label": "Hours" });
    const mm = h("input", { type: "number", inputmode: "numeric", value: String(it.minutes % 60), "aria-label": "Minutes" });
    fieldsEl = [h("div", { class: "grid3" }, field("Day", date), field("Hours", hh), field("Minutes", mm))];
    read = () => { const m = Number(hh.value) * 60 + Number(mm.value); if (!(Number.isInteger(m) && m >= 0 && m <= 1440)) throw new Error("Check the phone time."); return { ...it, date: date.value, minutes: m }; };
  } else if (it.kind === "sarwa") {
    const usd = h("input", { type: "text", inputmode: "decimal", value: String(it.usd), "aria-label": "Value in USD" });
    fieldsEl = [h("div", { class: "grid2" }, field("Date", date), field("Value (USD)", usd))];
    read = () => { const v = Number(usd.value.replace(/,/g, "")); if (!(v >= 0 && v < 1e9)) throw new Error("Check the Sarwa value."); return { ...it, date: date.value, usd: Math.round(v * 100) / 100 }; };
  } else {
    const title = h("input", { type: "text", value: it.title, maxlength: "80", "aria-label": "Event" });
    const hours = h("input", { type: "text", inputmode: "decimal", value: String(it.hours), "aria-label": "Hours" });
    const pay = h("input", { type: "text", inputmode: "decimal", value: (it.fils / 100).toFixed(2), "aria-label": "Pay in AED" });
    const paid = h("input", { type: "checkbox", checked: it.paid });
    fieldsEl = [title, h("div", { class: "grid3" }, field("Date", date), field("Hours", hours), field("Pay (AED)", pay)), h("label", { class: "check" }, paid, h("span", {}, "Paid"))];
    read = () => { const fils = toFils(pay.value.trim()), hrs = Number(hours.value); if (!fils || !(hrs > 0 && hrs <= 24)) throw new Error("Check the shift's hours and pay."); return { ...it, title: title.value.trim() || "Liveforce shift", date: date.value, hours: hrs, fils, paid: paid.checked }; };
  }
  const node = h("li", { class: "found" }, head, ...fieldsEl);
  return { node, read: () => (keep.checked ? (/^\d{4}-\d{2}-\d{2}$/.test(date.value) ? read() : (() => { throw new Error("Check the date."); })()) : null) };
}

function saveFound(list) {
  for (const it of list) {
    if (it.kind === "money") S.money.push({ id: uid(), date: it.date, type: it.type, fils: it.fils, note: it.note, category: it.category, source: "screenshot" });
    else if (it.kind === "phone") dayRec(it.date).phoneMin = it.minutes;
    else if (it.kind === "sarwa") { S.sarwa = S.sarwa.filter((x) => x.date !== it.date); S.sarwa.push({ id: uid(), date: it.date, value: it.usd }); }
    else S.shifts.push({ id: uid(), date: it.date, title: it.title, hours: it.hours, fils: it.fils, paid: it.paid });
  }
}

function openScreenshot() {
  const d = today();
  const status = h("p", { class: "muted", role: "status" }, "Works with bank SMS (SIB), Screen Time or Battery, Sarwa, and Liveforce earnings. Orbit reads it on this phone; nothing is sent anywhere.");
  const results = h("div", { class: "field" });
  const pick = h("input", { type: "file", accept: "image/*", multiple: true, "aria-label": "Choose screenshots" });
  pick.addEventListener("change", async () => {
    const files = [...(pick.files ?? [])].slice(0, 10);
    pick.value = "";
    if (!files.length) return;
    results.replaceChildren();
    const found = [];
    const texts = [];
    try {
      for (const [i, f] of files.entries()) {
        const which = files.length > 1 ? ` ${i + 1} of ${files.length}` : "";
        status.textContent = `Reading screenshot${which}…`;
        const text = await readText(f, (m) => {
          if (m.status === "recognizing text") status.textContent = `Reading screenshot${which}… ${Math.round(m.progress * 100)}%`;
          else if (/loading|initializ/i.test(m.status)) status.textContent = "Getting the reader ready. The first time takes a minute (about 7 MB), then it works offline.";
        });
        texts.push(text);
        found.push(...readScreenshot(text, d).items);
      }
    } catch (e) {
      status.textContent = e.message || "Orbit couldn't read that picture. Try again.";
      return;
    }
    const readBack = h("details", {}, h("summary", {}, h("span", { class: "muted" }, "Text Orbit read")), h("pre", { class: "ocr" }, texts.join("\n\n---\n\n")));
    if (!found.length) {
      status.textContent = "Orbit couldn't find a payment, phone time, Sarwa value or shift in that. Check it's one of those screens, or add it by hand.";
      results.replaceChildren(readBack);
      return;
    }
    const editors = found.map((it) => itemEditor(it, d));
    const err = h("p", { class: "err", hidden: true });
    status.textContent = `Found ${found.length}. Check each one, fix anything that's wrong, then save.`;
    results.replaceChildren(
      h("ul", { class: "list" }, editors.map((e) => e.node)), err,
      h("button", { class: "btn wide", type: "button", onClick: () => {
        let list;
        try { list = editors.map((e) => e.read()).filter(Boolean); } catch (e) { err.textContent = e.message; err.hidden = false; return; }
        if (!list.length) { err.textContent = "Tick at least one to save."; err.hidden = false; return; }
        const before = JSON.stringify(S);
        saveFound(list);
        sheet.close();
        commit();
        toast(`Saved ${list.length}`, () => { S = normalize(JSON.parse(before)); commit(); });
      } }, "Save"),
      readBack);
  });
  openSheet("Read a screenshot", () => [status, h("label", { class: "btn wide file-btn" }, "Choose screenshots", pick), results]);
}

function openReport(kind) {
  const show = (row, v) => (v === null ? "–" : row.minutes ? hm(v) : row.fils ? aed(v) : String(v));
  openSheet("Your report", () => {
    const r = report(S, kind, today());
    const better = r.rows.filter((x) => x.better === true).length;
    const worse = r.rows.filter((x) => x.better === false).length;
    const word = kind === "week" ? "week" : "month";
    return [
      h("div", { class: "seg", role: "radiogroup", "aria-label": "Report period" },
        h("label", {}, h("input", { type: "radio", name: "period", checked: kind === "week", onChange: () => openReport("week") }), h("span", {}, "This week")),
        h("label", {}, h("input", { type: "radio", name: "period", checked: kind === "month", onChange: () => openReport("month") }), h("span", {}, "This month"))),
      h("p", { class: "muted" }, `${fmt(r.range[0], { day: "numeric", month: "short" })} – ${fmt(r.range[1], { day: "numeric", month: "short" })}, compared with last ${word}. ${better || worse ? `Better in ${better}, worse in ${worse}.` : "Keep adding your days to see the change."}`),
      h("div", { class: "scroll" }, h("table", {},
        h("thead", {}, h("tr", {}, h("th", {}, ""), h("th", { class: "r" }, `This ${word}`), h("th", { class: "r" }, `Last ${word}`), h("th", { class: "r" }, ""))),
        h("tbody", {}, r.rows.map((row) => h("tr", {}, h("td", {}, row.label), h("td", { class: "r" }, show(row, row.now)), h("td", { class: "r muted" }, show(row, row.before)),
          h("td", { class: `r ${row.better === true ? "up" : row.better === false ? "down" : "muted"}`, "aria-label": row.better === true ? "better" : row.better === false ? "worse" : "no change" }, row.better === true ? "▲" : row.better === false ? "▼" : "·")))))),
      h("p", { class: "muted" }, `Phone time counts the days you entered it. Spending is per day, so a ${word} in progress compares fairly.`),
    ];
  });
}

function openSettings() {
  openSheet("Settings", () => {
    const water = h("input", { type: "number", inputmode: "decimal", min: "0.5", max: "8", step: "0.25", value: String(S.settings.waterMl / 1000) });
    const protein = h("input", { type: "number", inputmode: "numeric", min: "10", max: "500", step: "5", value: String(S.settings.proteinG) });
    const err = h("p", { class: "err", hidden: true });
    const restore = h("input", { type: "file", accept: ".json,application/json", "aria-label": "Choose a backup file" });
    const restoreOut = h("div", { class: "field" });
    restore.addEventListener("change", () => {
      const f = restore.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        let next;
        try { next = normalize(JSON.parse(String(reader.result))); } catch (e) { return restoreOut.replaceChildren(h("p", { class: "err" }, e instanceof SyntaxError ? "That file isn't an Orbit backup." : e.message)); }
        restoreOut.replaceChildren(
          h("p", {}, `This backup has ${next.money.length} money items, ${next.tasks.length} tasks, ${next.goals.length} goals and ${Object.keys(next.days).length} tracked days. It replaces everything in Orbit now.`),
          confirmButton("Replace with this backup", () => { S = next; sheet.close(); commit(); toast("Backup restored"); }));
      };
      reader.readAsText(f);
    });
    const typed = h("input", { type: "text", placeholder: "Type DELETE", autocomplete: "off", "aria-label": "Type DELETE to confirm" });
    const pasted = h("textarea", { placeholder: "Paste the text Claude gave you", "aria-label": "Text from Claude" });
    const pasteErr = h("p", { class: "err", hidden: true });
    return [
      h("section", {}, h("h3", {}, "Add from Claude"),
        h("p", { class: "muted" }, "When Claude reads your screenshots, it gives you a block of text. Copy it, paste it here and tap Add. Anything already in Orbit is skipped."),
        pasted, pasteErr,
        h("button", { class: "btn wide", type: "button", onClick: () => {
          const before = JSON.stringify(S);
          let r;
          try { r = mergeImport(S, pasted.value.trim()); } catch (e) { pasteErr.textContent = e.message; pasteErr.hidden = false; return; }
          const parts = [["routines", "routine"], ["habits", "habit"], ["shifts", "shift"], ["money", "money item"], ["sarwa", "Sarwa value"]].filter(([k]) => r[k]).map(([k, w]) => `${r[k]} ${w}${r[k] === 1 ? "" : "s"}`);
          sheet.close();
          commit();
          toast(parts.length ? `Added ${parts.join(", ")}` : "Everything was already in Orbit", parts.length ? () => { S = normalize(JSON.parse(before)); commit(); } : null);
        } }, "Add to Orbit")),

      h("section", {}, h("h3", {}, "Daily targets"),
        h("form", { class: "field", onSubmit: (e) => {
          e.preventDefault();
          const w = Number(water.value), p = Number(protein.value);
          if (!(w >= 0.5 && w <= 8) || !(p >= 10 && p <= 500)) { err.textContent = "Water 0.5–8 litres, protein 10–500 g."; err.hidden = false; return; }
          S.settings.waterMl = Math.round(w * 4) * 250;
          S.settings.proteinG = Math.round(p);
          commit();
          toast("Targets saved");
        } }, h("div", { class: "grid2" }, field("Water (litres)", water), field("Protein (g)", protein)),
          h("p", { class: "muted" }, "Protein: 1.6–2.0 g per kg of body weight a day is the usual range for people who lift. Multiply your weight by 1.6 and by 2.0 to get your range."), err,
          h("button", { class: "btn wide", type: "submit" }, "Save targets"))),

      h("section", {}, h("h3", {}, "Bank SMS and Apple Pay"),
        h("p", { class: "muted" }, "A free iPhone Shortcut copies each payment into one file. Orbit reads that file when you tap Import in Money. Your messages never leave your phone."),
        h("ol", { class: "steps" },
          h("li", {}, "Open Shortcuts → Automation → + → Message. Sender: SIB. Message Contains: AED. Choose Run Immediately, then Next → New Blank Automation."),
          h("li", {}, "Add the action Append to Text File. Text: ", h("code", {}, "=== "), "Current Date", h("code", {}, " | SIB"), ", a new line, then Shortcut Input. Set Current Date's format to ISO 8601. File Path: ", h("code", {}, "Orbit inbox.txt"), ". Make New Line: on."),
          h("li", {}, "Apple Pay with your SIB card already sends an SMS, so it's covered. Don't add a separate Apple Pay automation, or payments count twice."),
          h("li", {}, "In Orbit → Money → Import messages file → iCloud Drive → Shortcuts → Orbit inbox.txt. Import as often as you like; nothing is added twice."))),

      h("section", {}, h("h3", {}, "Backup"),
        h("p", { class: "muted" }, S.lastBackup ? `Last saved ${fmt(S.lastBackup, { day: "numeric", month: "long" })}.` : "No backup yet. Save one to iCloud Drive or Files every week or two."),
        h("button", { class: "btn wide", type: "button", onClick: saveBackup }, "Save backup"),
        h("label", { class: "btn ghost wide file-btn" }, "Restore from a backup", restore), restoreOut),

      h("section", {}, h("h3", {}, "Privacy"),
        h("p", { class: "muted" }, "Everything is stored only in Orbit on this iPhone. Orbit has no account, no server and makes no internet connections with your data. Anyone who can unlock your phone can open Orbit, so keep a passcode or Face ID on.")),

      h("section", {}, h("h3", {}, "Delete everything"),
        h("p", { class: "muted" }, "Removes all your Orbit data from this phone. Save a backup first if you might want it back."),
        h("div", { class: "inline" }, typed, h("button", { class: "btn danger", type: "button", onClick: () => {
          if (typed.value.trim() !== "DELETE") { typed.focus(); return toast("Type DELETE to confirm."); }
          S = emptyState();
          sheet.close();
          commit();
          toast("All Orbit data deleted from this phone");
        } }, "Delete"))),
    ];
  });
}

async function saveBackup() {
  const name = `orbit-backup-${today()}.json`;
  const json = JSON.stringify({ ...S, lastBackup: today() });
  const file = new File([json], name, { type: "application/json" });
  const done = () => { S.lastBackup = today(); commit(); toast("Backup saved"); };
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return done(); } catch (e) { if (e?.name === "AbortError") return; }
  }
  const url = URL.createObjectURL(file);
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  done();
}

render();
