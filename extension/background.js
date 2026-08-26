/**
 * background.js — Service Worker for Badge Updates
 *
 * Chrome's "always-on" background script for Molt.
 * Its only job: keep the toolbar badge showing the current open tab count.
 *
 * Since we no longer have a server, we query chrome.tabs directly.
 * The badge counts real web tabs (skipping chrome:// and extension pages).
 *
 * Color coding gives a quick at-a-glance health signal:
 *   Green  (#3d7a4a) → 1–10 tabs  (focused, manageable)
 *   Amber  (#b8892e) → 11–20 tabs (getting busy)
 *   Red    (#b35a5a) → 21+ tabs   (time to cull!)
 */

// ─── Badge updater ────────────────────────────────────────────────────────────

/**
 * updateBadge()
 *
 * Counts open real-web tabs and updates the extension's toolbar badge.
 * "Real" tabs = not chrome://, not extension pages, not about:blank.
 */
async function updateBadge() {
  try {
    const tabs = await chrome.tabs.query({});

    // Only count actual web pages — skip browser internals and extension pages
    const count = tabs.filter(t => {
      const url = t.url || '';
      return (
        !url.startsWith('chrome://') &&
        !url.startsWith('chrome-extension://') &&
        !url.startsWith('about:') &&
        !url.startsWith('edge://') &&
        !url.startsWith('brave://')
      );
    }).length;

    // Don't show "0" — an empty badge is cleaner
    await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });

    if (count === 0) return;

    // Pick badge color based on workload level
    let color;
    if (count <= 10) {
      color = '#3d7a4a'; // Green — you're in control
    } else if (count <= 20) {
      color = '#b8892e'; // Amber — things are piling up
    } else {
      color = '#b35a5a'; // Red — time to focus and close some tabs
    }

    await chrome.action.setBadgeBackgroundColor({ color });

  } catch {
    // If something goes wrong, clear the badge rather than show stale data
    chrome.action.setBadgeText({ text: '' });
  }
}

// ─── Toolbar icon / keyboard entry ────────────────────────────────────────────

/**
 * focusOrOpenDashboard()
 *
 * Clicking the toolbar icon (or pressing Alt+T) summons the dashboard.
 * Focuses an existing dashboard tab if one is already open — an anti-hoarding
 * tool must not manufacture duplicate tabs of its own.
 */
async function focusOrOpenDashboard() {
  // ?entry=icon marks an explicit open (vs. a new-tab override load), so the
  // dashboard renders even when the user has disabled new tab takeover.
  const url = chrome.runtime.getURL('index.html?entry=icon');
  // Trailing '*' also matches plain /index.html (new-tab override instances)
  const existing = await chrome.tabs.query({ url: url.replace('index.html?entry=icon', 'index.html*') });

  if (existing.length > 0) {
    // Prefer a dashboard tab in the window the user is looking at
    const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
    const target = existing.find(t => t.windowId === current?.windowId) || existing[0];
    await chrome.tabs.update(target.id, { active: true });
    if (target.windowId !== chrome.windows.WINDOW_ID_NONE) {
      await chrome.windows.update(target.windowId, { focused: true });
    }
    return;
  }

  await chrome.tabs.create({ url });
}

// Toolbar icon click — fires because no default_popup is set on the action
chrome.action.onClicked.addListener(focusOrOpenDashboard);

// Alt+T — bound via "commands" in manifest.json (rebindable at chrome://extensions/shortcuts)
chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-dashboard') focusOrOpenDashboard();
});

// ─── Session snapshots (issue #1) ─────────────────────────────────────────────

/**
 * Event-driven snapshots of all open tabs, kept in chrome.storage.local.
 * Listeners are registered at the top level, so MV3 waking the service
 * worker after it has been recycled re-registers them — snapshots keep
 * working across service-worker shutdowns.
 */
const SNAPSHOT_KEY       = 'sessionSnapshots';
const SNAPSHOT_THROTTLE  = 10 * 1000; // merge bursts of tab changes
const SNAPSHOT_MAX_COUNT = 400;

let snapTrailingTimer = null;
let snapLastWrite     = 0;

function isRealWebTab(t) {
  const url = t.url || '';
  return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('file://');
}

// Content signature: identical consecutive states are not stored twice.
// windowId is deliberately excluded — it changes every browser restart.
function snapSignature(tabs) {
  return tabs.map(t => `${t.pinned ? 'p' : '-'}|${t.url}`).sort().join('\n');
}

async function captureSnapshot() {
  try {
    const all = await chrome.tabs.query({});
    const real = all
      .filter(isRealWebTab)
      .map(t => ({
        url: t.url, title: t.title || '', pinned: !!t.pinned,
        windowId: t.windowId, index: t.index,
      }))
      .sort((a, b) => a.index - b.index);
    if (real.length === 0) return;

    const { [SNAPSHOT_KEY]: data = {} } = await chrome.storage.local.get(SNAPSHOT_KEY);
    const snaps = data.snapshots || [];
    const sig = snapSignature(real);
    if (snaps.length > 0 && snaps[snaps.length - 1].sig === sig) {
      snapLastWrite = Date.now();
      return;
    }

    snaps.push({
      id: nowISO(),
      sig,
      windows: new Set(real.map(t => t.windowId)).size,
      tabs: real,
    });
    await chrome.storage.local.set({ [SNAPSHOT_KEY]: { snapshots: applyRetention(snaps) } });
    snapLastWrite = Date.now();
  } catch {
    // A failed snapshot must never interfere with anything else
  }
}

// Keep everything from the last 48 h, then one snapshot per day, capped.
function applyRetention(snaps) {
  const cutoff = Date.now() - 48 * 3600 * 1000;
  const recent = snaps.filter(s => +new Date(s.id) >= cutoff);
  const older  = snaps.filter(s => +new Date(s.id) < cutoff);
  const lastPerDay = new Map(); // snaps are chronological — last write wins
  for (const s of older) lastPerDay.set(s.id.slice(0, 10), s);
  const kept = [...recent, ...lastPerDay.values()];
  return kept.length > SNAPSHOT_MAX_COUNT
    ? kept.slice(kept.length - SNAPSHOT_MAX_COUNT)
    : kept;
}

function nowISO() { return new Date().toISOString(); }

/**
 * Leading + trailing throttle. The leading edge matters for disaster
 * recovery: when a burst of closes starts ("Close all 87 tabs"), we
 * snapshot right away — capturing the near-pre-disaster state — and the
 * trailing edge records the settled state once things go quiet.
 */
function scheduleSnapshot() {
  if (Date.now() - snapLastWrite >= SNAPSHOT_THROTTLE) {
    captureSnapshot();
  } else {
    clearTimeout(snapTrailingTimer);
    snapTrailingTimer = setTimeout(captureSnapshot, SNAPSHOT_THROTTLE);
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────────

// Update badge + snapshot when the extension is first installed
chrome.runtime.onInstalled.addListener(() => {
  updateBadge();
  scheduleSnapshot();
});

// Update badge + snapshot when Chrome starts up
chrome.runtime.onStartup.addListener(() => {
  updateBadge();
  scheduleSnapshot();
});

// Update badge + snapshot whenever a tab is opened
chrome.tabs.onCreated.addListener(() => {
  updateBadge();
  scheduleSnapshot();
});

// Update badge + snapshot whenever a tab is closed
chrome.tabs.onRemoved.addListener(() => {
  updateBadge();
  scheduleSnapshot();
});

// Update badge + snapshot when a tab's URL changes (e.g. navigating to/from chrome://)
chrome.tabs.onUpdated.addListener(() => {
  updateBadge();
  scheduleSnapshot();
});

// ─── Initial run ─────────────────────────────────────────────────────────────

// Run once immediately when the service worker first loads
updateBadge();
