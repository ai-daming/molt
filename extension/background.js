/**
 * background.js — Service Worker for Badge Updates
 *
 * Chrome's "always-on" background script for Tab Out.
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
  const url = chrome.runtime.getURL('index.html');
  const existing = await chrome.tabs.query({ url });

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

// ─── Event listeners ──────────────────────────────────────────────────────────

// Update badge when the extension is first installed
chrome.runtime.onInstalled.addListener(() => {
  updateBadge();
});

// Update badge when Chrome starts up
chrome.runtime.onStartup.addListener(() => {
  updateBadge();
});

// Update badge whenever a tab is opened
chrome.tabs.onCreated.addListener(() => {
  updateBadge();
});

// Update badge whenever a tab is closed
chrome.tabs.onRemoved.addListener(() => {
  updateBadge();
});

// Update badge when a tab's URL changes (e.g. navigating to/from chrome://)
chrome.tabs.onUpdated.addListener(() => {
  updateBadge();
});

// ─── Initial run ─────────────────────────────────────────────────────────────

// Run once immediately when the service worker first loads
updateBadge();
