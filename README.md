# WMTTools

One userscript that adds features to WMT Scheduler. Each feature can be turned on or off. It runs in [Violentmonkey](https://violentmonkey.github.io/) (recommended) and also works in Tampermonkey.

| Feature | Page | What it does |
|---|---|---|
| Next payday | Worksheet View | Next payday, the pay period it covers, and a countdown. Worked out from the every-other-Tuesday pay schedule, so it never needs yearly updates. |
| Hide Print button | Worksheet View | Hides the Print button next to the date. |
| Mobile layout | Worksheet View | On phones: opens fitted to the screen, a clean header with button-style menu, the 14 days in two rows, and the tables in one column in the order you choose. Desktop is unchanged. |
| Highlight my initials | Worksheet View | Your initials in bold, and rows that include you shaded green. |
| Schedule View helper | Schedule View | Highlights your row, days off and leave, and who else is off on those days. Adds an "Off with me" summary. |
| Favorite co-workers | Every page | Shows the initials of people you choose in their own color (red by default). |
| Calendar export | My Schedule | Preview your pay period and download it as `.ics` (Google, Outlook, Apple) or `.csv`. |
| Auto sign-in | Sign-in pages | Off by default. Clicks through the warning page and fills in the sign-in. |

## [Install](https://raw.githubusercontent.com/blakskyy/WMTTools/main/WMTTools.user.js)

1. Install the [Violentmonkey](https://violentmonkey.github.io/get-it/) browser extension (Chrome, Edge or Firefox).
2. Open the raw `WMTTools.user.js` link. Violentmonkey shows an install page; click **Install**.
3. Open WMT and click **WMTTools** in the top menu bar (or click the Violentmonkey icon → **WMTTools settings**).
4. Enter your initials, turn features on or off, and click **Save and reload**.

Settings are saved in Violentmonkey, not in the script, so updates never erase them.

If you used the older stand-alone WMT scripts, turn them off in the Violentmonkey (or Tampermonkey) dashboard so nothing runs twice.

Optional: open **Views → Shift Legend** once. The calendar export then uses your area's exact shift times.

### Auto sign-in

Turn it on in settings and enter your sign-in email and password. They're saved in Violentmonkey's storage on your computer, unencrypted. Only use it on a computer you alone use.

It clicks **Login** on the WMT warning page, then handles each MyAccess sign-in step as it appears:

1. **Sign in using MyAccess:** enters your email and clicks **Next**. (Skipped when MyAccess remembers you.)
2. **Verify it's you with a security method:** clicks **Select** next to **Password**. (Only shows up sometimes.)
3. **Verify with your password:** enters your password and clicks **Verify**.

It never tries a password twice. If the sign-in page shows an error ("Password is incorrect", a locked account, ...), or the password page comes back within 2 minutes of a try, it stops and shows a message, so a wrong password can't lock your account. Any other step, like a PIV card or a code, is left for you to finish.

## Phones and tablets

Phone browsers like Chrome and regular Safari can't run userscripts. You need a browser or app that can. WMT itself shows its desktop page on a phone. The **Mobile layout** feature (on by default) fits Worksheet View to the screen; other pages still need some pinching and zooming. Your settings don't sync from your computer, so enter them again on each device.

### Android: Firefox + Violentmonkey

1. Install **Firefox** from the Play Store.
2. In Firefox, open the menu (**⋮**) → **Extensions** (or **Add-ons**), find **Violentmonkey**, and tap **Add**.
3. Open the raw `WMTTools.user.js` link in Firefox. Violentmonkey opens its install page; tap **Install**.
4. Open WMT in Firefox and tap **WMTTools** in the menu bar to set your initials.

Updates arrive automatically, the same as on a computer.

### iPhone / iPad: a Safari userscript app

Violentmonkey isn't available on iOS, so use one of these Safari extensions from the App Store. Each works through Safari, so use Safari for WMT.

- **Tampermonkey**: supports everything this script uses. Recommended.
- **Stay**: free alternative.
- **Macaque**: another alternative.

1. Install the app from the App Store.
2. Turn it on: **Settings → Apps → Safari → Extensions** (on older iOS, **Settings → Safari → Extensions**). Turn the extension on and set **wmtscheduler.faa.gov** and **workforce.faa.gov** to **Allow**, or allow all websites.
3. Open the raw `WMTTools.user.js` link in Safari. Tap the extension's icon in the address bar (the puzzle piece or **AA** button) and install the script. If no install prompt appears, copy the script's address and add it from inside the app (most have **Add from URL**).
4. Open WMT in Safari and tap **WMTTools** in the menu bar to set your initials.

Only the Tampermonkey version has been confirmed to support everything here. If a feature misbehaves in Stay or Macaque, try Tampermonkey.

### On a phone

- **Calendar export:** tapping **Download .ics** saves a file. On iPhone, Safari usually offers to add the events to Calendar. On Android, open the download from Firefox's **Downloads**. If your calendar app won't open it, import the file on a computer instead (Google Calendar: **Settings → Import & export**).
- **Settings:** if the **WMTTools** link is hard to reach, use the extension's menu instead (Violentmonkey icon, or the extension button in Safari) → **WMTTools settings**.
- **Auto sign-in:** stores your password on that phone. Only turn it on for a phone that has a passcode and that only you use.

## Updates

Violentmonkey checks for updates automatically. To check right away, open its dashboard and click the update button on WMTTools. An update installs only when the `@version` number goes up.