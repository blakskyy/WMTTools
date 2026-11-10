# WMTTools

One userscript that adds features to WMT Scheduler. Each feature can be turned on or off. It runs in [Violentmonkey](https://violentmonkey.github.io/) (recommended) and also works in Tampermonkey.

| Feature | Page | What it does |
|---|---|---|
| Next payday | Worksheet View | Next payday, the pay period it covers, and a countdown. Worked out from the every-other-Tuesday pay schedule, so it never needs yearly updates. |
| Hide Print button | Worksheet View | Hides the Print button next to the date. |
| Highlight my initials | Worksheet View | Your initials in bold, and rows that include you shaded green. |
| Schedule View helper | Schedule View | Highlights your row, days off and leave, and who else is off on those days. Adds an "Off with me" summary. |
| Favorite co-workers | Every page | Shows the initials of people you choose in their own color (red by default). |
| Calendar export | My Schedule | Preview your pay period and download it as `.ics` (Google, Outlook, Apple) or `.csv`. |
| Auto sign-in | Sign-in pages | Off by default. Clicks through the warning page and fills in the sign-in. |

## Install

1. Install the [Violentmonkey](https://violentmonkey.github.io/get-it/) browser extension (Chrome, Edge or Firefox).
2. Open the raw `WMTTools.user.js` link. Violentmonkey shows an install page; click **Install**.
3. Open WMT and click **WMTTools** in the top menu bar (or click the Violentmonkey icon → **WMTTools settings**).
4. Enter your initials, turn features on or off, and click **Save and reload**.

Settings are saved in Violentmonkey, not in the script, so updates never erase them.

If you used the older stand-alone WMT scripts, turn them off in the Violentmonkey (or Tampermonkey) dashboard so nothing runs twice.

Optional: open **Views → Shift Legend** once. The calendar export then uses your area's exact shift times.

### Auto sign-in

Turn it on in settings and enter your sign-in email and password. They're saved in Violentmonkey's storage on your computer, unencrypted. Only use it on a computer you alone use. If the password page returns right after a submit, it stops trying, so a wrong password can't lock your account.

## Updates

Violentmonkey checks for updates automatically. To check right away, open its dashboard and click the update button on WMTTools. An update installs only when the `@version` number goes up.