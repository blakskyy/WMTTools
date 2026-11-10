// ==UserScript==
// @name         WMTTools
// @namespace    https://3datc.com
// @version      2026.11.10.4
// @description  Add-ons for WMT Scheduler: next payday, your initials highlighted, Schedule View days-off helper, calendar export (.ics / .csv), and optional auto sign-in.
// @author       3dATC|BLAksky
// @match        https://wmtscheduler.faa.gov/*
// @match        https://workforce.faa.gov/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=faa.gov
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/blakskyy/WMTTools/main/WMTTools.user.js
// @downloadURL  https://raw.githubusercontent.com/blakskyy/WMTTools/main/WMTTools.user.js
// ==/UserScript==

/*
 * HOW THIS FILE IS ORGANIZED
 *
 *   1. CORE      storage, settings, page matching, module runner
 *   2. UI        shared helpers: notices, settings panel, WMT menu link
 *   3. MODULES   one block per feature, each a self-contained defineModule({...})
 *   4. START
 *
 * Nobody needs to edit this file. Every setting lives in the settings panel
 * (the "WMTTools" link in the WMT menu bar, or the userscript manager's menu >
 * WMTTools settings). Settings are kept in the manager's storage (Violentmonkey
 * or Tampermonkey), so they survive updates.
 *
 * ADDING A FEATURE: copy an existing module block and change it:
 *
 *   defineModule({
 *     id: 'myFeature',                         // unique, never change once released (settings are stored under it)
 *     name: 'My feature',                      // shown in the settings panel
 *     description: 'What it does.',
 *     pages: [wmtPage('Views/ScheduleView')],  // where it runs
 *     defaultEnabled: true,
 *     settings: [{ key: 'color', label: 'Highlight color', type: 'color', default: '#d4edda' }],
 *     run(ctx) { ... }                         // ctx.settings.color, ctx.initials, ctx.data, ctx.notice(), ctx.log()
 *   });
 *
 * Setting types: text, password, number, checkbox, color, list (comma separated → array).
 * After a change, raise @version so the userscript manager installs the update.
 * Format: YEAR.MONTH.DAY (2026.11.10); a second release that day adds .1, .2, ...
 * (2026.11.10.1). The number must always go up, never back.
 */

(function () {
    'use strict';

    // ══════════════════════════════════════════════════════════════════════
    //  1. CORE
    // ══════════════════════════════════════════════════════════════════════

    const APP_NAME = 'WMTTools';
    const WMT_HOST = 'wmtscheduler.faa.gov';
    const LOGIN_HOST = 'workforce.faa.gov';

    // Local test copies of WMT pages (served from your own PC) behave like the
    // real site. Has no effect in normal use: @match only allows FAA sites.
    // Add ?wmttHost=workforce.faa.gov to a local test page to act as the sign-in site.
    const DEV_HOSTS = ['localhost', '127.0.0.1'];
    const currentHost = DEV_HOSTS.includes(location.hostname)
        ? (new URLSearchParams(location.search).get('wmttHost') || WMT_HOST)
        : location.hostname;
    const currentPage = currentHost + location.pathname;      // e.g. "wmtscheduler.faa.gov/Views/MySchedule"
    const onWmt = currentHost === WMT_HOST;

    // Page pattern for a WMT path: wmtPage('Views/MySchedule') matches
    // /Views/MySchedule, /Views/MySchedule/ and /Views/MySchedule/anything.
    const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wmtPage = path => new RegExp(`^${escapeRe(WMT_HOST)}/${escapeRe(path)}(/|$)`, 'i');
    const hostPage = host => new RegExp(`^${escapeRe(host)}/`, 'i');

    // ---- Userscript manager compatibility -----------------------------------
    // Violentmonkey and Tampermonkey (desktop, Android, iOS) have everything.
    // Some other managers, mostly on iOS, lack the extras, so each one falls back.
    const addStyle = typeof GM_addStyle === 'function'
        ? GM_addStyle
        : css => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); return s; };
    const addMenuCommand = typeof GM_registerMenuCommand === 'function' ? GM_registerMenuCommand : () => {};
    const scriptVersion = typeof GM_info !== 'undefined' && GM_info.script ? GM_info.script.version : '';

    // ---- Storage -------------------------------------------------------------
    // The userscript manager's storage belongs to this script, is shared by WMT and the
    // sign-in site, and is untouched by script updates.
    const store = {
        get: (key, fallback) => GM_getValue(key, fallback),
        set: (key, value) => GM_setValue(key, value),
        remove: key => (typeof GM_deleteValue === 'function' ? GM_deleteValue(key) : GM_setValue(key, undefined)),
    };
    const settingKey = (moduleId, key) => `settings.${moduleId}.${key}`;
    const dataKey = (moduleId, key) => `data.${moduleId}.${key}`;

    // ---- Modules -----------------------------------------------------------------
    const modules = [];

    function defineModule(def) {
        if (modules.some(m => m.id === def.id)) throw new Error(`Duplicate module id "${def.id}"`);
        modules.push(Object.assign({ pages: [], settings: [], defaultEnabled: true }, def));
    }

    const isEnabled = mod => !mod.run || store.get(settingKey(mod.id, 'enabled'), mod.defaultEnabled);
    const runsHere = mod => mod.pages.some(re => re.test(currentPage));

    function readSettings(mod) {
        const out = {};
        for (const s of mod.settings) out[s.key] = store.get(settingKey(mod.id, s.key), s.default);
        return out;
    }

    // Shared settings used by several modules (see the "general" module below)
    const getInitials = () => String(store.get(settingKey('general', 'initials'), '')).trim().toUpperCase();

    // Everything a module gets when it runs
    function makeContext(mod) {
        return {
            settings: readSettings(mod),
            initials: getInitials(),
            data: {   // module-private saved data (not shown in the settings panel)
                get: (key, fallback) => store.get(dataKey(mod.id, key), fallback),
                set: (key, value) => store.set(dataKey(mod.id, key), value),
            },
            log: (...args) => console.log(`[${APP_NAME}:${mod.id}]`, ...args),
            notice: (message, options) => ui.notice(`${mod.name}: ${message}`, options),
        };
    }

    // Each module runs on its own: an error in one never stops the others.
    function runModules() {
        for (const mod of modules) {
            if (!mod.run || !runsHere(mod) || !isEnabled(mod)) continue;
            const fail = err => {
                console.error(`[${APP_NAME}:${mod.id}]`, err);
                ui.notice(`${mod.name}: ${err && err.message ? err.message : err}`, { kind: 'error' });
            };
            try {
                Promise.resolve(mod.run(makeContext(mod))).catch(fail);
            } catch (err) {
                fail(err);
            }
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    //  2. UI
    // ══════════════════════════════════════════════════════════════════════

    // Small element builder: h('a', { href: '#', onclick: fn }, 'text', child)
    function h(tag, props = {}, ...children) {
        const el = document.createElement(tag);
        for (const [k, v] of Object.entries(props)) {
            if (v === null || v === undefined || v === false) continue;
            if (k === 'class') el.className = v;
            else if (k === 'style') el.style.cssText = v;
            else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
            else if (k in el && !k.startsWith('data-')) el[k] = v;
            else el.setAttribute(k, v);
        }
        el.append(...children.flat(Infinity).filter(c => c !== null && c !== undefined && c !== false));
        return el;
    }

    // Normalized visible text of an element
    const textOf = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

    // Waits for the first element matching any selector; null after the timeout
    function waitFor(selectors, timeoutSeconds = 120) {
        const list = [].concat(selectors);
        const find = () => list.map(s => document.querySelector(s)).find(Boolean) || null;
        return new Promise(resolve => {
            const hit = find();
            if (hit) return resolve(hit);
            const observer = new MutationObserver(() => {
                const el = find();
                if (el) { observer.disconnect(); clearTimeout(timer); resolve(el); }
            });
            const timer = setTimeout(() => { observer.disconnect(); resolve(null); }, timeoutSeconds * 1000);
            observer.observe(document.documentElement, { childList: true, subtree: true });
        });
    }

    const ui = {
        injectStyles() {
            addStyle(`
                #wmtt-notices { position: fixed; top: 8px; right: 8px; z-index: 100000; width: 380px; max-width: calc(100vw - 16px);
                                font: 13px/1.4 Arial, sans-serif; }
                .wmtt-notice { display: flex; gap: 8px; align-items: flex-start; margin-bottom: 6px; padding: 8px 10px;
                               border: 1px solid; border-radius: 4px; box-shadow: 0 2px 6px rgba(0,0,0,.15); }
                .wmtt-notice > span { flex: 1; }
                .wmtt-notice button { cursor: pointer; font: inherit; }
                .wmtt-notice .wmtt-x { border: 0; background: none; font-size: 16px; line-height: 1; padding: 0 2px; }
                .wmtt-info    { background: #e8f1fb; border-color: #8fb3de; }
                .wmtt-success { background: #e8f5e9; border-color: #81c784; }
                .wmtt-warn    { background: #fff3cd; border-color: #e0b400; }
                .wmtt-error   { background: #fde8e8; border-color: #d66; }

                #wmtt-settings { position: fixed; inset: 0; z-index: 100001; background: rgba(0,0,0,.4);
                                 display: flex; align-items: center; justify-content: center; font: 13px/1.4 Arial, sans-serif; }
                #wmtt-settings .wmtt-panel { background: #fff; color: #222; width: 600px; max-width: calc(100vw - 32px);
                                             max-height: 88vh; display: flex; flex-direction: column; border-radius: 6px;
                                             box-shadow: 0 6px 24px rgba(0,0,0,.3); text-align: left; }
                #wmtt-settings header, #wmtt-settings footer { padding: 10px 16px; background: #f5f8fc; }
                #wmtt-settings header { border-bottom: 1px solid #dde3ea; font-weight: bold; font-size: 15px; }
                #wmtt-settings footer { border-top: 1px solid #dde3ea; text-align: right; }
                #wmtt-settings footer button { padding: 5px 14px; margin-left: 6px; cursor: pointer; }
                #wmtt-settings .wmtt-body { overflow: auto; padding: 4px 16px 12px; }
                #wmtt-settings section { border-bottom: 1px solid #eef1f5; padding: 10px 0; }
                #wmtt-settings section.wmtt-off .wmtt-fields { opacity: .45; }
                #wmtt-settings h3 { margin: 0 0 2px; font-size: 14px; display: flex; align-items: center; gap: 6px; }
                #wmtt-settings .wmtt-desc, #wmtt-settings .wmtt-help { color: #666; font-size: 12px; }
                #wmtt-settings .wmtt-field { display: grid; grid-template-columns: 200px 1fr; gap: 2px 10px;
                                             align-items: center; margin-top: 6px; }
                #wmtt-settings .wmtt-field .wmtt-help { grid-column: 2; }
                #wmtt-settings input[type=text], #wmtt-settings input[type=password], #wmtt-settings input[type=number] {
                    width: 100%; box-sizing: border-box; padding: 3px 5px; }
                #wmtt-settings input[type=checkbox] { justify-self: start; }
                @media (max-width: 560px) {   /* phones: label above its input */
                    #wmtt-settings .wmtt-field { grid-template-columns: 1fr; }
                    #wmtt-settings .wmtt-field .wmtt-help { grid-column: 1; }
                    #wmtt-settings .wmtt-panel { max-height: 94vh; }
                }
                @media print { #wmtt-notices, #wmtt-settings { display: none !important; } }
            `);
        },

        // Message box in the top-right corner.
        // options: kind ('info' | 'success' | 'warn' | 'error'), timeout (seconds),
        //          actions ([{ label, onClick }]), onDismiss
        notice(message, { kind = 'info', timeout = 0, actions = [], onDismiss } = {}) {
            let box = document.getElementById('wmtt-notices');
            if (!box) box = document.body.appendChild(h('div', { id: 'wmtt-notices', class: 'noprint' }));
            const close = () => item.remove();
            const item = h('div', { class: `wmtt-notice wmtt-${kind}` },
                h('span', {}, message),
                actions.map(a => h('button', { type: 'button', onclick: () => { close(); a.onClick(); } }, a.label)),
                h('button', { type: 'button', class: 'wmtt-x', title: 'Dismiss',
                              onclick: () => { close(); if (onDismiss) onDismiss(); } }, '×'));
            box.appendChild(item);
            if (timeout) setTimeout(close, timeout * 1000);
            return item;
        },

        // "WMTTools" entry in WMT's top menu bar
        addMenuLink() {
            const menu = document.querySelector('#chromemenu ul');
            if (!menu || document.getElementById('wmtt-menu-link')) return;
            menu.appendChild(h('li', {},
                h('a', { id: 'wmtt-menu-link', href: '#', title: `${APP_NAME} settings`,
                         onclick: e => { e.preventDefault(); ui.openSettings(); } }, APP_NAME)));
        },

        openSettings() {
            if (document.getElementById('wmtt-settings')) return;

            const field = (mod, s) => {
                const id = `wmtt-${mod.id}-${s.key}`;
                const value = store.get(settingKey(mod.id, s.key), s.default);
                const common = { id, 'data-mod': mod.id, 'data-key': s.key, 'data-type': s.type || 'text' };
                let input;
                switch (s.type) {
                    case 'checkbox': input = h('input', { type: 'checkbox', checked: !!value, ...common }); break;
                    case 'number':   input = h('input', { type: 'number', step: s.step || 'any', min: s.min, max: s.max,
                                                          placeholder: s.placeholder, value: value ?? '', ...common }); break;
                    case 'color':    input = h('input', { type: 'color', value, ...common }); break;
                    case 'password': input = h('input', { type: 'password', autocomplete: 'new-password', value: value || '', ...common }); break;
                    case 'list':     input = h('input', { type: 'text', placeholder: s.placeholder, value: (value || []).join(', '), ...common }); break;
                    default:         input = h('input', { type: 'text', placeholder: s.placeholder, value: value ?? '', ...common });
                }
                return h('div', { class: 'wmtt-field' },
                    h('label', { htmlFor: id }, s.label), input,
                    s.help && h('div', { class: 'wmtt-help' }, s.help));
            };

            const section = mod => {
                const toggle = mod.run && h('input', {
                    type: 'checkbox', checked: isEnabled(mod), 'data-mod': mod.id, 'data-key': 'enabled', 'data-type': 'checkbox',
                    onchange: e => sec.classList.toggle('wmtt-off', !e.target.checked),
                });
                const sec = h('section', { class: isEnabled(mod) ? '' : 'wmtt-off' },
                    h('h3', {}, h('label', {}, toggle, ' ', mod.name)),
                    mod.description && h('div', { class: 'wmtt-desc' }, mod.description),
                    h('div', { class: 'wmtt-fields' }, mod.settings.map(s => field(mod, s))));
                return sec;
            };

            const readInput = input => {
                switch (input.dataset.type) {
                    case 'checkbox': return input.checked;
                    case 'number':   return input.value === '' ? null : Number(input.value);
                    case 'list':     return input.value.split(',').map(v => v.trim()).filter(Boolean);
                    case 'password': return input.value;
                    default:         return input.value.trim();
                }
            };

            // Only values that differ from the default are stored, so a default
            // changed in a later version still reaches everyone who kept it.
            const defaultFor = (modId, key) => {
                const mod = modules.find(m => m.id === modId);
                if (key === 'enabled') return mod.defaultEnabled;
                return mod.settings.find(s => s.key === key).default;
            };
            const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
            const save = () => {
                overlay.querySelectorAll('[data-mod]').forEach(input => {
                    const { mod, key } = input.dataset;
                    const value = readInput(input);
                    if (JSON.stringify(value) === JSON.stringify(defaultFor(mod, key) ?? null)) store.remove(settingKey(mod, key));
                    else store.set(settingKey(mod, key), value);
                });
                close();
                location.reload();
            };
            const onKey = e => { if (e.key === 'Escape') close(); };

            const overlay = h('div', { id: 'wmtt-settings', class: 'noprint',
                                       onclick: e => { if (e.target === overlay) close(); } },
                h('div', { class: 'wmtt-panel', role: 'dialog', 'aria-label': `${APP_NAME} settings` },
                    h('header', {}, `${APP_NAME} settings`,
                        h('span', { style: 'font-weight:normal;color:#888;font-size:12px' }, scriptVersion && `  v${scriptVersion}`)),
                    h('div', { class: 'wmtt-body' }, modules.map(section)),
                    h('footer', {},
                        h('button', { type: 'button', onclick: close }, 'Cancel'),
                        h('button', { type: 'button', onclick: save, style: 'font-weight:bold' }, 'Save and reload'))));
            document.body.appendChild(overlay);
            document.addEventListener('keydown', onKey);
        },
    };

    // ══════════════════════════════════════════════════════════════════════
    //  3. MODULES
    // ══════════════════════════════════════════════════════════════════════

    // ── General (shared settings, no page of its own) ──────────────────────
    defineModule({
        id: 'general',
        name: 'General',
        description: 'Used by several features below.',
        settings: [
            { key: 'initials', label: 'Your WMT initials', type: 'text', default: '', placeholder: 'e.g. XY',
              help: 'Exactly as they appear on the schedule.' },
        ],
    });

    // ── Next payday ───────────────────────────────────────────────────────────
    {
        // FAA paydays are every other Tuesday on a fixed 14-day cadence. Each pay
        // period is a Sunday–Saturday two-week block, paid the Tuesday 10 days
        // after it ends. Pay periods are numbered by the year of their payday:
        // PP1 is the first payday of the year (matches WMT's PayPeriodId, e.g. 242026).
        // Any known payday works as the anchor.
        const ANCHOR_PAYDAY = { y: 2026, m: 1, d: 6 };   // Tue Jan 6, 2026 = PP1 2026
        const CYCLE_DAYS = 14;
        const PERIOD_END_TO_PAYDAY = 10;

        // Whole "day numbers" (days since 1970-01-01 UTC): immune to time of day and DST
        const MS_PER_DAY = 86400000;
        const dayNum = (y, m, d) => Date.UTC(y, m - 1, d) / MS_PER_DAY;
        const toDate = n => new Date(n * MS_PER_DAY);
        const fmt = (n, opts) => toDate(n).toLocaleDateString('en-US', Object.assign({ timeZone: 'UTC' }, opts));
        const anchor = dayNum(ANCHOR_PAYDAY.y, ANCHOR_PAYDAY.m, ANCHOR_PAYDAY.d);

        const paydayOnOrAfter = n => anchor + Math.ceil((n - anchor) / CYCLE_DAYS) * CYCLE_DAYS;

        function payInfo(fromDay) {
            const payday = paydayOnOrAfter(fromDay);
            const year = toDate(payday).getUTCFullYear();
            const periodEnd = payday - PERIOD_END_TO_PAYDAY;
            return {
                payday,
                number: (payday - paydayOnOrAfter(dayNum(year, 1, 1))) / CYCLE_DAYS + 1,
                periodStart: periodEnd - 13,
                periodEnd,
                daysUntil: payday - fromDay,
            };
        }

        defineModule({
            id: 'payday',
            name: 'Next payday',
            description: 'Worksheet View: the next payday, the pay period it covers, and a countdown.',
            pages: [wmtPage('Views/WorksheetView')],
            settings: [
                { key: 'color', label: 'Box color', type: 'color', default: '#c3e6cb' },
            ],
            run(ctx) {
                const header = document.querySelector('#WorksheetViewHeader h2');
                if (!header) return;

                addStyle(`
                    #wmtt-payday { float: left; width: 45%; border: 1px solid #8fd19e; border-collapse: collapse;
                                   background-color: ${ctx.settings.color}; }
                    #wmtt-payday th, #wmtt-payday td { padding: .25rem; text-align: left; }
                    #wmtt-payday td { font-size: .8em; }
                    #wmtt-payday .wmtt-countdown { font-weight: bold; }
                    #wmtt-payday.wmtt-is-payday { background-color: #ffe08a; border-color: #e0b400; }
                `);

                const now = new Date();
                const info = payInfo(dayNum(now.getFullYear(), now.getMonth() + 1, now.getDate()));
                const short = n => fmt(n, { month: 'short', day: 'numeric', year: 'numeric' });
                const countdown = info.daysUntil === 0 ? 'Payday is today!'
                    : info.daysUntil === 1 ? 'Tomorrow' : `${info.daysUntil} days`;

                const table = h('table', { id: 'wmtt-payday', class: info.daysUntil === 0 ? 'wmtt-is-payday' : '' });
                const row = table.insertRow();
                row.append(
                    h('th', { scope: 'row' }, fmt(info.payday, { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })),
                    h('td', {}, `Pay Period ${info.number}:`, h('br'), `${short(info.periodStart)} – ${short(info.periodEnd)}`));
                table.insertRow().append(h('td', { colSpan: 2, class: 'wmtt-countdown' }, countdown));
                header.before(table);
            },
        });
    }

    // ── Hide Print button ─────────────────────────────────────────────────────
    defineModule({
        id: 'hidePrint',
        name: 'Hide Print button',
        description: 'Worksheet View: hides the Print button next to the date.',
        pages: [wmtPage('Views/WorksheetView')],
        run() {
            addStyle('#WorksheetViewHeader > tbody > tr > td.noprint { display: none; }');
        },
    });

    // ── Mobile layout (Worksheet View) ─────────────────────────────────────────
    defineModule({
        id: 'mobileWorksheet',
        name: 'Mobile layout',
        description: 'Worksheet View: on narrow screens like phones, puts the tables in one column ' +
                     'instead of side by side, and wraps the 14 days into two rows, so there\'s less sideways scrolling.',
        pages: [wmtPage('Views/WorksheetView')],
        settings: [
            { key: 'maxWidth', label: 'Use when the screen is at most (px) wide', type: 'number', default: 900, min: 0, step: 10,
              placeholder: 'blank = always', help: 'Phones are about 360–430 px wide, tablets 768–1024. Blank = always use it.' },
        ],
        run(ctx) {
            // The page lays out its parts as table cells side by side. Turning those
            // cells into blocks stacks them; the tables inside keep their own layout.
            const stack = (...tables) => tables.flatMap(t => [t, `${t} > tbody`, `${t} > tbody > tr`, `${t} > tbody > tr > td`]).join(',\n');
            const css = `
                ${stack('#WorksheetViewHeader', '#WorksheetViewDashBoard')} {
                    display: block; width: 100% !important; box-sizing: border-box;
                }
                #WorksheetViewHeader > tbody > tr > td { margin-bottom: 8px; }

                /* Page header: "WMT Scheduler - facility" and "Welcome: name" are set never
                   to wrap, which keeps the whole page wider than a phone */
                td.title table td { display: block; width: auto !important; white-space: normal !important; padding-left: 10px; }
                /* Menu bar: let the items wrap onto a second line */
                #chromemenu ul { white-space: normal !important; height: auto !important; }
                #chromemenu ul li { display: inline-block !important; float: none !important; }
                #wmtt-payday { float: none !important; width: 100% !important; margin-bottom: 8px; }
                #tblTopGuidelines { width: 100% !important; margin: 0 !important; }

                /* 14 days → two rows of 7 */
                #WorksheetViewDayStrip { width: 100% !important; }
                #WorksheetViewDayStrip > tbody > tr { display: flex; flex-wrap: wrap; }
                #WorksheetViewDayStrip > tbody > tr > td { flex: 0 0 calc(100% / 7); min-width: 0; box-sizing: border-box;
                                                           padding: 4px 0; font-size: .75em; overflow-wrap: anywhere; }

                /* Every table full width; wide Requests tables scroll inside themselves */
                #WorksheetViewDashBoard table { width: 100% !important; }
                /* Long words in OT reasons and notes may break instead of widening the page */
                #ControllersOnOTShifts td td:nth-child(4), #ShiftNotesForDay td { overflow-wrap: anywhere; }
                /* (capped at the screen width, or they'd still push the whole page wider) */
                #tblShiftChange, #tblXTECTE, #tblSupRequests { display: block; overflow-x: auto; max-width: calc(100vw - 48px); }
                #WorksheetViewDashBoard > tbody > tr > td + td { margin-top: 16px; }
                body { -webkit-text-size-adjust: 100%; }
            `;
            const maxWidth = ctx.settings.maxWidth;
            addStyle(maxWidth ? `@media (max-width: ${maxWidth}px) { ${css} }` : css);
        },
    });

    // ── Highlight my initials (Worksheet View) ───────────────────────────────
    {
        // The page decorates initials: "XY$" (OT), "(YZ)" (supervisor),
        // "(XZ-OM)" (role suffix), plus trailing &nbsp;. Reduce to bare initials.
        const bareInitials = text => text.replace(/[\s\u00a0$()]/g, '').split('-')[0];

        defineModule({
            id: 'worksheetInitials',
            name: 'Highlight my initials',
            description: 'Worksheet View: your initials in bold, and any row with them in color. ' +
                         'Notes and OT reasons are skipped so words like "OT" don\'t match.',
            pages: [wmtPage('Views/WorksheetView')],
            settings: [
                { key: 'rowColor', label: 'Row color', type: 'color', default: '#d4edda' },
                { key: 'textColor', label: 'Initials text color', type: 'text', default: '',
                  placeholder: 'blank = unchanged, or e.g. #155724' },
            ],
            run(ctx) {
                const dashboard = document.getElementById('WorksheetViewDashBoard');
                if (!dashboard || !ctx.initials) return;
                const me = ctx.initials;
                const { rowColor, textColor } = ctx.settings;

                addStyle(`
                    .wmtt-me { font-weight: bold !important; ${textColor ? `color: ${textColor} !important;` : ''} }
                    tr.wmtt-me-row > td, tr.wmtt-me-row > th, .wmtt-me-solo { background-color: ${rowColor} !important; }
                `);

                // Rows with several columns turn green. Single-cell lists (RDO,
                // Team Brief) hold everyone in one row, so only your entry does.
                const mark = el => {
                    el.classList.add('wmtt-me');
                    const row = el.closest('tr');
                    if (row && row.cells.length > 1) row.classList.add('wmtt-me-row');
                    else el.classList.add('wmtt-me-solo');
                };

                // Innermost elements whose whole text is your initials
                dashboard.querySelectorAll('a, td, th, div, span').forEach(el => {
                    if (!el.children.length && bareInitials(el.textContent) === me) mark(el);
                });

                // Team Brief is one line of text: " - XY - YZ - XZ - "
                const brief = document.querySelector('#TeamBrief td div');
                if (brief) {
                    const parts = brief.textContent.split(/(\s*-\s*)/);
                    if (parts.some(p => p.trim() === me)) {
                        brief.replaceChildren(...parts.map(p => p.trim() === me
                            ? h('span', { class: 'wmtt-me wmtt-me-solo' }, p)
                            : document.createTextNode(p)));
                    }
                }
            },
        });
    }

    // ── Schedule View: my row and who's off with me ──────────────────────────
    defineModule({
        id: 'scheduleView',
        name: 'Schedule View helper',
        description: 'Schedule View: highlights your row, your days off and leave, everyone off on the same days, ' +
                     'and overstaffed Day / Swing counts. Adds an "Off with me" summary.',
        pages: [wmtPage('Views/ScheduleView')],
        settings: [
            { key: 'offCodes', label: 'Codes that mean "off"', type: 'list', default: ['X', 'LV'],
              help: 'For other people, comma separated.' },
            { key: 'showInitials', label: 'Initials in matching cells', type: 'checkbox', default: true,
              help: 'Replace their X / LV with their initials on your days off.' },
            { key: 'showSummary', label: '"Off with me" table', type: 'checkbox', default: true },
            { key: 'overstaffCount', label: 'Highlight Overstaff', type: 'number', default: 10, min: 1, step: 1,
              placeholder: 'blank = off',
              help: 'Number of people on a Day / Swing shift that makes it overstaffed. Counts at or above it are highlighted.' },
            { key: 'colorOverstaff',  label: 'Overstaff color',          type: 'color', default: '#00ff00' },
            { key: 'colorMyRow',      label: 'My row',                   type: 'color', default: '#e3f8e3' },
            { key: 'colorMyOff',      label: 'My days off (X)',          type: 'color', default: '#6fcf6f' },
            { key: 'colorMyLeave',    label: 'My leave days',            type: 'color', default: '#ffd966' },
            { key: 'colorShareName',  label: 'Name of someone off with me', type: 'color', default: '#dcecff' },
            { key: 'colorShareOff',   label: 'Their X on my days off',   type: 'color', default: '#7fb3ea' },
            { key: 'colorShareLeave', label: 'Their LV on my days off',  type: 'color', default: '#b9d6f5' },
        ],
        run(ctx) {
            const table = document.getElementById('tblPayPeriodStatus');
            if (!table) return;
            const S = ctx.settings;
            const MY_LEAVE = /^A<\d{4}>/;   // annual leave, e.g. A<0630>

            const rows = [...table.rows].map(tr => ({ tr, cells: [...tr.cells] }));
            const isPerson = r => r.cells.length === 15 && /^\S+ - /.test(textOf(r.cells[0]));
            const initialsOf = r => textOf(r.cells[0]).split(' - ')[0];

            // 1) Overstaffed counts in the Day and Swing rows
            if (S.overstaffCount) {
                rows.filter(r => ['Day', 'Swing'].includes(textOf(r.cells[0] || r.tr)))
                    .forEach(r => r.cells.slice(1).forEach(td => {
                        const count = textOf(td);
                        if (/^\d+$/.test(count) && Number(count) >= S.overstaffCount) td.style.backgroundColor = S.colorOverstaff;
                    }));
            }

            // 2) my row, my X days and my leave days
            const me = ctx.initials && rows.find(r => isPerson(r) && initialsOf(r) === ctx.initials);
            if (!me) return;

            me.tr.style.backgroundColor = S.colorMyRow;
            const myOff = new Map();   // column -> 'X' | 'leave'
            me.cells.forEach((td, i) => {
                if (i === 0) return;
                const v = textOf(td);
                if (v === 'X') { td.style.backgroundColor = S.colorMyOff; myOff.set(i, 'X'); }
                else if (MY_LEAVE.test(v)) { td.style.backgroundColor = S.colorMyLeave; myOff.set(i, 'leave'); }
            });

            // 3) other people off on any of my days off
            const offByCol = new Map([...myOff.keys()].map(i => [i, []]));
            rows.filter(r => isPerson(r) && r !== me).forEach(r => {
                let shares = false;
                myOff.forEach((_, i) => {
                    const td = r.cells[i];
                    const code = textOf(td);
                    if (!S.offCodes.includes(code)) return;
                    shares = true;
                    td.style.backgroundColor = code === 'LV' ? S.colorShareLeave : S.colorShareOff;
                    offByCol.get(i).push({ row: r, initials: initialsOf(r), name: textOf(r.cells[0]), code });
                    if (S.showInitials) {
                        const target = td.querySelector('a') || td.querySelector('div') || td;
                        target.textContent = initialsOf(r);
                        target.style.fontWeight = 'bold';
                        td.title = `${textOf(r.cells[0])}: ${code}`;
                    }
                });
                if (shares) r.cells[0].style.backgroundColor = S.colorShareName;
            });

            // 4) "Off with me" summary
            if (!S.showSummary || !myOff.size) return;
            const header = rows.find(r => r.cells.length === 15 && textOf(r.cells[0]) === 'Name');
            const dayLabel = i => (header ? textOf(header.cells[i]).replace(/\/\d{4}$/, '') : `Day ${i}`);
            const cellCss = 'padding:4px 8px; vertical-align:top; min-width:80px;';

            const summary = h('table', { border: '1', style: 'margin:0 auto; border-collapse:collapse; text-align:center;' });
            const [trHead, trCount, trList] = [summary.insertRow(), summary.insertRow(), summary.insertRow()];
            myOff.forEach((kind, i) => {
                const people = offByCol.get(i);
                trHead.append(h('td', { style: `${cellCss} font-weight:bold; background:${kind === 'leave' ? S.colorMyLeave : S.colorMyOff}` },
                    dayLabel(i) + (kind === 'leave' ? ' (A)' : '')));
                trCount.append(h('td', { style: cellCss }, `${people.length} off`));
                trList.append(h('td', { style: cellCss }, people.map(p => h('div', {
                    title: `${p.name}: ${p.code} (click to jump to row)`,
                    style: 'margin:2px 0; padding:1px 4px; cursor:pointer; border-radius:3px;' +
                           `background:${p.code === 'LV' ? S.colorShareLeave : S.colorShareOff};` +
                           (p.code === 'LV' ? 'font-style:italic;' : 'font-weight:bold;'),
                    onclick: () => {
                        p.row.tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        p.row.tr.style.outline = '3px solid #ff9800';
                        setTimeout(() => (p.row.tr.style.outline = ''), 2000);
                    },
                }, p.code === 'LV' ? `${p.initials} (LV)` : p.initials))));
            });

            table.before(h('div', { style: 'margin:8px auto 12px; width:98%; text-align:center;' },
                h('div', { style: 'font-weight:bold; margin-bottom:4px;' }, 'Off with me'), summary));
        },
    });

    // ── Favorite co-workers ───────────────────────────────────────────────────
    // Registered after the Schedule View helper on purpose: it then also colors
    // the initials that helper writes into cells and its "Off with me" table.
    {
        const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'OPTION', 'SELECT', 'TEXTAREA', 'INPUT']);
        const SKIP_INSIDE = '#wmtt-settings, #wmtt-notices';

        // Three places initials appear in WMT, from most to least common:
        //  1. A cell or link that is just the initials, maybe decorated:
        //     "XY", "YZ$", "(XZ)", "(ZX-OM)", "XZ (LV)". It must be the element's
        //     whole content, so section headings like "OT" aren't matched.
        const SOLO = /^\(?([A-Z]{2,3})(?:-[A-Z]+)?\)?\$?(?:\s*\(LV\))?$/;
        //  2. Text that starts with "XY - ": Schedule View names
        //     ("XY - Lastname, First") and shift notes ("YZ - OT List Exhausted")
        const PREFIX = /^\s*([A-Z]{2,3}) - /;
        //  3. A dash-separated list of initials: Team Brief " - XY - YZ - XZ - "
        const LIST = /^[\s-]*[A-Z]{2,3}(?:\s*-\s*[A-Z]{2,3})+[\s-]*$/;
        // Anything else (free text like "XY working OT for YZ.") is left alone,
        // so favorites whose initials are also words (OT, IN, TO) don't match there.

        // [start, end] positions of favorite initials inside one text node
        function findRanges(node, favorites) {
            const text = node.nodeValue;
            const trimmed = text.trim();
            let m = trimmed.match(SOLO);
            if (m) {
                if (node.parentElement.textContent.trim() !== trimmed) return [];
                if (!favorites.has(m[1])) return [];
                const start = text.indexOf(m[1]);
                return [[start, start + m[1].length]];
            }
            m = text.match(PREFIX);
            if (m) {
                if (!favorites.has(m[1])) return [];
                const start = text.indexOf(m[1]);
                return [[start, start + m[1].length]];
            }
            if (LIST.test(text)) {
                return [...text.matchAll(/[A-Z]{2,3}/g)]
                    .filter(x => favorites.has(x[0]))
                    .map(x => [x.index, x.index + x[0].length]);
            }
            return [];
        }

        // Wraps each range in <span class="wmtt-fav">, last first so earlier positions stay valid
        function wrapRanges(node, ranges) {
            for (const [start, end] of ranges.reverse()) {
                const middle = node.splitText(start);
                middle.splitText(end - start);
                middle.replaceWith(h('span', { class: 'wmtt-fav' }, middle.textContent));
            }
        }

        defineModule({
            id: 'favorites',
            name: 'Favorite co-workers',
            description: 'Every WMT page: shows the initials of the people you list in their own color.',
            pages: [hostPage(WMT_HOST)],
            settings: [
                { key: 'initials', label: 'Initials', type: 'list', default: [], placeholder: 'e.g. XY, YZ, XZ',
                  help: 'Comma separated.' },
                { key: 'color', label: 'Color', type: 'color', default: '#ff0000' },
                { key: 'bold', label: 'Also bold', type: 'checkbox', default: false },
            ],
            run(ctx) {
                const favorites = new Set(ctx.settings.initials.map(i => i.trim().toUpperCase()).filter(Boolean));
                if (!favorites.size) return;

                addStyle(`.wmtt-fav { color: ${ctx.settings.color} !important;` +
                            `${ctx.settings.bold ? ' font-weight: bold !important;' : ''} }`);

                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
                    acceptNode: node => {
                        const parent = node.parentElement;
                        if (!parent || SKIP_TAGS.has(parent.tagName) || parent.closest(SKIP_INSIDE)) return NodeFilter.FILTER_REJECT;
                        return /[A-Z]{2}/.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
                    },
                });
                // Collect first, then change: editing while walking confuses the walker
                const hits = [];
                for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                    const ranges = findRanges(node, favorites);
                    if (ranges.length) hits.push([node, ranges]);
                }
                hits.forEach(([node, ranges]) => wrapRanges(node, ranges));
            },
        });
    }

    // ── Calendar export (My Schedule → .ics / .csv) ──────────────────────────
    {
        // Calendar titles for leave and days off (from WMT's Shift Legend page)
        const LEAVE_TITLES = {
            X: 'RDO', A: 'VACATION', HL: 'HOLIDAY LEAVE', SL: 'SL', FSL: 'FAMILY SICK LEAVE', ADMIN: 'ADMIN LEAVE',
            AWOL: 'AWOL', TRNG: 'TRAINING', BL: 'BLOOD LEAVE', CL: 'COURT LEAVE', COS: 'CHANGE OF STATION',
            CTU: 'COMP TIME', XTU: 'CREDIT TIME', FL: 'FUNERAL LEAVE', FRLO: 'FURLOUGH', JURY: 'JURY DUTY',
            LWOP: 'LWOP', MIL: 'MILITARY LEAVE', TOA: 'TIME OFF AWARD', WX: 'WEATHER LEAVE',
        };
        // Symbol at the end of a shift ("1500$" → "OT 1500")
        const PAY_LABELS = { '$': 'OT', '^': 'CREDIT', '!': 'COMP' };
        const PAY_CATEGORY = { '$': 'ot', '^': 'credit', '!': 'comp' };
        // Special assignments ("C0600" → "XY CIC 0600")
        const ROLE_LABELS = {
            '@': 'ADMIN', '@D': 'ADMIN DETAIL', '@T': 'ADMIN TRNG', C: 'CIC', D: 'DETAIL',
            T: 'TRNG', AREA: 'TMU', TMC: 'TMC', OM: 'OMIC',
        };
        // Shift Legend remarks added to the calendar title, e.g. "XY 0800 (No Flex)"
        const TITLE_REMARKS = ['No Flex'];
        const ADMIN_SHIFT_HOURS = 8.5;   // WMT: "@ + shift = Administrative Shift 8.5 hours"
        // Only for a code missing from the legend: the letter picks the length in hours
        const FALLBACK_HOURS = { '': 8, N: 9, S: 7, M: 10, X: 6 };

        // Shift times copied from Views → Shift Legend (F Area, 11/09/2026). Opening
        // the Shift Legend page saves a fresh copy, so this list rarely matters.
        const BUILT_IN_LEGEND = `
            2330=2330-0730 X0530=0530-1130 N0800=0800-1700 N0900=0900-1800 0000=0000-0800 0600=0600-1400
            0700=0700-1500 0800=0800-1600 1330=1330-2130 1500=1500-2300 1600=1600-0000 0630=0630-1430
            0615=0615-1415 1430=1430-2230 S0700=0700-1400 S0800=0800-1500 N1100=1100-2000 1200=1200-2000
            N1300=1300-2200 N1400=1400-2300 N1500=1500-0000 2230=2230-0630 0645=0645-1445 N1200=1200-2100
            S0745=0745-1445 N1230=1230-2130 1300=1300-2100 1000=1000-1800 S0715=0715-1415 S0730=0730-1430
            N1330=1330-2230 S0900=0900-1600 S0000=0000-0700 0900=0900-1700 S1300=1300-2000 2200=2200-0600
            1130=1130-1930 1230=1230-2030 1100=1100-1900 M2130=2130-0730 0730=0730-1530 M1100=1100-2100
            S1200=1200-1900 M0900=0900-1900 M1200=1200-2200 M2100=2100-0700 M1300=1300-2300 M1000=1000-2000
            N1000=1000-1900 M2230=2230-0830 M0000=0000-1000 N0600=0600-1500 N0630=0630-1530 N0730=0730-1630
            M0700=0700-1500 N0700=0700-1600 M0600=0600-1600 N2130=2130-0630 S0615=0615-1315 2130=2130-0530
            0530=0530-1330 S0530=0530-1230 N1130=1130-2030 M1930=1930-0530 N1930=1930-0430 0830=0830-1630
            S0830=0830-1530 1400=1400-2200 1030=1030-1830 M1400=1400-0000 0930=0930-1730
        `;
        const BUILT_IN_REMARKS = {
            '0000': 'No Flex', '0800': 'No Flex', '1600': 'No Flex', N1400: 'No Flex', M1400: 'NO FLEX', '2200': 'OS MID ONLY',
        };
        const OLD_LEGEND_KEY = 'wmtCalendarExport.legend';   // where the stand-alone script kept it

        let S;   // this run's settings plus initials, set in run()

        const pad = n => String(n).padStart(2, '0');
        const toMinutes = t => { const d = t.replace(':', ''); return +d.slice(0, 2) * 60 + +d.slice(2, 4); };
        const titleWithMe = (...parts) => [S.initials, ...parts].filter(Boolean).join(' ');

        // ---- Shift legend ----
        function parseLegendText(text) {
            const shifts = {};
            for (const item of text.trim().split(/\s+/)) {
                const m = item.match(/^(.+)=(\d{4})-(\d{4})$/);
                if (m) shifts[m[1]] = [toMinutes(m[2]), toMinutes(m[3])];
            }
            return shifts;
        }

        function loadLegend(ctx) {
            const legend = { shifts: parseLegendText(BUILT_IN_LEGEND), source: 'built-in list (11/09/2026)' };
            for (const [code, remark] of Object.entries(BUILT_IN_REMARKS)) {
                if (legend.shifts[code]) legend.shifts[code][2] = remark;
            }
            let saved = ctx.data.get('legend', null);
            if (!saved) {   // one-time move from the old stand-alone script
                try { saved = JSON.parse(localStorage.getItem(OLD_LEGEND_KEY) || 'null'); } catch (e) { /* ignore */ }
                if (saved) ctx.data.set('legend', saved);
            }
            if (saved && saved.shifts) {
                Object.assign(legend.shifts, saved.shifts);   // each entry: [start, end, remark]
                legend.source = `your Shift Legend page, saved ${new Date(saved.savedAt).toLocaleDateString()}`;
            }
            return legend;
        }

        // On Views → Shift Legend: remember every shift's times
        function saveLegendFromPage(ctx) {
            const table = document.getElementById('tblShiftLegendAreaShifts');
            if (!table) return;
            const shifts = {};
            for (const row of [...table.rows].slice(1)) {
                const cells = [...row.cells].map(textOf);
                const [code, start, end] = cells;
                if (code && /^\d{1,2}:\d{2}$/.test(start) && /^\d{1,2}:\d{2}$/.test(end)) {
                    shifts[code.toUpperCase()] = [toMinutes(start.padStart(5, '0')), toMinutes(end.padStart(5, '0')), cells[5] || ''];
                }
            }
            const count = Object.keys(shifts).length;
            if (!count) return;
            ctx.data.set('legend', { savedAt: Date.now(), shifts });
            ctx.notice(`saved times for ${count} shifts. My Schedule exports will use them.`, { kind: 'success', timeout: 8 });
        }

        // ---- Reading My Schedule ----
        const cellLines = cell => (cell.innerText || cell.textContent || '').split('\n').map(s => s.trim()).filter(Boolean);

        // The schedule is the table with the most of its own cells holding a date.
        // (Only its own rows: the page-layout tables around it contain the same
        // cells as descendants and would otherwise win.)
        function findScheduleTable() {
            let best = null, bestCount = 0;
            for (const t of document.querySelectorAll('table')) {
                let count = 0;
                for (const row of t.rows) {
                    for (const cell of row.cells) {
                        if (!cell.querySelector('table') && cellLines(cell).some(parseDate)) count++;
                    }
                }
                if (count > bestCount) { best = t; bestCount = count; }
            }
            return bestCount >= 3 ? best : null;
        }

        // Each day cell is: weekday / date / code
        function readSchedule(table, legend) {
            const events = [];
            for (const row of table.rows) {
                for (const cell of row.cells) {
                    const lines = cellLines(cell);
                    const i = lines.findIndex(l => parseDate(l));
                    if (i !== -1 && lines[i + 1]) events.push(buildEvent(parseDate(lines[i]), lines[i + 1], legend));
                }
            }
            return events.sort((a, b) => a.date - b.date);
        }

        // Accepts 11/09/2026, 11/9/26, 11/09 (year guessed), 2026-11-09
        function parseDate(text) {
            let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
            if (m) return makeDate(+m[1], +m[2] - 1, +m[3]);
            m = text.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/);
            if (!m) return null;
            let y = m[3] ? +m[3] : null;
            if (y !== null && y < 100) y += 2000;
            return makeDate(y, +m[1] - 1, +m[2]);
        }

        function makeDate(year, month, day) {
            if (month < 0 || month > 11 || day < 1 || day > 31) return null;
            if (year === null) {
                const now = new Date();
                return [-1, 0, 1].map(o => new Date(now.getFullYear() + o, month, day))
                    .reduce((a, b) => (Math.abs(a - now) <= Math.abs(b - now) ? a : b));
            }
            const d = new Date(year, month, day);
            return d.getMonth() === month ? d : null;
        }

        // ---- Decoding a WMT code ----
        //  0600  N0700  M2130  X0530  1500$  C0600  @0600  T0730  0600TMC$  0600OM^  AREA0700  D  D<0600>  A<0600>  SL  X
        function decodeCode(raw) {
            let code = raw.toUpperCase().replace(/\s+/g, '');
            const pay = (code.match(/[$^!]$/) || [''])[0];
            if (pay) code = code.slice(0, -1);

            // Leave / day off, sometimes with the shift it covers: "A<0600>"
            let m = code.match(/^([A-Z]+)(?:<([^>]*)>?)?$/);
            if (m && LEAVE_TITLES[m[1]]) return { type: 'leave', leave: m[1], covers: (m[2] || '').trim() };

            let role = '';
            for (const p of ['AREA', '@D', '@T', '@', 'C', 'D', 'T']) {
                if (code.startsWith(p)) { role = p; code = code.slice(p.length); break; }
            }
            m = code.match(/(TMC|OM)$/);
            if (m) { role = role || m[1]; code = code.slice(0, -m[1].length); }

            code = code.replace(/^<|>$/g, '');   // "D<0600>" → "0600"
            if (!code) return role ? { type: 'role-only', role } : { type: 'unknown' };
            return { type: 'shift', shift: code, role, pay };
        }

        // "6" → "0600", "N7" → "N0700", "730" → "0730"
        function normalizeShorthand(code) {
            const m = code.match(/^([NSMX]?)(\d{1,4})$/);
            if (!m) return code;
            return m[1] + (m[2].length <= 2 ? pad(m[2]) + '00' : m[2].padStart(4, '0'));
        }

        function shiftTimes(code, legend) {
            const fromLegend = legend.shifts[code] || legend.shifts[normalizeShorthand(code)];
            if (fromLegend) {
                const [start, end, remark = ''] = fromLegend;
                return { start, length: end > start ? end - start : end + 1440 - start, fromLegend: true, remark };
            }
            const m = normalizeShorthand(code).match(/^([NSMX]?)(\d{2})(\d{2})$/);
            if (!m) return null;
            return { start: +m[2] * 60 + +m[3], length: (FALLBACK_HOURS[m[1]] ?? FALLBACK_HOURS['']) * 60, fromLegend: false };
        }

        function buildEvent(date, rawText, legend) {
            const raw = rawText.trim();
            const d = decodeCode(raw);

            if (d.type === 'leave') {
                const covered = d.covers ? shiftTimes(d.covers, legend) : null;
                return {
                    date, raw, allDay: true, category: d.leave === 'X' ? 'off' : 'leave',
                    title: titleWithMe(LEAVE_TITLES[d.leave]),
                    hours: covered ? covered.length / 60 : 0,
                    note: d.covers ? `Covers the ${d.covers} shift` : '',
                };
            }

            if (d.type === 'shift') {
                const t = shiftTimes(d.shift, legend);
                if (t) {
                    const length = d.role.startsWith('@') ? ADMIN_SHIFT_HOURS * 60 : t.length;
                    const isMid = Math.floor(t.start / 60) >= S.midStartHour;
                    const dayShift = isMid && S.midStartsPreviousDay ? -1 : 0;
                    // Built from the clock so 2330 + 8h correctly ends 0730 the next day
                    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() + dayShift, 0, t.start);
                    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, t.start + length);

                    const payLabel = d.pay ? PAY_LABELS[d.pay] : '';
                    const roleLabel = d.role ? ROLE_LABELS[d.role] || d.role : '';
                    const remark = TITLE_REMARKS.find(r => r.toLowerCase() === (t.remark || '').toLowerCase());
                    // Initials on regular shifts; "OT …" / "MID …" instead of initials otherwise
                    const title = [(payLabel || isMid) ? '' : S.initials, payLabel, isMid ? 'MID' : '', roleLabel, d.shift,
                                   remark ? `(${remark})` : ''].filter(Boolean).join(' ');
                    return {
                        date, raw, allDay: false, start, end, title, hours: length / 60,
                        note: t.remark ? `Shift Legend remark: ${t.remark}` : '',
                        category: d.pay ? PAY_CATEGORY[d.pay] : 'worked',
                        guessed: !t.fromLegend,
                    };
                }
            }

            if (d.type === 'role-only') {
                return { date, raw, allDay: true, category: 'worked', hours: 0,
                         title: titleWithMe(ROLE_LABELS[d.role] || d.role), note: 'No shift time given' };
            }

            // Unknown code: still exported so nothing silently disappears
            return { date, raw, allDay: true, category: 'unknown', hours: 0, title: titleWithMe(raw), unknown: true };
        }

        // ---- File builders ----
        const ymd = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
        const icsLocal = d => `${ymd(d)}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
        const icsUTC = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
        const icsText = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

        function fold(line) {
            const out = [];
            while (line.length > 75) { out.push(line.slice(0, 75)); line = ' ' + line.slice(75); }
            out.push(line);
            return out.join('\r\n');
        }

        function describe(e, payPeriod) {
            const parts = [`WMT code: ${e.raw}`];
            if (e.note) parts.push(e.note);
            if (!e.allDay && e.start.getDate() !== e.date.getDate()) {
                parts.push(`Listed in WMT on ${e.date.toLocaleDateString(undefined, { weekday: 'long', month: 'numeric', day: 'numeric', year: 'numeric' })}`);
            }
            if (e.guessed) parts.push('Shift length estimated (code not in Shift Legend)');
            if (payPeriod) parts.push(`Pay period: ${payPeriod}`);
            return parts.join('\n');
        }

        function buildICS(events, payPeriod) {
            const now = new Date();
            const stamp = icsUTC(now);
            // Goes up with every export, so calendars treat a re-import as the newer version
            const sequence = Math.floor((now - Date.UTC(2024, 0, 1)) / 60000);
            const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WMTTools//Calendar Export//EN',
                           'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsText(S.calendarName)}`];
            for (const e of events) {
                lines.push('BEGIN:VEVENT',
                    // One permanent ID per WMT day: re-importing updates instead of duplicating
                    `UID:wmt-${ymd(e.date)}-${S.initials}@wmt-calendar-export`,
                    `DTSTAMP:${stamp}`, `LAST-MODIFIED:${stamp}`, `SEQUENCE:${sequence}`,
                    `SUMMARY:${icsText(e.title)}`, `DESCRIPTION:${icsText(describe(e, payPeriod))}`);
                if (e.allDay) {
                    const next = new Date(e.date.getFullYear(), e.date.getMonth(), e.date.getDate() + 1);
                    lines.push(`DTSTART;VALUE=DATE:${ymd(e.date)}`, `DTEND;VALUE=DATE:${ymd(next)}`, 'TRANSP:TRANSPARENT');
                } else {
                    lines.push(`DTSTART:${icsLocal(e.start)}`, `DTEND:${icsLocal(e.end)}`, 'TRANSP:OPAQUE');
                    if (S.reminderMinutes) {
                        lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(e.title)}`,
                                   `TRIGGER:-PT${S.reminderMinutes}M`, 'END:VALARM');
                    }
                }
                lines.push('END:VEVENT');
            }
            lines.push('END:VCALENDAR');
            return lines.map(fold).join('\r\n') + '\r\n';
        }

        function buildCSV(events) {
            const mdy = d => `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
            const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
            const q = s => `"${String(s).replace(/"/g, '""')}"`;
            const rows = ['Subject,Start Date,Start Time,End Date,End Time,All Day Event,Description'];
            for (const e of events) {
                rows.push(e.allDay
                    ? [q(e.title), mdy(e.date), '', '', '', 'True', q(`WMT code: ${e.raw}`)].join(',')
                    : [q(e.title), mdy(e.start), hm(e.start), mdy(e.end), hm(e.end), 'False', q(`WMT code: ${e.raw}`)].join(','));
            }
            return rows.join('\r\n') + '\r\n';
        }

        function download(content, fileName, mimeType) {
            const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
            const link = h('a', { href: url, download: fileName });
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }

        // ---- On-page panel ----
        // "242026" → "PP24 2026"
        function getPayPeriod() {
            const sel = document.getElementById('PayPeriodId');
            if (!sel || sel.selectedIndex < 0) return '';
            const text = sel.options[sel.selectedIndex].text.trim();
            const m = text.match(/^(\d{1,2})(\d{4})$/);
            return m ? `PP${pad(m[1])} ${m[2]}` : text;
        }

        function renderPanel(table, events, legend) {
            const payPeriod = getPayPeriod();
            const baseName = 'WMT_' + (payPeriod || 'schedule').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');

            const sum = cat => events.filter(e => e.category === cat).reduce((s, e) => s + e.hours, 0);
            const num = n => (Number.isInteger(n) ? n : n.toFixed(1));
            const totals = [['worked', 'hrs worked'], ['leave', 'hrs leave'], ['ot', 'hrs OT'], ['credit', 'hrs credit'], ['comp', 'hrs comp']]
                .map(([cat, label]) => [sum(cat), label]).filter(([hrs]) => hrs > 0);

            const unknown = events.filter(e => e.unknown);
            const guessed = events.filter(e => e.guessed);

            const hhmm = d => pad(d.getHours()) + pad(d.getMinutes());
            const wd = d => d.toLocaleDateString(undefined, { weekday: 'short' });
            const timeText = e => {
                if (e.allDay) return e.note ? `All day · ${e.note.toLowerCase()}` : 'All day';
                const lastMinute = new Date(e.end.getTime() - 60000);   // ending exactly at 0000 isn't "overnight"
                if (lastMinute.getDate() === e.start.getDate()) return `${hhmm(e.start)}–${hhmm(e.end)}`;
                return `${wd(e.start)} ${hhmm(e.start)} → ${wd(e.end)} ${hhmm(e.end)}`;
            };
            const dayText = d => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
            const warn = (...content) => h('div', { style: 'margin-bottom:10px;padding:6px 8px;background:#fff4d6;border:1px solid #e0b84c;border-radius:4px' }, ...content);
            const td = (content, extra = '') => h('td', { style: 'padding:3px 8px;' + extra }, content);
            const th = content => h('th', { style: 'padding:4px 8px' }, content);
            const btn = (label, onclick, extra = '') => h('button', { type: 'button', onclick, style: 'padding:6px 14px;cursor:pointer;' + extra }, label);

            const panel = h('div', { id: 'wmtt-export-panel', class: 'noprint',
                    style: 'margin:30px auto;text-align:left;padding:14px 16px;border:1px solid #9aa9bd;border-radius:6px;background:#f5f8fc;font:13px/1.4 Arial,sans-serif;max-width:760px' },
                h('div', { style: 'font-weight:bold;font-size:15px;margin-bottom:4px' }, 'Calendar export' + (payPeriod ? ' — ' + payPeriod : '')),
                h('div', { style: 'margin-bottom:10px;color:#333' }, `${events.length} days`,
                    totals.map(([hrs, label]) => [' · ', h('b', {}, String(num(hrs))), ` ${label}`])),
                unknown.length && warn(`⚠ Unrecognized code${unknown.length > 1 ? 's' : ''}: `,
                    h('b', {}, unknown.map(e => e.raw).join(', ')), ' — exported as all-day events.'),
                guessed.length && warn('⚠ Not in the Shift Legend: ', h('b', {}, guessed.map(e => e.raw).join(', ')),
                    ' — length estimated. Open ', h('i', {}, 'Views → Shift Legend'), ' once to update the shift list, then reload this page.'),
                !S.initials && warn('Tip: set your initials in WMTTools settings to put them in event titles.'),
                h('div', { style: 'margin-bottom:12px' },
                    btn('Download .ics', () => download(buildICS(events, payPeriod), baseName + '.ics', 'text/calendar;charset=utf-8'), 'font-weight:bold'),
                    btn('Download CSV', () => download(buildCSV(events), baseName + '.csv', 'text/csv;charset=utf-8'), 'margin-left:6px')),
                h('table', { style: 'border-collapse:collapse;width:100%;background:#fff' },
                    h('thead', {}, h('tr', { style: 'background:#e3eaf3;text-align:left' },
                        th('Day'), th('WMT code'), th('Calendar title'), th('Time'))),
                    h('tbody', {}, events.map(e => h('tr', { style: 'border-top:1px solid #e3e7ec' + (e.unknown || e.guessed ? ';background:#fff4d6' : '') },
                        td(dayText(e.date)), td(e.raw, 'font-family:monospace'), td(e.title), td(timeText(e)))))),
                h('div', { style: 'margin-top:8px;font-size:11px;color:#777' }, `Shift times from ${legend.source}.`));

            const anchor = table.parentElement && table.parentElement.tagName === 'DIV' ? table.parentElement : table;
            anchor.after(panel);
        }

        defineModule({
            id: 'calendarExport',
            name: 'Calendar export',
            description: 'My Schedule: preview your pay period and download it as .ics (Google, Outlook, Apple) or .csv. ' +
                         'Opening Views → Shift Legend saves the exact shift times it uses.',
            pages: [wmtPage('Views/MySchedule'), wmtPage('Views/ShiftLegend')],
            settings: [
                { key: 'midStartHour', label: 'MID starts at or after hour', type: 'number', default: 19, min: 0, max: 23, step: 1,
                  help: 'Shifts starting at this hour or later get the "MID" label. 19 also covers 1930 shifts.' },
                { key: 'midStartsPreviousDay', label: 'Put MIDs on the night you go in', type: 'checkbox', default: true,
                  help: 'WMT lists a MID on the day it ends (Monday 2330 = in Sunday night).' },
                { key: 'reminderMinutes', label: 'Reminder before shifts (minutes)', type: 'number', default: null, min: 0, step: 5,
                  placeholder: 'blank = no reminder' },
                { key: 'calendarName', label: 'Calendar name', type: 'text', default: 'WMT Schedule' },
            ],
            run(ctx) {
                S = Object.assign({}, ctx.settings, { initials: ctx.initials });
                if (wmtPage('Views/ShiftLegend').test(currentPage)) return saveLegendFromPage(ctx);

                const table = findScheduleTable();
                if (!table) throw new Error("couldn't find the schedule table. The WMT layout may have changed.");
                const legend = loadLegend(ctx);
                const events = readSchedule(table, legend);
                if (!events.length) throw new Error('found the schedule table, but no days in it could be read.');
                renderPanel(table, events, legend);
            },
        });
    }

    // ── Auto sign-in ───────────────────────────────────────────────────────────
    {
        // The FAA sign-in (MyAccess, built on Okta's sign-in widget) is one page
        // that redraws itself for each step:
        //   1. "Sign in using MyAccess"                   email → Next
        //   2. "Verify it's you with a security method"   Password → Select
        //   3. "Verify with your password"                password → Verify
        // Each new form is recognized by what's on it, not by order or by Okta's
        // numbered IDs (form19, input27, ...), which change between visits. Okta
        // skips step 1 when it remembers you and step 2 for some accounts; both are fine.
        const SEL = {
            gatekeeperButton: '#btnLogin',
            form: '#okta-sign-in form, form[data-se="o-form"]',
            email: 'input[name="identifier"], input[name="username"]',
            password: 'input[name="credentials.passcode"], input[name="password"]',
            authenticatorList: '.authenticator-list, .authenticator-verify-list',
            choosePassword: '[data-se="okta_password"] [data-se="button"], [data-se="okta_password"] .select-factor',
            submit: '.o-form-button-bar [type="submit"], [type="submit"]',
            error: '.o-form-error-container, .okta-form-infobox-error',
        };
        const GUARD_KEY = 'wmttLoginLastPasswordSubmit';   // sessionStorage, sign-in site only
        const GIVE_UP_SECONDS = 180;                         // stop watching the page after this

        const sleep = seconds => new Promise(r => setTimeout(r, seconds * 1000));
        const errorText = () => [...document.querySelectorAll(SEL.error)].map(textOf).find(Boolean) || '';

        // Sets a value so the sign-in widget notices the change
        function fill(input, value) {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
            for (const type of ['input', 'change']) input.dispatchEvent(new Event(type, { bubbles: true }));
        }

        async function click(el, ctx) {
            if (ctx.settings.delaySeconds) await sleep(ctx.settings.delaySeconds);
            el.click();
        }

        async function submit(form, ctx) {
            const button = form.querySelector(SEL.submit);
            if (!button) throw new Error("couldn't find the form's button.");
            await click(button, ctx);
        }

        // ---- The steps. Each returns a message to stop with, or nothing to carry on. ----
        const STEPS = [
            {
                label: 'password',
                matches: form => form.querySelector(SEL.password),
                async run(form, ctx) {
                    // Password page came back soon after a submit (e.g. after a reload):
                    // it was probably rejected. Don't retry, so the account can't lock.
                    const last = Number(sessionStorage.getItem(GUARD_KEY) || 0);
                    if (Date.now() - last < ctx.settings.retryGuardSeconds * 1000) {
                        return 'paused because the password page came back. If your password changed, update it in settings.';
                    }
                    const email = form.querySelector(SEL.email);   // some layouts ask for both at once
                    if (email && ctx.settings.email && email.value !== ctx.settings.email) fill(email, ctx.settings.email);
                    fill(form.querySelector(SEL.password), ctx.settings.password);
                    sessionStorage.setItem(GUARD_KEY, String(Date.now()));
                    await submit(form, ctx);
                },
            },
            {
                label: 'email',
                matches: form => form.querySelector(SEL.email),
                async run(form, ctx) {
                    const input = form.querySelector(SEL.email);
                    if (ctx.settings.email && input.value !== ctx.settings.email) fill(input, ctx.settings.email);
                    if (!input.value) return 'no sign-in email saved. Add it in settings.';
                    await submit(form, ctx);
                },
            },
            {
                label: 'security method',
                matches: form => form.querySelector(SEL.authenticatorList),
                async run(form, ctx) {
                    const choose = form.querySelector(SEL.choosePassword);
                    if (!choose) return 'Password isn\'t offered as a sign-in method here. Finish signing in yourself.';
                    await click(choose, ctx);
                },
            },
        ];

        // Watches the page and handles each new sign-in form once
        function runSignIn(ctx) {
            const handled = new WeakSet();   // forms already dealt with
            const done = new Set();          // steps already done on this page load
            let pending = 0, stopped = false;

            const stop = (message, kind = 'warn') => {
                if (stopped) return;
                stopped = true;
                observer.disconnect();
                clearTimeout(giveUp);
                if (message) ctx.notice(message, { kind, actions: [{ label: 'Settings', onClick: ui.openSettings }] });
            };

            const check = () => {
                if (stopped) return;
                // An error after one of our steps (wrong password, locked account, ...): stop
                const error = done.size && errorText();
                if (error) return stop(`stopped. The sign-in page says: "${error}"`);

                const form = document.querySelector(SEL.form);
                if (!form || handled.has(form)) return;
                const step = STEPS.find(s => s.matches(form));
                if (!step) return;                 // a step we don't handle (e.g. a code prompt): leave it to the user
                handled.add(form);
                if (done.has(step.label)) return stop(`stopped because the ${step.label} step came back. Finish signing in yourself.`);
                done.add(step.label);
                ctx.log(`step: ${step.label}`);
                Promise.resolve(step.run(form, ctx))
                    .then(message => message && stop(message))
                    .catch(err => stop(err.message, 'error'));
            };

            // Let each redraw settle before looking at it
            const observer = new MutationObserver(() => { clearTimeout(pending); pending = setTimeout(check, 150); });
            observer.observe(document.documentElement, { childList: true, subtree: true });
            const giveUp = setTimeout(() => stop(), GIVE_UP_SECONDS * 1000);
            check();
        }

        defineModule({
            id: 'autoLogin',
            name: 'Auto sign-in',
            description: 'Clicks through the WMT warning page and fills in the FAA sign-in pages. ' +
                         'Your password is saved unencrypted in your userscript manager\'s storage on this computer.',
            pages: [wmtPage('gatekeeper'), hostPage(LOGIN_HOST)],
            defaultEnabled: false,
            settings: [
                { key: 'email', label: 'Sign-in email', type: 'text', default: '' },
                { key: 'password', label: 'Password', type: 'password', default: '' },
                { key: 'delaySeconds', label: 'Pause before each click (seconds)', type: 'number', default: 0, min: 0, step: 1,
                  help: 'Raise it if you get "HTTP Status 400 – Bad Request".' },
                { key: 'retryGuardSeconds', label: 'Stop retrying for (seconds)', type: 'number', default: 120, min: 0, step: 10,
                  help: 'If the password page returns this soon after a submit, don\'t try again.' },
            ],
            async run(ctx) {
                if (currentHost === WMT_HOST) {   // WMT's warning page: click Login
                    const btn = await waitFor(SEL.gatekeeperButton, 10);
                    if (btn) await click(btn, ctx);
                    return;
                }
                if (!ctx.settings.password) {
                    ctx.notice('no password saved yet.', { kind: 'warn', actions: [{ label: 'Settings', onClick: ui.openSettings }] });
                    return;
                }
                runSignIn(ctx);
            },
        });
    }

    // ══════════════════════════════════════════════════════════════════════
    //  4. START
    // ══════════════════════════════════════════════════════════════════════

    function start() {
        ui.injectStyles();
        addMenuCommand(`${APP_NAME} settings`, ui.openSettings);

        if (onWmt) {
            ui.addMenuLink();
            // First run: ask for initials until set or dismissed
            if (!getInitials() && !store.get('ui.initialsHintDismissed', false) && document.getElementById('chromemenu')) {
                ui.notice(`${APP_NAME}: set your initials to turn on highlighting.`, {
                    actions: [{ label: 'Open settings', onClick: ui.openSettings }],
                    onDismiss: () => store.set('ui.initialsHintDismissed', true),
                });
            }
        }
        runModules();
    }

    start();
})();
