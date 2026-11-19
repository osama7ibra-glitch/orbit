// Run with: node --test projects/orbit/tests/logic.test.mjs  (sample data only)
import test from "node:test";
import assert from "node:assert/strict";
import { addDays, emptyState, importMessages, mergeImport, messageDay, monthRange, normalize, readPasted, readScreenshot, report, todayKey, weekRange } from "../logic.js";

const SIB = `A/C: 00999XXX12345 Purchase
Txn. AED 12.50. at Sample Cafe LLC Br Ajman.Available Balance is
AED +1,234.56.`;

test("dates: Dubai day, Monday weeks, months", () => {
  assert.equal(todayKey(new Date("2026-11-19T21:30:00Z")), "2026-11-20"); // 01:30 in Dubai
  assert.deepEqual(weekRange("2026-11-19"), ["2026-11-16", "2026-11-22"]);
  assert.deepEqual(weekRange("2026-11-16"), ["2026-11-16", "2026-11-22"]);
  assert.deepEqual(monthRange("2026-02-10"), ["2026-02-01", "2026-02-28"]);
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});

test("bank SMS file: reads payments once, drops codes, hides the balance", () => {
  const seen = {};
  const file = `=== 2026-11-18 | SIB\n${SIB}\n=== 2026-11-18 | SIB\nYour OTP is 123456. Do not share.\n=== 2026-11-19 | Apple Pay\nPurchase of AED 45.50 at ENOC\n`;
  const r = importMessages(file, seen, "2026-11-19");
  assert.equal(r.added, 2);
  assert.equal(r.skipped, 1);
  assert.deepEqual(r.entries.map((e) => [e.date, e.type, e.fils, e.note, e.category]), [
    ["2026-11-18", "expense", 1250, "Sample Cafe LLC Br Ajman", "Food"],
    ["2026-11-19", "expense", 4550, "ENOC", "Transport"],
  ]);
  assert.ok(!r.entries[0].text.includes("1,234.56"));
  const again = importMessages(file, seen, "2026-11-19");
  assert.equal(again.added, 0);
  assert.equal(again.already, 2);
});

test("SIB wording: purchases and transfers (sample numbers)", () => {
  const buy = readPasted("A/C: 00123XXX99999 Purchase\nTxn. AED 73.50. at D100-SAMPLE CAFE AB-CD\nDXB.Available Balance is AED\n+1,111.11.");
  assert.deepEqual([buy.type, buy.fils, buy.note, buy.category], ["expense", 7350, "D100-SAMPLE CAFE AB-CD DXB", "Food"]);
  const sweets = readPasted("A/C: 00123XXX99999 Purchase Txn. AED 22.50. at SAMPLE SWEETS SHARJAH.Available Balance is AED +1,000.00.");
  assert.deepEqual([sweets.fils, sweets.category], [2250, "Food"]);
  const sent = readPasted("Your transfer of AED 20.00 to Sample Person, sent on 17-Nov-26, has been processed.");
  assert.deepEqual([sent.type, sent.fils, sent.note, sent.category], ["expense", 2000, "Transfer to Sample Person", "Transfer"]);
  assert.match(readPasted("Dear Customer, your information has been updated with Sharjah Islamic Bank.").error, /No AED amount/);
});

test("paste from Claude adds once; old weekday plans become routines", () => {
  const s = emptyState();
  const text = JSON.stringify({
    orbit: "import",
    routines: [{ name: "Pull", exercises: [{ name: "Lat Pulldown", sets: 2, reps: 10, kg: 80 }, { name: "Pull Up (Assisted)", sets: 2, reps: 10 }] }],
    habits: [{ name: "Brush teeth", emoji: "🪥", perDay: 3 }],
    shifts: [{ date: "2026-12-08", title: "Sample event", hours: 9, aed: 585, paid: false }],
    money: [{ date: "2026-11-18", type: "expense", aed: 22.5, note: "Sweets", category: "Food" }],
    sarwa: [{ date: "2026-11-19", usd: 2000.5 }],
  });
  assert.deepEqual(mergeImport(s, text), { routines: 1, habits: 1, shifts: 1, money: 1, sarwa: 1 });
  assert.deepEqual(mergeImport(s, text), { routines: 0, habits: 0, shifts: 0, money: 0, sarwa: 0 });
  assert.equal(s.routines[0].exercises[1].kg, null);
  assert.equal(s.shifts[0].fils, 58500);
  assert.throws(() => mergeImport(s, "{\"orbit\":\"import\""), /isn't complete/);
  const old = normalize({ v: 1, plan: { 4: { name: "Push", exercises: [{ id: "e", name: "Bench", sets: 3, reps: 8 }] } } });
  assert.deepEqual([old.routines[0].name, old.routines[0].days], ["Push", [4]]);
});

test("screenshots: bank SMS, phone time, Sarwa, Liveforce (sample text)", () => {
  const today = "2026-11-19"; // a Thursday
  const sms = readScreenshot(`SIB
Tue 4:30 PM
Your transfer of AED 20.00 to Sample Person, sent on 17-Nov-26, has been processed.
Yesterday 8:08 PM
A/C: 00123XXX99999 Purchase
Txn. AED 73.50. at D100-SAMPLE
CAFE DXB.Available Balance is AED
+1,000.00.
Yesterday 9:22 PM
A/C: 00123XXX99999 Purchase
Txn. AED 22.50. at SAMPLE SWEETS
SHARJAH.Available Balance is AED
+977.50.
Text Message • SMS`, today);
  assert.equal(sms.kind, "sms");
  assert.deepEqual(sms.items.map((x) => [x.date, x.fils, x.note, x.category]), [
    ["2026-11-17", 2000, "Transfer to Sample Person", "Transfer"],
    ["2026-11-18", 7350, "D100-SAMPLE CAFE DXB", "Food"],
    ["2026-11-18", 2250, "SAMPLE SWEETS SHARJAH", "Food"],
  ]);
  assert.deepEqual(readScreenshot("Screen Time\nYesterday\n4h 10m\nDaily Average", today).items, [{ kind: "phone", date: "2026-11-18", minutes: 250 }]);
  assert.deepEqual(readScreenshot("Trade\nSummary\nAccount Balance\n$1,234.56\nTotal Return\n$50.00 (4.2%)", today).items, [{ kind: "sarwa", date: today, usd: 1234.56 }]);
  const lf = readScreenshot(`Earnings
NOVEMBER 2026 ESTIMATED EARNINGS
Sample Event - Morning shift
(Promoter/ Sales)
21-11-2026 | 7:00am-3:00pm (8 hrs)
Salary | UPCOMING 360.00 DH
Sample Expo
09-12-2026 | 9:00am-6:00pm (9 hrs)
Salary | PAID 1 585.00 DH`, today);
  assert.equal(lf.kind, "liveforce");
  assert.deepEqual(lf.items.map((x) => [x.date, x.title, x.hours, x.fils, x.paid]), [
    ["2026-11-21", "Sample Event - Morning shift", 8, 36000, false],
    ["2026-12-09", "Sample Expo", 9, 158500, true],
  ]);
  assert.equal(messageDay("17 Nov", today), "2026-11-17");
  assert.equal(messageDay("Dec 30", today), "2025-12-30"); // a later date this year means last year
  assert.equal(readScreenshot("A random photo with no numbers", today).kind, null);
});

test("pasted message", () => {
  assert.equal(readPasted(SIB).fils, 1250);
  assert.match(readPasted("Your verification code is 4421").error, /one-time code/);
  assert.match(readPasted("Purchase of USD 12.99 at STEAM").error, /USD 12.99/);
});

test("backup check refuses other files and fills in missing parts", () => {
  assert.throws(() => normalize({ hello: 1 }), /isn't an Orbit backup/);
  assert.throws(() => normalize({ v: 1, money: "x" }), /damaged/);
  const s = normalize({ v: 1, money: [{ id: "a", date: "2026-11-01", type: "expense", fils: 100 }], settings: { waterMl: -5 } });
  assert.equal(s.money.length, 1);
  assert.equal(s.settings.waterMl, 3000);
  assert.deepEqual(s.goals, []);
});

test("week report compares with last week; lower phone time is better", () => {
  const s = emptyState();
  s.days["2026-11-10"] = { waterMl: 3000, phoneMin: 300 };
  s.days["2026-11-17"] = { waterMl: 3000, phoneMin: 200 };
  s.days["2026-11-18"] = { waterMl: 3250, phoneMin: 240 };
  s.workouts.push({ id: "w1", date: "2026-11-17", done: true });
  s.money.push({ id: "m1", date: "2026-11-18", type: "expense", fils: 9000 }, { id: "m2", date: "2026-11-18", type: "income", fils: 50000 });
  const r = report(s, "week", "2026-11-19");
  const row = (k) => r.rows.find((x) => x.key === k);
  assert.equal(r.cur.days, 4); // Monday to Thursday so far
  assert.equal(row("water").now, "2 of 4");
  assert.equal(row("phone").now, 220);
  assert.equal(row("phone").better, true);
  assert.equal(row("workouts").better, true);
  assert.equal(r.cur.spentFils, 9000); // income isn't spending
  delete s.days["2026-11-10"]; // first week in Orbit: nothing to compare with
  assert.ok(report(s, "week", "2026-11-19").rows.every((x) => x.better === null));
});
