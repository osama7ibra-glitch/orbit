# Orbit

Your day, money, health and goals in one iPhone app. Free, no account, no server: everything you add is saved only in Orbit on your phone.

Tabs: **Home** (camera button: read a screenshot; what to finish today, water, protein, today's workout, spent today, phone time, this week), **Money** (spending, bank SMS and Apple Pay import, Liveforce shifts, Sarwa value), **Health** (weekly gym plan, today's sets, last 7 days), **Goals** (goals broken into steps). The week and month report is on Home.

## Put it on your iPhone

1. Open the Orbit link in **Safari**.
2. Tap **Share**, then **Add to Home Screen**, then **Add**.
3. Always open Orbit from that icon. What you add in Safari itself stays in Safari, separate from the Home Screen app.

It works without internet once opened, and it updates itself the next time you open it while online.

## Keep your data safe

Settings (gear on Home) → **Save backup** every week or two, into iCloud Drive or Files. To move to a new phone: install Orbit, then Settings → **Restore from a backup**.

## Bank SMS and Apple Pay

A free iPhone Shortcut appends each SIB SMS (Apple Pay payments included) to `Orbit inbox.txt` in iCloud Drive → Shortcuts; Money → **Import messages file** reads it. No separate Apple Pay automation: it would count payments twice. Already-imported payments are skipped. The exact steps are in Settings.

## For Claude / developers

Plain HTML, CSS and JavaScript, no build step and no outside requests. `logic.js` and `bank.js` hold the rules; `app.js` the screens; `sw.js` the offline copy; `ocr.js` + `vendor/tesseract` read screenshots on the phone (Tesseract.js, Apache-2.0). Tests: `node --test projects/orbit/tests/logic.test.mjs`. Local preview: the `orbit` entry in `.claude/launch.json` (port 5180). `home-preview.html` is the early Home preview published as a Claude artifact; it isn't part of the app.
