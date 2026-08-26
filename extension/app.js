/* ================================================================
   Molt — Dashboard App (Pure Extension Edition)

   This file is the brain of the dashboard. Now that the dashboard
   IS the extension page (not inside an iframe), it can call
   chrome.tabs and chrome.storage directly — no postMessage bridge needed.

   What this file does:
   1. Reads open browser tabs directly via chrome.tabs.query()
   2. Groups tabs by domain with a landing pages category
   3. Renders domain cards, banners, and stats
   4. Handles all user actions (close tabs, save for later, focus tab)
   5. Stores "Saved for Later" tabs in chrome.storage.local (no server)
   ================================================================ */

'use strict';


/* ----------------------------------------------------------------
   CHROME TABS — Direct API Access

   Since this page IS the extension's new tab page, it has full
   access to chrome.tabs and chrome.storage. No middleman needed.
   ---------------------------------------------------------------- */

// All open tabs — populated by fetchOpenTabs()
let openTabs = [];

// URLs the user locked against bulk-closing (issue #8). In-memory mirror of
// the "lockedTabs" string array in chrome.storage.local, keyed by exact URL.
let lockedUrls = new Set();

/**
 * loadLockedTabs()
 *
 * Refreshes the in-memory lock set from chrome.storage.local. Cheap enough
 * to call before every mutation, so two dashboards open at once still agree.
 */
async function loadLockedTabs() {
  try {
    const { lockedTabs = [] } = await chrome.storage.local.get('lockedTabs');
    lockedUrls = new Set(lockedTabs);
  } catch {
    // Storage unavailable — keep whatever we had; locks just won't refresh
  }
}

// Native Chrome tab-group metadata (issue #5): id → {title, color}.
// Refreshed on every tab sweep; renders read it for chip badges.
let tabGroupMeta = new Map();

async function loadTabGroupMeta() {
  try {
    const groups = await chrome.tabGroups.query({});
    tabGroupMeta = new Map(groups.map(g => [g.id, g]));
  } catch {
    // tabGroups API unavailable — chips just won't show group badges
  }
}

// Chrome's nine native group colors as CSS-friendly hex approximations
const GROUP_COLOR_HEX = {
  grey:   '#9aa0a6',
  blue:   '#8ab4f8',
  red:    '#f28b82',
  yellow: '#fdd663',
  green:  '#81c995',
  pink:   '#f88bbd',
  purple: '#c58af9',
  cyan:   '#78d9ec',
  orange: '#fcad70',
};
const GROUP_COLOR_NAMES = Object.keys(GROUP_COLOR_HEX);

/** Small stable hash so a domain always picks the same group color. */
function stringHash(str) {
  let h = 0;
  for (const c of String(str || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

// Browser-builtin new-tab URLs across Chromium variants (Chrome, Edge,
// Brave). The extension page URL itself is also treated as Tab Out.
const BROWSER_NEWTAB_URLS = [
  'chrome://newtab/',
  'edge://newtab/',
  'brave://newtab/',
  'about:newtab',
];

/**
 * fetchOpenTabs()
 *
 * Reads all currently open browser tabs directly from Chrome.
 * Sets the extensionId flag so we can identify Tab Out's own pages.
 */
async function fetchOpenTabs() {
  // Refresh the lock set + native-group metadata on every tab sweep —
  // renders downstream read `lockedUrls` and `tabGroupMeta` for chip state.
  await Promise.all([loadLockedTabs(), loadTabGroupMeta()]);
  try {
    const extensionId = chrome.runtime.id;
    // The new URL for this page is now index.html (not newtab.html)
    const newtabUrl = `chrome-extension://${extensionId}/index.html`;

    const tabs = await chrome.tabs.query({});
    openTabs = tabs.map(t => ({
      id:       t.id,
      url:      t.url,
      title:    t.title,
      windowId: t.windowId,
      active:   t.active,
      audible:  !!t.audible,
      muted:    !!(t.mutedInfo && t.mutedInfo.muted),
      groupId:  typeof t.groupId === 'number' ? t.groupId : -1,
      // Flag Tab Out's own pages so we can detect duplicate new tabs
      isTabOut: t.url === newtabUrl || BROWSER_NEWTAB_URLS.includes(t.url),
    }));
  } catch {
    // chrome.tabs API unavailable (shouldn't happen in an extension page)
    openTabs = [];
  }
}

/**
 * groupBadgeHtml(tab)
 *
 * Colored-dot + name pill for chips that belong to a native Chrome
 * tab group. Untitled groups show just the dot.
 */
function groupBadgeHtml(tab) {
  const g = tab.groupId !== -1 ? tabGroupMeta.get(tab.groupId) : null;
  if (!g) return '';
  const color = GROUP_COLOR_HEX[g.color] || GROUP_COLOR_HEX.grey;
  const name = g.title ? escapeHtml(g.title) : '';
  return `<span class="chip-group-badge" title="${name}"><span class="chip-group-dot" style="background:${color}"></span><span class="chip-group-name">${name}</span></span>`;
}

/**
 * closeTabsByUrls(urls)
 *
 * Closes open tabs that exactly match one of the given URLs.
 *
 * Previously this matched by hostname, which would also close tabs the
 * user never saw — e.g. closing a domain card would take down the
 * corresponding homepage tab that had been split into the Homepages
 * group. Exact-URL matching keeps the action scoped to what the card
 * actually shows and still closes every duplicate tab for each URL.
 *
 * Locked URLs (issue #8) are always skipped, and the caller gets back
 * how many tabs were closed vs. locked so toasts can say so.
 */
async function closeTabsByUrls(urls) {
  if (!urls || urls.length === 0) return { closed: 0, skipped: 0 };
  await loadLockedTabs();
  const urlSet = new Set(urls);
  const allTabs = await chrome.tabs.query({});
  const matching = allTabs.filter(t => urlSet.has(t.url));
  const closable = matching.filter(t => !lockedUrls.has(t.url));
  if (closable.length > 0) {
    await chrome.tabs.remove(closable.map(t => t.id));
  }
  await fetchOpenTabs();
  return { closed: closable.length, skipped: matching.length - closable.length };
}

/**
 * focusTab(url)
 *
 * Switches Chrome to the tab with the given URL (exact match first,
 * then hostname fallback). Also brings the window to the front.
 */
async function focusTab(url) {
  if (!url) return;
  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();

  // Try exact URL match first
  let matches = allTabs.filter(t => t.url === url);

  // Fall back to hostname match
  if (matches.length === 0) {
    try {
      const targetHost = new URL(url).hostname;
      matches = allTabs.filter(t => {
        try { return new URL(t.url).hostname === targetHost; }
        catch { return false; }
      });
    } catch {}
  }

  if (matches.length === 0) return;

  // Prefer a match in a different window so it actually switches windows
  const match = matches.find(t => t.windowId !== currentWindow.id) || matches[0];
  await chrome.tabs.update(match.id, { active: true });
  await chrome.windows.update(match.windowId, { focused: true });
}

/**
 * closeDuplicateTabs(urls, keepOne)
 *
 * Closes duplicate tabs for the given list of URLs.
 * keepOne=true → keep one copy of each, close the rest.
 * keepOne=false → close all copies.
 *
 * Locked URLs are never closed (issue #8). When keeping one copy we
 * prefer an unlocked tab as the survivor so a locked page can end up
 * duplicated rather than a copy being destroyed.
 */
async function closeDuplicateTabs(urls, keepOne = true) {
  await loadLockedTabs();
  const allTabs = await chrome.tabs.query({});
  const toClose = [];
  let skipped = 0;

  for (const url of urls) {
    const matching  = allTabs.filter(t => t.url === url);
    const unlockedC = matching.filter(t => !lockedUrls.has(t.url));
    if (keepOne) {
      const keep = unlockedC.find(t => t.active) || unlockedC[0] || matching[0];
      for (const tab of matching) {
        if (tab.id === keep.id) continue;
        if (lockedUrls.has(tab.url)) { skipped++; continue; }
        toClose.push(tab.id);
      }
    } else {
      for (const tab of matching) {
        if (lockedUrls.has(tab.url)) { skipped++; continue; }
        toClose.push(tab.id);
      }
    }
  }

  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
  return { closed: toClose.length, skipped };
}

/**
 * closeTabOutDupes()
 *
 * Closes all duplicate Tab Out new-tab pages except the current one.
 */
async function closeTabOutDupes() {
  const extensionId = chrome.runtime.id;
  const newtabUrl = `chrome-extension://${extensionId}/index.html`;

  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();
  const tabOutTabs = allTabs.filter(t =>
    t.url === newtabUrl || BROWSER_NEWTAB_URLS.includes(t.url)
  );

  if (tabOutTabs.length <= 1) return;

  // Keep the active Tab Out tab in the CURRENT window — that's the one the
  // user is looking at right now. Falls back to any active one, then the first.
  const keep =
    tabOutTabs.find(t => t.active && t.windowId === currentWindow.id) ||
    tabOutTabs.find(t => t.active) ||
    tabOutTabs[0];
  const toClose = tabOutTabs.filter(t => t.id !== keep.id).map(t => t.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}


/* ----------------------------------------------------------------
   THEME SWITCHER

   Four color palettes the user can cycle through (warm / midnight /
   arctic / forest). The active theme is written to localStorage and
   re-applied on load by theme-init.js before the body paints, so the
   page doesn't flash the default palette. This function only has to
   sync the DOM state and the pressed-button indicator.
   ---------------------------------------------------------------- */
const THEMES = ['warm', 'midnight', 'arctic', 'forest'];
const THEME_STORAGE_KEY = 'tab-out-theme';

function getActiveTheme() {
  const t = document.documentElement.dataset.theme;
  return THEMES.includes(t) ? t : 'warm';
}

function applyTheme(name, { save = false } = {}) {
  if (!THEMES.includes(name)) return;
  document.documentElement.dataset.theme = name;
  if (save) {
    try { localStorage.setItem(THEME_STORAGE_KEY, name); } catch {}
  }
  document.querySelectorAll('.theme-btn[data-theme-name]').forEach(btn => {
    btn.setAttribute('aria-pressed', btn.dataset.themeName === name ? 'true' : 'false');
  });
}

function initThemeSwitcher() {
  applyTheme(getActiveTheme(), { save: false });

  // Follow OS light/dark switches live — but only while the user hasn't
  // picked a theme manually (a stored choice wins permanently).
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onSchemeChange = () => {
      let stored = null;
      try { stored = localStorage.getItem(THEME_STORAGE_KEY); } catch {}
      if (!stored) applyTheme(mq.matches ? 'midnight' : 'warm', { save: false });
    };
    if (mq.addEventListener) mq.addEventListener('change', onSchemeChange);
    else if (mq.addListener) mq.addListener(onSchemeChange); // older Chrome
  }
}


/* ----------------------------------------------------------------
   SAVED FOR LATER — chrome.storage.local

   Replaces the old server-side SQLite + REST API with Chrome's
   built-in key-value storage. Data persists across browser sessions
   and doesn't require a running server.

   Data shape stored under the "deferred" key:
   [
     {
       id: "1712345678901",          // timestamp-based unique ID
       url: "https://example.com",
       title: "Example Page",
       savedAt: "2026-04-04T10:00:00.000Z",  // ISO date string
       completed: false,             // true = checked off (archived)
       dismissed: false              // true = dismissed without reading
     },
     ...
   ]
   ---------------------------------------------------------------- */

/**
 * saveTabForLater(tab)
 *
 * Saves a single tab to the "Saved for Later" list in chrome.storage.local.
 * @param {{ url: string, title: string }} tab
 */
async function saveTabForLater(tab) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  deferred.push({
    id:        Date.now().toString(),
    url:       tab.url,
    title:     tab.title,
    savedAt:   new Date().toISOString(),
    completed: false,
    dismissed: false,
  });
  await chrome.storage.local.set({ deferred });
}

/**
 * getSavedTabs()
 *
 * Returns all saved tabs from chrome.storage.local.
 * Filters out dismissed items (those are gone for good).
 * Splits into active (not completed) and archived (completed).
 */
async function getSavedTabs() {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const visible = deferred.filter(t => !t.dismissed);
  return {
    active:   visible.filter(t => !t.completed),
    archived: visible.filter(t => t.completed),
  };
}

/**
 * checkOffSavedTab(id)
 *
 * Marks a saved tab as completed (checked off). It moves to the archive.
 */
async function checkOffSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) {
    tab.completed = true;
    tab.completedAt = new Date().toISOString();
    await chrome.storage.local.set({ deferred });
  }
}

/**
 * dismissSavedTab(id)
 *
 * Marks a saved tab as dismissed (removed from all lists).
 */
async function dismissSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) {
    tab.dismissed = true;
    await chrome.storage.local.set({ deferred });
  }
}


/* ----------------------------------------------------------------
   UI HELPERS
   ---------------------------------------------------------------- */

/**
 * playCloseSound()
 *
 * Plays a clean "swoosh" sound when tabs are closed.
 * Built entirely with the Web Audio API — no sound files needed.
 * A filtered noise sweep that descends in pitch, like air moving.
 */
function playCloseSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;

    // Swoosh: shaped white noise through a sweeping bandpass filter
    const duration = 0.25;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Generate noise with a natural envelope (quick attack, smooth decay)
    for (let i = 0; i < data.length; i++) {
      const pos = i / data.length;
      // Envelope: ramps up fast in first 10%, then fades out smoothly
      const env = pos < 0.1 ? pos / 0.1 : Math.pow(1 - (pos - 0.1) / 0.9, 1.5);
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Bandpass filter sweeps from high to low — creates the "swoosh" character
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2.0;
    filter.frequency.setValueAtTime(4000, t);
    filter.frequency.exponentialRampToValueAtTime(400, t + duration);

    // Volume
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(t);

    setTimeout(() => ctx.close(), 500);
  } catch {
    // Audio not supported — fail silently
  }
}

/**
 * shootConfetti(x, y)
 *
 * Shoots a burst of colorful confetti particles from the given screen
 * coordinates (typically the center of a card being closed).
 * Pure CSS + JS, no libraries.
 */
function shootConfetti(x, y) {
  const colors = [
    '#c8713a', // amber
    '#e8a070', // amber light
    '#5a7a62', // sage
    '#8aaa92', // sage light
    '#5a6b7a', // slate
    '#8a9baa', // slate light
    '#d4b896', // warm paper
    '#b35a5a', // rose
  ];

  const particleCount = 17;

  for (let i = 0; i < particleCount; i++) {
    const el = document.createElement('div');

    const isCircle = Math.random() > 0.5;
    const size = 5 + Math.random() * 6; // 5–11px
    const color = colors[Math.floor(Math.random() * colors.length)];

    el.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border-radius: ${isCircle ? '50%' : '2px'};
      pointer-events: none;
      z-index: 9999;
      transform: translate(-50%, -50%);
      opacity: 1;
    `;
    document.body.appendChild(el);

    // Physics: random angle and speed for the outward burst
    const angle   = Math.random() * Math.PI * 2;
    const speed   = 60 + Math.random() * 120;
    const vx      = Math.cos(angle) * speed;
    const vy      = Math.sin(angle) * speed - 80; // bias upward
    const gravity = 200;

    const startTime = performance.now();
    const duration  = 700 + Math.random() * 200; // 700–900ms

    function frame(now) {
      const elapsed  = (now - startTime) / 1000;
      const progress = elapsed / (duration / 1000);

      if (progress >= 1) { el.remove(); return; }

      const px = vx * elapsed;
      const py = vy * elapsed + 0.5 * gravity * elapsed * elapsed;
      const opacity = progress < 0.5 ? 1 : 1 - (progress - 0.5) * 2;
      const rotate  = elapsed * 200 * (isCircle ? 0 : 1);

      el.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px)) rotate(${rotate}deg)`;
      el.style.opacity = opacity;

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }
}

/**
 * animateCardOut(card)
 *
 * Smoothly removes a mission card: fade + scale down, then confetti.
 * After the animation, checks if the grid is now empty.
 */
function animateCardOut(card) {
  if (!card) return;

  const rect = card.getBoundingClientRect();
  shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);

  card.classList.add('closing');
  setTimeout(() => {
    card.remove();
    checkAndShowEmptyState();
  }, 300);
}

/**
 * showToast(message)
 *
 * Brief pop-up notification at the bottom of the screen.
 */
function showToast(message) {
  const toast = document.getElementById('toast');
  document.getElementById('toastText').textContent = message;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2500);
}

/**
 * checkAndShowEmptyState()
 *
 * Shows a cheerful "Inbox zero" message when all domain cards are gone.
 */
function checkAndShowEmptyState() {
  const missionsEl = document.getElementById('openTabsMissions');
  if (!missionsEl) return;

  const remaining = missionsEl.querySelectorAll('.mission-card:not(.closing)').length;
  if (remaining > 0) return;

  missionsEl.innerHTML = `
    <div class="missions-empty-state">
      <div class="empty-checkmark">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      </div>
      <div class="empty-title">${escapeHtml(t('empty.checkmarkTitle'))}</div>
      <div class="empty-subtitle">${escapeHtml(t('empty.checkmarkSub'))}</div>
    </div>
  `;

  const countEl = document.getElementById('openTabsSectionCount');
  if (countEl) countEl.textContent = t('empty.zeroDomains');
}

/**
 * timeAgo(dateStr)
 *
 * Converts an ISO date string into a human-friendly relative time.
 * "2026-04-04T10:00:00Z" → "2 hrs ago" or "yesterday"
 */
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const then = new Date(dateStr);
  const now  = new Date();
  const diffMins  = Math.floor((now - then) / 60000);
  const diffHours = Math.floor((now - then) / 3600000);
  const diffDays  = Math.floor((now - then) / 86400000);

  if (diffMins < 1)   return t('time.justNow');
  if (diffMins < 60)  return t('time.minAgo', { n: diffMins });
  if (diffHours < 24) return tCount('time.hrAgo', diffHours);
  if (diffDays === 1) return t('time.yesterday');
  return t('time.daysAgo', { n: diffDays });
}

/**
 * getGreeting() — "Good morning / afternoon / evening"
 */
function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return t('greeting.morning');
  if (hour < 17) return t('greeting.afternoon');
  return t('greeting.evening');
}

/**
 * getDateDisplay() — "Friday, April 4, 2026"
 */
function getDateDisplay() {
  return new Date().toLocaleDateString(I18N.locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
    weekday: 'long',
    year:    'numeric',
    month:   'long',
    day:     'numeric',
  });
}


/* ----------------------------------------------------------------
   HTML ESCAPE — prevents XSS when tab titles/URLs are injected into
   innerHTML. Tab titles come from arbitrary web pages, so they must
   be treated as untrusted input.
   ---------------------------------------------------------------- */
function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Only allow http/https/file as href targets, so a saved tab with a
// javascript: URL can't execute script when clicked.
function isSafeNavUrl(url) {
  if (!url) return false;
  try {
    const scheme = new URL(url).protocol;
    return scheme === 'http:' || scheme === 'https:' || scheme === 'file:';
  } catch {
    return false;
  }
}


/* ----------------------------------------------------------------
   DOMAIN & TITLE CLEANUP HELPERS
   ---------------------------------------------------------------- */

// Map of known hostnames → friendly display names.
const FRIENDLY_DOMAINS = {
  'github.com':           'GitHub',
  'www.github.com':       'GitHub',
  'gist.github.com':      'GitHub Gist',
  'youtube.com':          'YouTube',
  'www.youtube.com':      'YouTube',
  'music.youtube.com':    'YouTube Music',
  'x.com':                'X',
  'www.x.com':            'X',
  'twitter.com':          'X',
  'www.twitter.com':      'X',
  'reddit.com':           'Reddit',
  'www.reddit.com':       'Reddit',
  'old.reddit.com':       'Reddit',
  'substack.com':         'Substack',
  'www.substack.com':     'Substack',
  'medium.com':           'Medium',
  'www.medium.com':       'Medium',
  'linkedin.com':         'LinkedIn',
  'www.linkedin.com':     'LinkedIn',
  'stackoverflow.com':    'Stack Overflow',
  'www.stackoverflow.com':'Stack Overflow',
  'news.ycombinator.com': 'Hacker News',
  'google.com':           'Google',
  'www.google.com':       'Google',
  'mail.google.com':      'Gmail',
  'docs.google.com':      'Google Docs',
  'drive.google.com':     'Google Drive',
  'calendar.google.com':  'Google Calendar',
  'meet.google.com':      'Google Meet',
  'gemini.google.com':    'Gemini',
  'chatgpt.com':          'ChatGPT',
  'www.chatgpt.com':      'ChatGPT',
  'chat.openai.com':      'ChatGPT',
  'claude.ai':            'Claude',
  'www.claude.ai':        'Claude',
  'code.claude.com':      'Claude Code',
  'notion.so':            'Notion',
  'www.notion.so':        'Notion',
  'figma.com':            'Figma',
  'www.figma.com':        'Figma',
  'slack.com':            'Slack',
  'app.slack.com':        'Slack',
  'discord.com':          'Discord',
  'www.discord.com':      'Discord',
  'wikipedia.org':        'Wikipedia',
  'en.wikipedia.org':     'Wikipedia',
  'amazon.com':           'Amazon',
  'www.amazon.com':       'Amazon',
  'netflix.com':          'Netflix',
  'www.netflix.com':      'Netflix',
  'spotify.com':          'Spotify',
  'open.spotify.com':     'Spotify',
  'vercel.com':           'Vercel',
  'www.vercel.com':       'Vercel',
  'npmjs.com':            'npm',
  'www.npmjs.com':        'npm',
  'developer.mozilla.org':'MDN',
  'arxiv.org':            'arXiv',
  'www.arxiv.org':        'arXiv',
  'huggingface.co':       'Hugging Face',
  'www.huggingface.co':   'Hugging Face',
  'producthunt.com':      'Product Hunt',
  'www.producthunt.com':  'Product Hunt',
  'xiaohongshu.com':      'RedNote',
  'www.xiaohongshu.com':  'RedNote',
  'local-files':          'Local Files',
};

function friendlyDomain(hostname) {
  if (!hostname) return '';
  if (FRIENDLY_DOMAINS[hostname]) return FRIENDLY_DOMAINS[hostname];

  if (hostname.endsWith('.substack.com') && hostname !== 'substack.com') {
    return capitalize(hostname.replace('.substack.com', '')) + "'s Substack";
  }
  if (hostname.endsWith('.github.io')) {
    return capitalize(hostname.replace('.github.io', '')) + ' (GitHub Pages)';
  }

  let clean = hostname
    .replace(/^www\./, '')
    .replace(/\.(com|org|net|io|co|ai|dev|app|so|me|xyz|info|us|uk|co\.uk|co\.jp)$/, '');

  return clean.split('.').map(part => capitalize(part)).join(' ');
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function stripTitleNoise(title) {
  if (!title) return '';
  // Strip leading notification count: "(2) Title"
  title = title.replace(/^\(\d+\+?\)\s*/, '');
  // Strip inline counts like "Inbox (16,359)"
  title = title.replace(/\s*\([\d,]+\+?\)\s*/g, ' ');
  // Strip email addresses (privacy + cleaner display)
  title = title.replace(/\s*[\-\u2010-\u2015]\s*[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  title = title.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  // Clean X/Twitter format
  title = title.replace(/\s+on X:\s*/, ': ');
  title = title.replace(/\s*\/\s*X\s*$/, '');
  return title.trim();
}

function cleanTitle(title, hostname) {
  if (!title || !hostname) return title || '';

  const friendly = friendlyDomain(hostname);
  const domain   = hostname.replace(/^www\./, '');
  const seps     = [' - ', ' | ', ' — ', ' · ', ' – '];

  for (const sep of seps) {
    const idx = title.lastIndexOf(sep);
    if (idx === -1) continue;
    const suffix     = title.slice(idx + sep.length).trim();
    const suffixLow  = suffix.toLowerCase();
    if (
      suffixLow === domain.toLowerCase() ||
      suffixLow === friendly.toLowerCase() ||
      suffixLow === domain.replace(/\.\w+$/, '').toLowerCase() ||
      domain.toLowerCase().includes(suffixLow) ||
      friendly.toLowerCase().includes(suffixLow)
    ) {
      const cleaned = title.slice(0, idx).trim();
      if (cleaned.length >= 5) return cleaned;
    }
  }
  return title;
}

function smartTitle(title, url) {
  if (!url) return title || '';
  let pathname = '', hostname = '';
  try { const u = new URL(url); pathname = u.pathname; hostname = u.hostname; }
  catch { return title || ''; }

  const titleIsUrl = !title || title === url || title.startsWith(hostname) || title.startsWith('http');

  if ((hostname === 'x.com' || hostname === 'twitter.com' || hostname === 'www.x.com') && pathname.includes('/status/')) {
    const username = pathname.split('/')[1];
    if (username) return titleIsUrl ? `Post by @${username}` : title;
  }

  if (hostname === 'github.com' || hostname === 'www.github.com') {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const [owner, repo, ...rest] = parts;
      if (rest[0] === 'issues' && rest[1]) return `${owner}/${repo} Issue #${rest[1]}`;
      if (rest[0] === 'pull'   && rest[1]) return `${owner}/${repo} PR #${rest[1]}`;
      if (rest[0] === 'blob' || rest[0] === 'tree') return `${owner}/${repo} — ${rest.slice(2).join('/')}`;
      if (titleIsUrl) return `${owner}/${repo}`;
    }
  }

  if ((hostname === 'www.youtube.com' || hostname === 'youtube.com') && pathname === '/watch') {
    if (titleIsUrl) return 'YouTube Video';
  }

  if ((hostname === 'www.reddit.com' || hostname === 'reddit.com' || hostname === 'old.reddit.com') && pathname.includes('/comments/')) {
    const parts  = pathname.split('/').filter(Boolean);
    const subIdx = parts.indexOf('r');
    if (subIdx !== -1 && parts[subIdx + 1]) {
      if (titleIsUrl) return `r/${parts[subIdx + 1]} post`;
    }
  }

  return title || url;
}


/* ----------------------------------------------------------------
   SVG ICON STRINGS
   ---------------------------------------------------------------- */
const ICONS = {
  tabs:    `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8.25V18a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18V8.25m-18 0V6a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 6v2.25m-18 0h18" /></svg>`,
  close:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>`,
  archive: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" /></svg>`,
  focus:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" /></svg>`,
  audioOn:  `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" /></svg>`,
  audioOff: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.25 9.75 19.5 12m0 0 2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6 4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" /></svg>`,
  lock:     `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" /></svg>`,
  lockOpen: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 1 1 9 0v3.75M3.75 21.75h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H3.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" /></svg>`,
  group:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" /></svg>`,
};


/* ----------------------------------------------------------------
   IN-MEMORY STORE FOR OPEN-TAB GROUPS
   ---------------------------------------------------------------- */
let domainGroups = [];


/* ----------------------------------------------------------------
   HELPER: filter out browser-internal pages
   ---------------------------------------------------------------- */

/**
 * getRealTabs()
 *
 * Returns tabs that are real web pages — no chrome://, extension
 * pages, about:blank, etc.
 */
function getRealTabs() {
  return openTabs.filter(t => {
    const url = t.url || '';
    return (
      !url.startsWith('chrome://') &&
      !url.startsWith('chrome-extension://') &&
      !url.startsWith('about:') &&
      !url.startsWith('edge://') &&
      !url.startsWith('brave://')
    );
  });
}

/**
 * checkTabOutDupes()
 *
 * Counts how many Tab Out pages are open. If more than 1,
 * shows a banner offering to close the extras.
 */
function checkTabOutDupes() {
  const tabOutTabs = openTabs.filter(t => t.isTabOut);
  const banner = document.getElementById('tabOutDupeBanner');
  const textEl = document.getElementById('tabOutDupeText');
  if (!banner) return;

  if (tabOutTabs.length > 1) {
    // Dictionary value carries the <strong> markup itself (dictionary-only)
    if (textEl) textEl.innerHTML = I18N.tCount('banner.dupesOpen', tabOutTabs.length);
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}


/* ----------------------------------------------------------------
   OVERFLOW CHIPS ("+N more" expand button in domain cards)
   ---------------------------------------------------------------- */

function buildOverflowChips(hiddenTabs, urlCounts = {}) {
  const hiddenChips = hiddenTabs.map(tab => {
    const label    = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), '');
    const count    = urlCounts[tab.url] || 1;
    const dupeTag  = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const chipClass = count > 1 ? ' chip-has-dupes' : '';
    const safeUrl   = escapeHtml(tab.url || '');
    const safeTitle = escapeHtml(label);
    let domain = '';
    try { domain = new URL(tab.url).hostname; } catch {}
    const faviconUrl = tab.url ? localFaviconUrl(tab.url) : '';
    const mutedNow   = !!tab.muted;
    const audioTag   = (tab.audible || mutedNow)
      ? `<button class="chip-audio${mutedNow ? ' is-muted' : ''}" data-action="toggle-mute-tab" data-tab-url="${safeUrl}" title="${mutedNow ? t('chip.audioMutedTitle') : t('chip.audioOnTitle')}" >${mutedNow ? ICONS.audioOff : ICONS.audioOn}</button>`
      : '';
    const lockedNow  = lockedUrls.has(tab.url);
    const grpTag     = groupBadgeHtml(tab);
    return `<div class="page-chip clickable${chipClass}${lockedNow ? ' chip-locked' : ''}" data-action="focus-tab" tabindex="0" data-tab-url="${safeUrl}" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${escapeHtml(faviconUrl)}" alt="">` : ''}
      <span class="chip-text">${escapeHtml(label)}</span>${dupeTag}${grpTag}${audioTag}
      <div class="chip-actions">
        <button class="chip-action chip-lock${lockedNow ? ' is-locked' : ''}" data-action="toggle-lock-tab" data-tab-url="${safeUrl}" title="${lockedNow ? t('chip.lockedTitle') : t('chip.lockTitle')}">
          ${lockedNow ? ICONS.lock : ICONS.lockOpen}
        </button>
        <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="${t('chip.save')}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="${t('chip.close')}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
  }).join('');

  return `
    <div class="page-chips-overflow" style="display:none">${hiddenChips}</div>
    <div class="page-chip page-chip-overflow clickable" data-action="expand-chips">
      <span class="chip-text">${escapeHtml(t('tabs.more', { n: hiddenTabs.length }))}</span>
    </div>`;
}


/* ----------------------------------------------------------------
   DOMAIN CARD RENDERER
   ---------------------------------------------------------------- */

/**
 * renderDomainCard(group, groupIndex)
 *
 * Builds the HTML for one domain group card.
 * group = { domain: string, tabs: [{ url, title, id, windowId, active }] }
 */
function renderDomainCard(group) {
  const tabs      = group.tabs || [];
  const tabCount  = tabs.length;
  const isLanding = group.domain === '__landing-pages__';
  const stableId  = 'domain-' + group.domain.replace(/[^a-z0-9]/g, '-');

  // Count duplicates (exact URL match)
  const urlCounts = {};
  for (const tab of tabs) urlCounts[tab.url] = (urlCounts[tab.url] || 0) + 1;
  const dupeUrls   = Object.entries(urlCounts).filter(([, c]) => c > 1);
  const hasDupes   = dupeUrls.length > 0;
  const totalExtras = dupeUrls.reduce((s, [, c]) => s + c - 1, 0);

  const tabBadge = `<span class="open-tabs-badge">
    ${ICONS.tabs}
    ${escapeHtml(tCount('tabs.openBadge', tabCount))}
  </span>`;

  const dupeBadge = hasDupes
    ? `<span class="open-tabs-badge" style="color:var(--accent-amber);background:rgba(200,113,58,0.08);">
        ${escapeHtml(tCount('tabs.dupeBadge', totalExtras))}
      </span>`
    : '';

  // Deduplicate for display: show each URL once, with (Nx) badge if duped
  const seen = new Set();
  const uniqueTabs = [];
  for (const tab of tabs) {
    if (!seen.has(tab.url)) { seen.add(tab.url); uniqueTabs.push(tab); }
  }

  // Audio state aggregated across all instances of each URL
  // (chips are deduped by URL, but any instance may be the one making noise)
  const mutedByUrl   = {};
  for (const t of tabs) {
    if (t.muted) mutedByUrl[t.url] = true;
  }

  const visibleTabs = uniqueTabs.slice(0, 8);
  const extraCount  = uniqueTabs.length - visibleTabs.length;

  const pageChips = visibleTabs.map(tab => {
    let label = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), group.domain);
    // For localhost tabs, prepend port number so you can tell projects apart
    try {
      const parsed = new URL(tab.url);
      if (parsed.hostname === 'localhost' && parsed.port) label = `${parsed.port} ${label}`;
    } catch {}
    const count    = urlCounts[tab.url];
    const dupeTag  = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const chipClass = count > 1 ? ' chip-has-dupes' : '';
    const safeUrl   = escapeHtml(tab.url || '');
    const safeTitle = escapeHtml(label);
    // Speaker marker: amber pulse while audible, gray slash when muted.
    // It's a button — click to mute/unmute without leaving the dashboard.
    const isMutedNow = !!mutedByUrl[tab.url];
    const audioTag   = (tab.audible || isMutedNow)
      ? `<button class="chip-audio${isMutedNow ? ' is-muted' : ''}" data-action="toggle-mute-tab" data-tab-url="${safeUrl}" title="${isMutedNow ? t('chip.audioMutedTitle') : t('chip.audioOnTitle')}" >${isMutedNow ? ICONS.audioOff : ICONS.audioOn}</button>`
      : '';
    const lockedNow  = lockedUrls.has(tab.url);
    const grpTag     = groupBadgeHtml(tab);
    let domain = '';
    try { domain = new URL(tab.url).hostname; } catch {}
    const faviconUrl = tab.url ? localFaviconUrl(tab.url) : '';
    return `<div class="page-chip clickable${chipClass}${lockedNow ? ' chip-locked' : ''}" data-action="focus-tab" tabindex="0" data-tab-url="${safeUrl}" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${escapeHtml(faviconUrl)}" alt="">` : ''}
      <span class="chip-text">${escapeHtml(label)}</span>${dupeTag}${grpTag}${audioTag}
      <div class="chip-actions">
        <button class="chip-action chip-lock${lockedNow ? ' is-locked' : ''}" data-action="toggle-lock-tab" data-tab-url="${safeUrl}" title="${lockedNow ? t('chip.lockedTitle') : t('chip.lockTitle')}">
          ${lockedNow ? ICONS.lock : ICONS.lockOpen}
        </button>
        <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="${t('chip.save')}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="${t('chip.close')}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
  }).join('') + (extraCount > 0 ? buildOverflowChips(uniqueTabs.slice(8), urlCounts) : '');

  const groupTitle = isLanding ? t('group.homepages') : (group.label || friendlyDomain(group.domain));
  let actionsHtml = `
    <button class="action-btn" data-action="create-tab-group" data-domain-id="${stableId}"
            title="${escapeHtml(t('group.createTitle'))}">
      ${ICONS.group}
      ${escapeHtml(t('group.create'))}
    </button>
    <button class="action-btn close-tabs" data-action="close-domain-tabs" data-domain-id="${stableId}">
      ${ICONS.close}
      ${escapeHtml(tCount('tabs.closeAll', tabCount))}
    </button>`;

  if (hasDupes) {
    const dupeUrlsEncoded = dupeUrls.map(([url]) => encodeURIComponent(url)).join(',');
    actionsHtml += `
      <button class="action-btn" data-action="dedup-keep-one" data-dupe-urls="${dupeUrlsEncoded}">
        ${escapeHtml(tCount('tabs.closeDupes', totalExtras))}
      </button>`;
  }

  return `
    <div class="mission-card domain-card ${hasDupes ? 'has-amber-bar' : 'has-neutral-bar'}" data-domain-id="${stableId}">
      <div class="status-bar"></div>
      <div class="mission-content">
        <div class="mission-top">
          <span class="mission-name">${escapeHtml(isLanding ? t('group.homepages') : (group.label || friendlyDomain(group.domain)))}</span>
          ${tabBadge}
          ${dupeBadge}
        </div>
        <div class="mission-pages">${pageChips}</div>
        <div class="actions">${actionsHtml}</div>
      </div>
      <div class="mission-meta">
        <div class="mission-page-count">${tabCount}</div>
        <div class="mission-page-label">${escapeHtml(t('tabs.pageLabel'))}</div>
      </div>
    </div>`;
}


/* ----------------------------------------------------------------
   SAVED FOR LATER — Render Checklist Column
   ---------------------------------------------------------------- */

/**
 * renderDeferredColumn()
 *
 * Reads saved tabs from chrome.storage.local and renders the right-side
 * "Saved for Later" checklist column. Shows active items as a checklist
 * and completed items in a collapsible archive.
 */
async function renderDeferredColumn() {
  const column         = document.getElementById('deferredColumn');
  const list           = document.getElementById('deferredList');
  const empty          = document.getElementById('deferredEmpty');
  const countEl        = document.getElementById('deferredCount');
  const archiveEl      = document.getElementById('deferredArchive');
  const archiveCountEl = document.getElementById('archiveCount');
  const archiveList    = document.getElementById('archiveList');

  if (!column) return;

  try {
    const { active, archived } = await getSavedTabs();

    // Hide the entire column if there's nothing to show
    if (active.length === 0 && archived.length === 0) {
      column.style.display = 'none';
      return;
    }

    column.style.display = 'block';

    // Render active checklist items
    if (active.length > 0) {
      countEl.textContent = tCount('deferred.items', active.length);
      list.innerHTML = active.map(item => renderDeferredItem(item)).join('');
      list.style.display = 'block';
      empty.style.display = 'none';
    } else {
      list.style.display = 'none';
      countEl.textContent = '';
      empty.style.display = 'block';
    }

    // Render archive section
    if (archived.length > 0) {
      archiveCountEl.textContent = `(${archived.length})`;
      archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
      archiveEl.style.display = 'block';
    } else {
      archiveEl.style.display = 'none';
    }

  } catch (err) {
    console.warn('[tab-out] Could not load saved tabs:', err);
    column.style.display = 'none';
  }
}

/**
 * renderDeferredItem(item)
 *
 * Builds HTML for one active checklist item: checkbox, title link,
 * domain, time ago, dismiss button.
 */
function renderDeferredItem(item) {
  let domain = '';
  try { domain = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
  const faviconUrl = item.url ? localFaviconUrl(item.url) : '';
  const ago = timeAgo(item.savedAt);
  const safeId    = escapeHtml(item.id);
  const safeUrl   = escapeHtml(isSafeNavUrl(item.url) ? item.url : '#');
  const safeTitle = escapeHtml(item.title || item.url || '');

  return `
    <div class="deferred-item" data-deferred-id="${safeId}">
      <input type="checkbox" class="deferred-checkbox" data-action="check-deferred" data-deferred-id="${safeId}">
      <div class="deferred-info">
        <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="deferred-title" title="${safeTitle}">
          ${faviconUrl ? `<img src="${escapeHtml(faviconUrl)}" alt="" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px">` : ''}${safeTitle}
        </a>
        <div class="deferred-meta">
          <span>${escapeHtml(domain)}</span>
          <span>${escapeHtml(ago)}</span>
        </div>
      </div>
      <button class="deferred-dismiss" data-action="dismiss-deferred" data-deferred-id="${safeId}" title="${t('deferred.dismiss')}">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
      </button>
    </div>`;
}

/**
 * renderArchiveItem(item)
 *
 * Builds HTML for one completed/archived item (simpler: just title + date).
 */
function renderArchiveItem(item) {
  const ago = item.completedAt ? timeAgo(item.completedAt) : timeAgo(item.savedAt);
  const safeUrl   = escapeHtml(isSafeNavUrl(item.url) ? item.url : '#');
  const safeTitle = escapeHtml(item.title || item.url || '');
  return `
    <div class="archive-item">
      <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="archive-item-title" title="${safeTitle}">
        ${safeTitle}
      </a>
      <span class="archive-item-date">${escapeHtml(ago)}</span>
    </div>`;
}


/* ----------------------------------------------------------------
   MAIN DASHBOARD RENDERER
   ---------------------------------------------------------------- */

/**
 * renderStaticDashboard()
 *
 * The main render function:
 * 1. Paints greeting + date
 * 2. Fetches open tabs via chrome.tabs.query()
 * 3. Groups tabs by domain (with landing pages pulled out to their own group)
 * 4. Renders domain cards
 * 5. Updates footer stats
 * 6. Renders the "Saved for Later" checklist
 */
/**
 * localFaviconUrl(pageUrl)
 *
 * Chrome's built-in local favicon database — zero network requests, works
 * offline and for both live tabs and saved items. Replaced the old
 * third-party favicon-service lookups so "no external API calls" is literally true.
 */
function localFaviconUrl(pageUrl) {
  return `chrome://favicon2?size=16&scale_factor=1x&page_url=${encodeURIComponent(pageUrl)}`;
}

// --- Global tab search state ---
let searchQuery    = '';
let searchDebounce = null;

async function renderStaticDashboard() {
  // --- Header ---
  const greetingEl = document.getElementById('greeting');
  const dateEl     = document.getElementById('dateDisplay');
  if (greetingEl) greetingEl.textContent = getGreeting();
  if (dateEl)     dateEl.textContent     = getDateDisplay();

  // --- Fetch tabs ---
  await fetchOpenTabs();
  const realTabs = getRealTabs();

  // --- Group tabs by domain ---
  // Landing pages (Gmail inbox, Twitter home, etc.) get their own special group
  // so they can be closed together without affecting content tabs on the same domain.
  const LANDING_PAGE_PATTERNS = [
    { hostname: 'mail.google.com', test: (p, h) =>
        !h.includes('#inbox/') && !h.includes('#sent/') && !h.includes('#search/') },
    { hostname: 'x.com',               pathExact: ['/home'] },
    { hostname: 'www.linkedin.com',    pathExact: ['/'] },
    { hostname: 'github.com',          pathExact: ['/'] },
    { hostname: 'www.youtube.com',     pathExact: ['/'] },
    // Merge personal patterns from config.local.js (if it exists)
    ...(typeof LOCAL_LANDING_PAGE_PATTERNS !== 'undefined' ? LOCAL_LANDING_PAGE_PATTERNS : []),
  ];

  function isLandingPage(url) {
    try {
      const parsed = new URL(url);
      return LANDING_PAGE_PATTERNS.some(p => {
        // Support both exact hostname and suffix matching (for wildcard subdomains)
        const hostnameMatch = p.hostname
          ? parsed.hostname === p.hostname
          : p.hostnameEndsWith
            ? parsed.hostname.endsWith(p.hostnameEndsWith)
            : false;
        if (!hostnameMatch) return false;
        if (p.test)       return p.test(parsed.pathname, url);
        if (p.pathPrefix) return parsed.pathname.startsWith(p.pathPrefix);
        if (p.pathExact)  return p.pathExact.includes(parsed.pathname);
        return parsed.pathname === '/';
      });
    } catch { return false; }
  }

  domainGroups = [];
  const groupMap    = {};
  const landingTabs = [];

  // Custom group rules from config.local.js (if any)
  const customGroups = typeof LOCAL_CUSTOM_GROUPS !== 'undefined' ? LOCAL_CUSTOM_GROUPS : [];

  // Check if a URL matches a custom group rule; returns the rule or null
  function matchCustomGroup(url) {
    try {
      const parsed = new URL(url);
      return customGroups.find(r => {
        const hostMatch = r.hostname
          ? parsed.hostname === r.hostname
          : r.hostnameEndsWith
            ? parsed.hostname.endsWith(r.hostnameEndsWith)
            : false;
        if (!hostMatch) return false;
        if (r.pathPrefix) return parsed.pathname.startsWith(r.pathPrefix);
        return true; // hostname matched, no path filter
      }) || null;
    } catch { return null; }
  }

  for (const tab of realTabs) {
    try {
      if (isLandingPage(tab.url)) {
        landingTabs.push(tab);
        continue;
      }

      // Check custom group rules first (e.g. merge subdomains, split by path)
      const customRule = matchCustomGroup(tab.url);
      if (customRule) {
        const key = customRule.groupKey;
        if (!groupMap[key]) groupMap[key] = { domain: key, label: customRule.groupLabel, tabs: [] };
        groupMap[key].tabs.push(tab);
        continue;
      }

      let hostname;
      if (tab.url && tab.url.startsWith('file://')) {
        hostname = 'local-files';
      } else {
        hostname = new URL(tab.url).hostname;
      }
      if (!hostname) continue;

      if (!groupMap[hostname]) groupMap[hostname] = { domain: hostname, tabs: [] };
      groupMap[hostname].tabs.push(tab);
    } catch {
      // Skip malformed URLs
    }
  }

  if (landingTabs.length > 0) {
    groupMap['__landing-pages__'] = { domain: '__landing-pages__', tabs: landingTabs };
  }

  // Sort: landing pages first, then domains from landing page sites, then by tab count
  // Collect exact hostnames and suffix patterns for priority sorting
  const landingHostnames = new Set(LANDING_PAGE_PATTERNS.map(p => p.hostname).filter(Boolean));
  const landingSuffixes = LANDING_PAGE_PATTERNS.map(p => p.hostnameEndsWith).filter(Boolean);
  function isLandingDomain(domain) {
    if (landingHostnames.has(domain)) return true;
    return landingSuffixes.some(s => domain.endsWith(s));
  }
  domainGroups = Object.values(groupMap).sort((a, b) => {
    const aIsLanding = a.domain === '__landing-pages__';
    const bIsLanding = b.domain === '__landing-pages__';
    if (aIsLanding !== bIsLanding) return aIsLanding ? -1 : 1;

    const aIsPriority = isLandingDomain(a.domain);
    const bIsPriority = isLandingDomain(b.domain);
    if (aIsPriority !== bIsPriority) return aIsPriority ? -1 : 1;

    return b.tabs.length - a.tabs.length;
  });

  // --- Global search filter (data-level, before render) ---
  let visibleTabsCount = realTabs.length;
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    domainGroups = domainGroups
      .map(g => ({ ...g, tabs: g.tabs.filter(t =>
        (t.title || '').toLowerCase().includes(q) ||
        (t.url   || '').toLowerCase().includes(q)
      )}))
      .filter(g => g.tabs.length > 0);
    visibleTabsCount = domainGroups.reduce((s, g) => s + g.tabs.length, 0);
  }

  // --- Render domain cards ---
  const openTabsSection      = document.getElementById('openTabsSection');
  const openTabsMissionsEl   = document.getElementById('openTabsMissions');
  const openTabsSectionCount = document.getElementById('openTabsSectionCount');
  const openTabsSectionTitle = document.getElementById('openTabsSectionTitle');

  if (domainGroups.length > 0 && openTabsSection) {
    if (openTabsSectionTitle) openTabsSectionTitle.textContent = t('section.openTabs');
    if (searchQuery) {
      // While filtering, hide the bulk-close button — it would take hidden tabs with it
      openTabsSectionCount.innerHTML = tCount('search.matches', visibleTabsCount, {
        q: `\u201C${escapeHtml(searchQuery)}\u201D`,
        sites: tCount('search.sites', domainGroups.length),
      });
    } else {
      const playingCount = realTabs.filter(t => t.audible).length;
      const playingBtn = playingCount > 0
        ? ` &nbsp;&middot;&nbsp; <button class="action-btn" data-action="mute-all-playing" style="font-size:11px;padding:3px 10px;color:var(--accent-amber);">${ICONS.audioOn} ${escapeHtml(tCount('tabs.mutePlaying', playingCount))}</button>`
        : '';
      openTabsSectionCount.innerHTML = `${tCount('tabs.domainsLine', domainGroups.length)} &nbsp;&middot;&nbsp; <button class="action-btn close-tabs" data-action="close-all-open-tabs" style="font-size:11px;padding:3px 10px;">${ICONS.close} ${escapeHtml(tCount('tabs.closeAll', realTabs.length))}</button>${playingBtn}`;
    }
    openTabsMissionsEl.innerHTML = domainGroups.map(g => renderDomainCard(g)).join('');
    openTabsSection.style.display = 'block';
  } else if (openTabsSection) {
    if (searchQuery) {
      // Keep the section visible with an empty state instead of hiding it mid-search
      if (openTabsSectionTitle) openTabsSectionTitle.textContent = t('section.openTabs');
      openTabsSectionCount.innerHTML = t('search.noMatches', { q: `\u201C${escapeHtml(searchQuery)}\u201D` });
      openTabsMissionsEl.innerHTML = `<div class="search-empty">${escapeHtml(t('search.emptyHint'))}</div>`;
      openTabsSection.style.display = 'block';
    } else {
      openTabsSection.style.display = 'none';
    }
  }

  // --- Footer stats ---
  const statTabs = document.getElementById('statTabs');
  if (statTabs) statTabs.textContent = openTabs.length;

  // --- Check for duplicate Tab Out tabs ---
  checkTabOutDupes();

  // --- Render "Saved for Later" column ---
  await renderDeferredColumn();

  // --- Quick links bar (also upgrades hostname-default titles to real ones) ---
  await renderQuickLinks();
}

async function renderDashboard() {
  await renderStaticDashboard();
}


/* ----------------------------------------------------------------
   EVENT HANDLERS — using event delegation

   One listener on document handles ALL button clicks.
   Think of it as one security guard watching the whole building
   instead of one per door.
   ---------------------------------------------------------------- */

document.addEventListener('click', async (e) => {
  // Walk up the DOM to find the nearest element with data-action
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;

  const action = actionEl.dataset.action;

  // ---- Switch color theme ----
  if (action === 'set-theme') {
    const name = actionEl.dataset.themeName;
    if (name) applyTheme(name, { save: true });
    return;
  }

  // ---- Settings popover ----
  if (action === 'toggle-settings') {
    const pop = document.getElementById('settingsPopover');
    if (pop) {
      pop.hidden = !pop.hidden;
      actionEl.setAttribute('aria-expanded', String(!pop.hidden));
    }
    return;
  }

  // ---- Mute / unmute the tabs behind one chip (all instances of the URL) ----
  if (action === 'toggle-mute-tab') {
    const url = actionEl.dataset.tabUrl;
    if (url) {
      const live    = await chrome.tabs.query({});
      const targets = live.filter(t => t.url === url);
      if (targets.length > 0) {
        const anyUnmuted = targets.some(t => !(t.mutedInfo && t.mutedInfo.muted));
        for (const t of targets) await chrome.tabs.update(t.id, { muted: anyUnmuted });
        showToast(anyUnmuted
          ? tCount('toast.muted', targets.length)
          : tCount('toast.unmuted', targets.length));
        renderDashboard();
      }
    }
    return;
  }

  // ---- Silence everything that's playing ----
  if (action === 'mute-all-playing') {
    const playing = await chrome.tabs.query({ audible: true });
    if (playing.length === 0) return;
    for (const t of playing) await chrome.tabs.update(t.id, { muted: true });
    showToast(tCount('toast.mutedPlaying', playing.length));
    renderDashboard();
    return;
  }

  // ---- Quick links bar (issue #7) ----
  if (action === 'toggle-quick-links') {
    const { quickLinksCollapsed = false } = await chrome.storage.local.get('quickLinksCollapsed');
    await chrome.storage.local.set({ quickLinksCollapsed: !quickLinksCollapsed });
    await renderQuickLinks();
    return;
  }
  if (action === 'add-quick-link') {
    const form = document.getElementById('qlAddForm');
    if (form) {
      form.hidden = false;
      document.getElementById('qlAddUrl')?.focus();
    }
    return;
  }
  if (action === 'cancel-add-quick-link') {
    const form = document.getElementById('qlAddForm');
    if (form) { form.hidden = true; form.reset(); }
    return;
  }
  if (action === 'open-quick-link') {
    const chip = actionEl.closest('.ql-chip');
    if (chip) await openQuickLink(chip.dataset.qlUrl);
    return;
  }
  if (action === 'remove-quick-link') {
    const id = actionEl.dataset.qlId;
    if (!id) return;
    await setQuickLinks((await getQuickLinks()).filter(l => l.id !== id));
    await renderQuickLinks();
    showToast(t('quick.removed'));
    return;
  }

  // ---- Turn a domain card into a native Chrome tab group (issue #5) ----
  if (action === 'create-tab-group') {
    const domainId = actionEl.dataset.domainId;
    const grp = domainGroups.find(g =>
      'domain-' + g.domain.replace(/[^a-z0-9]/g, '-') === domainId);
    if (!grp || grp.tabs.length === 0) return;

    const urlSet   = new Set(grp.tabs.map(t => t.url));
    const liveTabs = (await chrome.tabs.query({})).filter(t => urlSet.has(t.url));
    if (liveTabs.length === 0) return;

    const title = grp.domain === '__landing-pages__'
      ? t('group.homepages')
      : (grp.label || friendlyDomain(grp.domain));
    const color = GROUP_COLOR_NAMES[stringHash(grp.domain || title) % GROUP_COLOR_NAMES.length];

    // tabs.group() requires all tabs to share a window; domain cards can
    // span windows, so group each window's share under the same name.
    const byWindow = new Map();
    for (const t of liveTabs) {
      if (!byWindow.has(t.windowId)) byWindow.set(t.windowId, []);
      byWindow.get(t.windowId).push(t.id);
    }

    let grouped = 0;
    let anyGrouped = false;
    for (const ids of byWindow.values()) {
      try {
        const gid = await chrome.tabs.group({ tabIds: ids });
        await chrome.tabGroups.update(gid, { title, color });
        grouped += ids.length;
        anyGrouped = true;
      } catch {
        // A window failing (e.g. a minimized/tab-strip quirk) must not
        // stop the others
      }
    }

    showToast(anyGrouped ? tCount('group.created', grouped) : t('group.createFailed'));
    await fetchOpenTabs();
    renderDashboard();
    return;
  }

  // ---- Lock / unlock a URL against bulk closing (issue #8) ----
  if (action === 'toggle-lock-tab') {
    e.stopPropagation();
    const url = actionEl.dataset.tabUrl;
    if (!url) return;
    await loadLockedTabs();
    if (lockedUrls.has(url)) {
      lockedUrls.delete(url);
      await chrome.storage.local.set({ lockedTabs: [...lockedUrls] });
      showToast(t('lock.unlockedToast'));
    } else {
      lockedUrls.add(url);
      await chrome.storage.local.set({ lockedTabs: [...lockedUrls] });
      showToast(t('lock.lockedToast'));
    }
    renderDashboard();
    return;
  }

  // ---- Session snapshots panel ----
  if (action === 'toggle-snapshots') {
    const ov = document.getElementById('snapshotOverlay');
    if (ov && ov.classList.contains('open')) closeSnapshots();
    else await openSnapshots();
    return;
  }
  if (action === 'close-snapshots') {
    closeSnapshots();
    return;
  }
  if (action === 'snapshot-pick-toggle') {
    expandedSnapId = (expandedSnapId === actionEl.dataset.snapId) ? null : actionEl.dataset.snapId;
    await renderSnapshotPanel();
    return;
  }
  if (action === 'snapshot-cancel-pick') {
    expandedSnapId = null;
    await renderSnapshotPanel();
    return;
  }
  if (action === 'snapshot-domain-all') {
    const item = actionEl.closest('.snapshot-item');
    const domain = actionEl.dataset.domain;
    if (item && domain) {
      const rows = [...item.querySelectorAll('.picker-row')].filter(r => r.dataset.domain === domain);
      if (rows.length > 0) {
        const target = !rows.every(r => r.querySelector('.snap-check').checked);
        rows.forEach(r => { r.querySelector('.snap-check').checked = target; });
        updatePickCount(item);
      }
    }
    return;
  }
  if (action === 'snapshot-restore-all' || action === 'snapshot-restore-sel') {
    const snap = (await getSnapshots()).find(s => s.id === actionEl.dataset.snapId);
    if (!snap) return;
    let urls = null;
    if (action === 'snapshot-restore-sel') {
      const item = actionEl.closest('.snapshot-item');
      urls = [...item.querySelectorAll('.snap-check:checked')].map(c => c.dataset.url);
      if (urls.length === 0) return;
    }
    actionEl.disabled = true;
    actionEl.textContent = t('snap.restoring');
    const n = await restoreSnapshot(snap, urls);
    closeSnapshots();
    showToast(tCount('toast.restored', n, { when: fmtSnapTime(snap.id) }));
    renderDashboard();
    return;
  }

  // ---- Close duplicate Tab Out tabs ----
  if (action === 'close-tabout-dupes') {
    await closeTabOutDupes();
    playCloseSound();
    const banner = document.getElementById('tabOutDupeBanner');
    if (banner) {
      banner.style.transition = 'opacity 0.4s';
      banner.style.opacity = '0';
      setTimeout(() => { banner.style.display = 'none'; banner.style.opacity = '1'; }, 400);
    }
    showToast(t('toast.taboutClosed'));
    return;
  }

  const card = actionEl.closest('.mission-card');

  // ---- Expand overflow chips ("+N more") ----
  if (action === 'expand-chips') {
    const overflowContainer = actionEl.parentElement.querySelector('.page-chips-overflow');
    if (overflowContainer) {
      overflowContainer.style.display = 'contents';
      actionEl.remove();
    }
    return;
  }

  // ---- Focus a specific tab ----
  if (action === 'focus-tab') {
    const tabUrl = actionEl.dataset.tabUrl;
    if (tabUrl) await focusTab(tabUrl);
    return;
  }

  // ---- Close a single tab ----
  if (action === 'close-single-tab') {
    e.stopPropagation(); // don't trigger parent chip's focus-tab
    const tabUrl = actionEl.dataset.tabUrl;
    if (!tabUrl) return;

    // A locked URL is exactly what the lock is protecting — closing it
    // "by hand" is the same accident with one extra step. Point at the
    // unlock instead of silently obeying.
    await loadLockedTabs();
    if (lockedUrls.has(tabUrl)) {
      showToast(t('lock.singleBlocked'));
      return;
    }

    // The chip represents a URL (possibly with an "(Nx)" duplicate badge),
    // so close every tab with that exact URL, not just the first one found.
    const allTabs = await chrome.tabs.query({});
    const ids     = allTabs.filter(t => t.url === tabUrl).map(t => t.id);
    if (ids.length > 0) await chrome.tabs.remove(ids);
    await fetchOpenTabs();

    playCloseSound();

    // Animate the chip row out
    const chip = actionEl.closest('.page-chip');
    if (chip) {
      const rect = chip.getBoundingClientRect();
      shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity    = '0';
      chip.style.transform  = 'scale(0.8)';
      setTimeout(() => {
        chip.remove();
        // If the card now has no tabs, remove it too
        const parentCard = document.querySelector('.mission-card:has(.mission-pages:empty)');
        if (parentCard) animateCardOut(parentCard);
        document.querySelectorAll('.mission-card').forEach(c => {
          if (c.querySelectorAll('.page-chip[data-action="focus-tab"]').length === 0) {
            animateCardOut(c);
          }
        });
      }, 200);
    }

    // Update footer
    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = openTabs.length;

    showToast(t('toast.tabClosed'));
    return;
  }

  // ---- Save a single tab for later (then close it) ----
  if (action === 'defer-single-tab') {
    e.stopPropagation();
    const tabUrl   = actionEl.dataset.tabUrl;
    const tabTitle = actionEl.dataset.tabTitle || tabUrl;
    if (!tabUrl) return;

    // Save to chrome.storage.local
    try {
      await saveTabForLater({ url: tabUrl, title: tabTitle });
    } catch (err) {
      console.error('[tab-out] Failed to save tab:', err);
      showToast(t('toast.saveFailed'));
      return;
    }

    // Close every tab with that exact URL so duplicates also go away.
    const allTabs = await chrome.tabs.query({});
    const ids     = allTabs.filter(t => t.url === tabUrl).map(t => t.id);
    if (ids.length > 0) await chrome.tabs.remove(ids);
    await fetchOpenTabs();

    // Animate chip out
    const chip = actionEl.closest('.page-chip');
    if (chip) {
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity    = '0';
      chip.style.transform  = 'scale(0.8)';
      setTimeout(() => chip.remove(), 200);
    }

    showToast(t('toast.savedLater'));
    await renderDeferredColumn();
    return;
  }

  // ---- Check off a saved tab (moves it to archive) ----
  if (action === 'check-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    await checkOffSavedTab(id);

    // Animate: strikethrough first, then slide out
    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('checked');
      setTimeout(() => {
        item.classList.add('removing');
        setTimeout(() => {
          item.remove();
          renderDeferredColumn(); // refresh counts and archive
        }, 300);
      }, 800);
    }
    return;
  }

  // ---- Dismiss a saved tab (removes it entirely) ----
  if (action === 'dismiss-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    await dismissSavedTab(id);

    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('removing');
      setTimeout(() => {
        item.remove();
        renderDeferredColumn();
      }, 300);
    }
    return;
  }

  // ---- Bulk-close every tab of one domain group ----
  if (action === 'close-domain-tabs') {
    const domainId = actionEl.dataset.domainId;
    const group    = domainGroups.find(g => {
      return 'domain-' + g.domain.replace(/[^a-z0-9]/g, '-') === domainId;
    });
    if (!group) return;

    const urls = group.tabs.map(t => t.url);
    const { closed, skipped } = await closeTabsByUrls(urls);

    // Remove from in-memory groups
    const idx = domainGroups.indexOf(group);
    if (idx !== -1) domainGroups.splice(idx, 1);

    // Locked tabs stayed open — redraw so the card reflects what remains.
    // Only celebrate with sound + confetti when the card actually emptied.
    if (skipped > 0) {
      await renderDashboard();
    } else if (card) {
      playCloseSound();
      animateCardOut(card);
    }

    const groupLabel = group.domain === '__landing-pages__' ? t('group.homepages') : (group.label || friendlyDomain(group.domain));
    showToast(skipped > 0
      ? t('lock.closedKept', { closed, label: groupLabel, skipped })
      : tCount('toast.domainClosed', urls.length, { label: groupLabel }));

    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = openTabs.length;
    return;
  }

  // ---- Close duplicates, keep one copy ----
  if (action === 'dedup-keep-one') {
    const urlsEncoded = actionEl.dataset.dupeUrls || '';
    const urls = urlsEncoded.split(',').map(u => decodeURIComponent(u)).filter(Boolean);
    if (urls.length === 0) return;

    const { closed, skipped } = await closeDuplicateTabs(urls, true);

    // Hide the dedup button
    actionEl.style.transition = 'opacity 0.2s';
    actionEl.style.opacity    = '0';
    setTimeout(() => actionEl.remove(), 200);

    if (skipped > 0) {
      // Locked copies survived — redraw so badges match what's still open.
      await renderDashboard();
      showToast(t('lock.dedupeKept', { closed, skipped }));
      return;
    }

    playCloseSound();

    // Remove dupe badges from the card
    if (card) {
      card.querySelectorAll('.chip-dupe-badge').forEach(b => {
        b.style.transition = 'opacity 0.2s';
        b.style.opacity    = '0';
        setTimeout(() => b.remove(), 200);
      });
      card.querySelectorAll('.open-tabs-badge').forEach(badge => {
        if (badge.textContent.includes('duplicate')) {
          badge.style.transition = 'opacity 0.2s';
          badge.style.opacity    = '0';
          setTimeout(() => badge.remove(), 200);
        }
      });
      card.classList.remove('has-amber-bar');
      card.classList.add('has-neutral-bar');
    }

    showToast(t('toast.dedupeDone'));
    return;
  }

  // ---- Close ALL open tabs ----
  if (action === 'close-all-open-tabs') {
    // Exclude Tab Out's own new-tab pages (across Chrome/Edge/Brave) and
    // other internal schemes so we don't close the page the user is on.
    const allUrls = openTabs
      .filter(t =>
        t.url &&
        !t.isTabOut &&
        !t.url.startsWith('chrome') &&
        !t.url.startsWith('edge:') &&
        !t.url.startsWith('brave:') &&
        !t.url.startsWith('about:')
      )
      .map(t => t.url);
    const { closed, skipped } = await closeTabsByUrls(allUrls);

    if (skipped > 0) {
      // Some cards survive — redraw instead of animating everything away.
      await renderDashboard();
    } else {
      playCloseSound();

      document.querySelectorAll('#openTabsMissions .mission-card').forEach(c => {
        shootConfetti(
          c.getBoundingClientRect().left + c.offsetWidth / 2,
          c.getBoundingClientRect().top  + c.offsetHeight / 2
        );
        animateCardOut(c);
      });
    }

    showToast(skipped > 0
      ? t('lock.allFreshKept', { closed, skipped })
      : t('toast.freshStart'));
    return;
  }
});

// ---- Archive toggle — expand/collapse the archive section ----
document.addEventListener('click', (e) => {
  const toggle = e.target.closest('#archiveToggle');
  if (!toggle) return;

  toggle.classList.toggle('open');
  const body = document.getElementById('archiveBody');
  if (body) {
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
  }
});

// ---- Archive search — filter archived items as user types ----
document.addEventListener('input', async (e) => {
  if (e.target.id !== 'archiveSearch') return;

  const q = e.target.value.trim().toLowerCase();
  const archiveList = document.getElementById('archiveList');
  if (!archiveList) return;

  try {
    const { archived } = await getSavedTabs();

    if (q.length < 2) {
      // Show all archived items
      archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
      return;
    }

    // Filter by title or URL containing the query string
    const results = archived.filter(item =>
      (item.title || '').toLowerCase().includes(q) ||
      (item.url  || '').toLowerCase().includes(q)
    );

    archiveList.innerHTML = results.map(item => renderArchiveItem(item)).join('')
      || `<div style="font-size:12px;color:var(--muted);padding:8px 0">${escapeHtml(t('archive.noResults'))}</div>`;
  } catch (err) {
    console.warn('[tab-out] Archive search failed:', err);
  }
});


/* ----------------------------------------------------------------
   GLOBAL TAB SEARCH — debounced filter + keyboard shortcuts.
   `/` focuses the box, Esc clears, Enter jumps to first result.
   ---------------------------------------------------------------- */
document.addEventListener('input', (e) => {
  if (e.target.id !== 'tabSearch') return;
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    searchQuery = e.target.value.trim();
    renderStaticDashboard();
  }, 120);
});

document.addEventListener('keydown', (e) => {
  // Escape closes the snapshot panel first, then the search box
  if (e.key === 'Escape') {
    hideChipPreview();
    const ov = document.getElementById('snapshotOverlay');
    if (ov && ov.classList.contains('open')) { closeSnapshots(); return; }
  }
  const searchEl = document.getElementById('tabSearch');
  if (!searchEl) return;
  const active   = document.activeElement;
  const typing   = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');

  // Chips are plain divs with tabindex=0 — make Enter activate the focused
  // chip so keyboard users get the same "jump to tab" action as clicking.
  if (e.key === 'Enter' && active && active.classList?.contains('page-chip')) {
    e.preventDefault();
    active.click();
    return;
  }

  if (e.key === '/' && active !== searchEl && !typing) {
    e.preventDefault();
    searchEl.focus();
    searchEl.select();
  } else if (e.key === 'Escape' && active === searchEl) {
    if (searchQuery) { searchQuery = ''; renderStaticDashboard(); }
    searchEl.value = '';
    searchEl.blur();
  } else if (e.key === 'Enter' && active === searchEl) {
    const first = document.querySelector('#openTabsMissions .page-chip[data-action="focus-tab"]');
    if (first) first.click();
  }
});


/* ----------------------------------------------------------------
   FAVICON FALLBACK — hide broken favicon images.
   Inline onerror attributes are blocked by the MV3 default CSP, so we
   use a single delegated listener in the capture phase (the 'error'
   event doesn't bubble).
   ---------------------------------------------------------------- */
document.addEventListener('error', (e) => {
  const el = e.target;
  if (el && el.tagName === 'IMG') el.style.display = 'none';
}, true);


/* ----------------------------------------------------------------
   CHIP HOVER PREVIEW (issue #6)

   One shared tooltip-like card shows a chip's full title + URL +
   domain after ~300ms of hover (instantly on keyboard focus). The
   card lives outside the re-rendered grid, fills its nodes with
   textContent only (zero innerHTML surface), and is pointer-events:
   none so it can sit above chips without ever stealing a click.
   ---------------------------------------------------------------- */

const PREVIEW_DELAY_MS = 300;
let previewTimer   = null;
let previewChipEl  = null;

function ensureChipPreviewEl() {
  let el = document.getElementById('chipPreview');
  if (!el) {
    el = document.createElement('div');
    el.id = 'chipPreview';
    el.className = 'chip-preview';
    el.setAttribute('role', 'tooltip');
    el.innerHTML = `
      <div class="chip-preview-head">
        <img class="chip-preview-favicon" alt="">
        <span class="chip-preview-domain"></span>
      </div>
      <div class="chip-preview-title"></div>
      <div class="chip-preview-url"></div>`;
    document.body.appendChild(el);
  }
  return el;
}

function hideChipPreview() {
  clearTimeout(previewTimer);
  previewTimer = null;
  previewChipEl = null;
  const el = document.getElementById('chipPreview');
  if (el) el.classList.remove('visible');
}

function showChipPreview(chip, { instant = false } = {}) {
  clearTimeout(previewTimer);

  const paint = () => {
    previewTimer = null;
    // A dashboard re-render may have replaced this chip mid-wait
    if (!chip.isConnected) return;

    const el      = ensureChipPreviewEl();
    const url     = chip.dataset.tabUrl || '';
    // The chip's title attribute carries the clean full label already
    const title   = chip.getAttribute('title') || url;
    let hostname  = '';
    try { hostname = new URL(url).hostname.replace(/^www\./, ''); } catch {}

    el.querySelector('.chip-preview-title').textContent  = title;
    el.querySelector('.chip-preview-url').textContent    = url;
    el.querySelector('.chip-preview-domain').textContent = hostname;
    const fav = el.querySelector('.chip-preview-favicon');
    fav.style.display = '';
    fav.src = url ? localFaviconUrl(url) : '';

    // Measure off-screen, position clamped to the viewport, then fade in
    el.classList.remove('visible');
    const rect = chip.getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    let x = Math.min(rect.left, window.innerWidth  - w - 8);
    let y = rect.top  - h - 8;                       // prefer above the chip
    if (y < 8) y = rect.bottom + 8;
    x = Math.max(8, Math.min(x, window.innerWidth  - w - 8));
    y = Math.max(8, Math.min(y, window.innerHeight - h - 8));
    el.style.left = `${Math.round(x)}px`;
    el.style.top  = `${Math.round(y)}px`;
    el.classList.add('visible');

    previewChipEl = chip;
  };

  if (instant) paint();
  else previewTimer = setTimeout(paint, PREVIEW_DELAY_MS);
}

// Mouse: hover the chip (or anything inside it, incl. action buttons)
document.addEventListener('mouseover', (e) => {
  const chip = e.target.closest?.('.page-chip[data-action="focus-tab"]');
  if (!chip) return;
  if (previewChipEl === chip) return; // already handled / painting
  showChipPreview(chip);
});

document.addEventListener('mouseout', (e) => {
  const chip = e.target.closest?.('.page-chip[data-action="focus-tab"]');
  if (!chip) return;
  if (chip.contains(e.relatedTarget)) return; // still inside this chip
  hideChipPreview();
});

// Keyboard: chips are focusable (tabindex=0); focus shows the preview
// instantly so keyboard users get the same information without waiting.
document.addEventListener('focusin', (e) => {
  const chip = e.target.closest?.('.page-chip[data-action="focus-tab"]');
  if (!chip) return;
  showChipPreview(chip, { instant: true });
});

document.addEventListener('focusout', (e) => {
  if (e.target.closest?.('.page-chip[data-action="focus-tab"]')) hideChipPreview();
});


/* ----------------------------------------------------------------
   QUICK LINKS (issue #7)

   Editable shortcut bar above the grid. Stored in chrome.storage.local
   as a "quickLinks" array of { id, url, title }. Everything is local:
   titles come from the user, an already-open tab's real document
   title, or the friendly hostname — never from a network fetch. The
   favicon is the same local chrome://favicon2 scheme the cards use.
   ---------------------------------------------------------------- */

async function getQuickLinks() {
  const { quickLinks = [] } = await chrome.storage.local.get('quickLinks');
  return quickLinks;
}

async function setQuickLinks(list) {
  await chrome.storage.local.set({ quickLinks: list });
}

// Title we'd store for this URL without any live information
function defaultQuickLinkTitle(url) {
  try { return friendlyDomain(new URL(url).hostname); }
  catch { return url; }
}

function normalizeQuickLinkUrl(raw) {
  let value = (raw || '').trim();
  if (!value) return '';
  // "localhost:3000/dev" reads as a scheme match otherwise; typed
  // host:port addresses are almost always meant as http.
  if (/^[a-z0-9.-]+:\d+([/?#].*)?$/i.test(value)) value = 'http://' + value;
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) value = 'https://' + value;
  try {
    const u = new URL(value);
    return (u.protocol === 'http:' || u.protocol === 'https:' ||
            u.protocol === 'file:') ? u.href : '';
  } catch { return ''; }
}

/**
 * renderQuickLinks()
 *
 * Paints the bar from storage. As a bonus, a link whose stored title is
 * still just the hostname default gets upgraded to the real document
 * title once Chrome has that tab open and titled.
 */
async function renderQuickLinks() {
  const section = document.getElementById('quickLinksSection');
  const chipsEl = document.getElementById('quickLinksChips');
  const toggle  = document.getElementById('quickLinksToggle');
  if (!section || !chipsEl) return;

  const { quickLinksCollapsed = false } = await chrome.storage.local.get('quickLinksCollapsed');
  section.classList.toggle('collapsed', quickLinksCollapsed);
  if (toggle) toggle.setAttribute('aria-expanded', String(!quickLinksCollapsed));

  const links    = await getQuickLinks();
  const titleFor = {};
  for (const t of getRealTabs()) if (t.title) titleFor[t.url] = t.title;

  // Upgrade hostname-default titles to real ones, silently
  let changed = false;
  for (const item of links) {
    if ((!item.title || item.title === defaultQuickLinkTitle(item.url)) && titleFor[item.url]) {
      item.title = cleanTitle(stripTitleNoise(titleFor[item.url]), '');
      changed = true;
    }
  }
  if (changed) await setQuickLinks(links);

  chipsEl.innerHTML = links.map(item => {
    const id     = escapeHtml(item.id);
    const url    = escapeHtml(isSafeNavUrl(item.url) ? item.url : '#');
    const title  = escapeHtml(item.title || defaultQuickLinkTitle(item.url));
    return `<div class="ql-chip" draggable="true" data-ql-id="${id}" data-ql-url="${url}" title="${title}">
      <img class="chip-favicon" src="${escapeHtml(localFaviconUrl(item.url))}" alt="">
      <button class="ql-text" data-action="open-quick-link" data-ql-id="${id}">${title}</button>
      <button class="ql-remove" data-action="remove-quick-link" data-ql-id="${id}" title="Remove shortcut">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
      </button>
    </div>`;
  }).join('');
}

/**
 * openQuickLink(url)
 *
 * Reuse an open tab when possible (exact URL first, then same host,
 * via focusTab), otherwise create a new one.
 */
async function openQuickLink(url) {
  if (!url) return;
  const allTabs = await chrome.tabs.query({});
  const hasExact = allTabs.some(t => t.url === url);
  if (!hasExact) {
    try {
      const host = new URL(url).hostname;
      const hasHost = allTabs.some(t => {
        try { return new URL(t.url).hostname === host; } catch { return false; }
      });
      if (!hasHost) {
        await chrome.tabs.create({ url, active: true });
        return;
      }
    } catch {}
  }
  await focusTab(url);
}

// Adding a shortcut: bare "example.com" becomes https://, a live tab's
// title fills in automatically, and re-adding an existing URL updates
// it instead of duplicating.
document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'qlAddForm') return;
  e.preventDefault();

  const urlInput   = document.getElementById('qlAddUrl');
  const titleInput = document.getElementById('qlAddTitle');
  const url = normalizeQuickLinkUrl(urlInput.value);
  if (!url) {
    showToast(t('quick.invalidUrl'));
    urlInput.focus();
    return;
  }

  const providedTitle = (titleInput.value || '').trim();
  let title = providedTitle;
  if (!title) {
    const open = await chrome.tabs.query({ url });
    const t    = open[0]?.title;
    title = t ? cleanTitle(stripTitleNoise(t), '') : defaultQuickLinkTitle(url);
  }

  const links    = await getQuickLinks();
  const existing = links.find(l => l.url === url);
  if (existing) existing.title = title;
  else links.push({ id: Date.now().toString(), url, title });

  await setQuickLinks(links);
  e.target.reset();
  e.target.hidden = true;
  await renderQuickLinks();
  showToast(existing ? t('quick.updated') : t('quick.added'));
});

/* ---- Quick-links drag & drop reorder (HTML5 dnd, delegated) ---- */
let qlDragId = null;

document.addEventListener('dragstart', (e) => {
  const chip = e.target.closest?.('.ql-chip');
  if (!chip) return;
  qlDragId = chip.dataset.qlId;
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', qlDragId); } catch {}
  requestAnimationFrame(() => chip.classList.add('ql-dragging'));
});

document.addEventListener('dragend', () => {
  qlDragId = null;
  document.querySelectorAll('.ql-chip').forEach(c =>
    c.classList.remove('ql-dragging', 'ql-drop-before', 'ql-drop-after'));
});

document.addEventListener('dragover', (e) => {
  if (!qlDragId) return;
  const chipsEl = document.getElementById('quickLinksChips');
  if (!chipsEl || !chipsEl.contains(e.target)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.ql-chip').forEach(c =>
    c.classList.remove('ql-drop-before', 'ql-drop-after'));
  const chip = e.target.closest('.ql-chip');
  if (chip && chip.dataset.qlId !== qlDragId) {
    // Left half → slot before this chip; right half → after it
    const rect   = chip.getBoundingClientRect();
    const before = e.clientX < rect.left + rect.width / 2;
    chip.classList.toggle('ql-drop-before', before);
    chip.classList.toggle('ql-drop-after', !before);
  }
});

document.addEventListener('drop', async (e) => {
  if (!qlDragId) return;
  const chipsEl = document.getElementById('quickLinksChips');
  if (!chipsEl || !chipsEl.contains(e.target)) return;
  e.preventDefault();

  const dragId = qlDragId;
  qlDragId     = null;
  const target = e.target.closest('.ql-chip');
  const links  = await getQuickLinks();
  const from   = links.findIndex(l => l.id === dragId);
  if (from === -1) { renderQuickLinks(); return; }
  const [moved] = links.splice(from, 1);

  if (!target || target.dataset.qlId === dragId || links.length === 0) {
    links.push(moved); // dropped past the last chip
  } else {
    let to = links.findIndex(l => l.id === target.dataset.qlId);
    if (!target.classList.contains('ql-drop-before')) to += 1;
    if (to < 0) to = 0;
    links.splice(to, 0, moved);
  }

  await setQuickLinks(links);
  await renderQuickLinks();
});


/* ----------------------------------------------------------------
   SESSION SNAPSHOTS (issue #1) — panel + restore.

   The engine lives in background.js (event-driven capture with
   leading+trailing throttle and rolling retention). This section
   renders the panel from chrome.storage.local and restores snapshots,
   grouped by their original windows, preserving pinned state.
   ---------------------------------------------------------------- */
const SNAP_KEY = 'sessionSnapshots';
const SNAP_SEEN_KEY = 'tab-out-snap-seen';
let expandedSnapId = null;

async function getSnapshots() {
  const { [SNAP_KEY]: data = {} } = await chrome.storage.local.get(SNAP_KEY);
  return data.snapshots || [];
}

// Local-calendar-day key (UTC slice would misgroup snapshots near midnight)
function localDayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dayLabel(key) {
  if (key === localDayKey(new Date())) return t('day.today');
  if (key === localDayKey(new Date(Date.now() - 86_400_000))) return t('day.yesterday');
  const [y, m, d] = key.split('-');
  return new Date(+y, +m - 1, +d, 12).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function fmtSnapTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function relTime(iso) {
  const ms = Date.now() - +new Date(iso);
  if (ms < 60_000) return t('time.justNow');
  if (ms < 3_600_000) return t('time.minRel', { n: Math.floor(ms / 60_000) });
  if (ms < 86_400_000) return t('time.hrRel', { n: Math.floor(ms / 3_600_000) });
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function fmtBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function domainOf(url) { try { return new URL(url).hostname; } catch { return ''; } }

const AV_COLORS = ['#24292f', '#c4302b', '#ea4335', '#1da1f2', '#5a7a62', '#5a6b7a', '#b35a5a', '#c8713a'];
function avatarHtml(domain) {
  if (!domain) return '';
  const clean = domain.replace(/^www\./, '');
  let h = 0;
  for (const c of clean) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const letter = clean[0] ? clean[0].toUpperCase() : '?';
  return `<span class="mini-avatar" style="background:${AV_COLORS[h % AV_COLORS.length]}">${escapeHtml(letter)}</span>`;
}

function updateSnapDot() {
  const dot = document.getElementById('snapDot');
  if (!dot) return;
  getSnapshots().then(snaps => {
    if (snaps.length === 0) { dot.hidden = true; return; }
    let seen = null;
    try { seen = localStorage.getItem(SNAP_SEEN_KEY); } catch {}
    dot.hidden = snaps[snaps.length - 1].id === seen;
  });
}

async function openSnapshots() {
  const ov = document.getElementById('snapshotOverlay');
  if (!ov) return;
  ov.classList.add('open');
  await renderSnapshotPanel();
  const snaps = await getSnapshots();
  if (snaps.length > 0) {
    try { localStorage.setItem(SNAP_SEEN_KEY, snaps[snaps.length - 1].id); } catch {}
  }
  updateSnapDot();
}

function closeSnapshots() {
  const ov = document.getElementById('snapshotOverlay');
  if (ov) ov.classList.remove('open');
}

async function renderSnapshotPanel() {
  const groupsEl  = document.getElementById('snapshotGroups');
  const storageEl = document.getElementById('snapshotStorage');
  if (!groupsEl) return;

  const snaps = (await getSnapshots()).slice().reverse(); // newest first

  if (storageEl) {
    try {
      const bytes = await chrome.storage.local.getBytesInUse(SNAP_KEY);
      storageEl.textContent = tCount('snap.keptStorage', snaps.length, { kept: tCount('snap.kept', snaps.length), size: fmtBytes(bytes) });
    } catch {
      storageEl.textContent = tCount('snap.kept', snaps.length);
    }
    storageEl.hidden = false;
  }

  if (snaps.length === 0) {
    groupsEl.innerHTML = `<div class="search-empty">${escapeHtml(t('snap.empty'))}</div>`;
    return;
  }

  const dayGroups = new Map();
  for (const s of snaps) {
    const k = localDayKey(new Date(s.id));
    if (!dayGroups.has(k)) dayGroups.set(k, []);
    dayGroups.get(k).push(s);
  }

  let html = '';
  for (const [k, list] of dayGroups) {
    html += `<div class="snapshot-group-label">${escapeHtml(dayLabel(k))}</div>`;
    html += list.map(renderSnapshotItem).join('');
  }
  groupsEl.innerHTML = html;
}

function renderSnapshotItem(s) {
  const seen = new Set();
  const domains = [];
  for (const t of s.tabs) {
    const d = domainOf(t.url);
    if (d && !seen.has(d)) { seen.add(d); domains.push(d); }
  }
  const avatars = domains.slice(0, 5).map(avatarHtml).join('');
  const more = domains.length > 5 ? `<span class="snapshot-more">+${domains.length - 5}</span>` : '';
  const idAttr = escapeHtml(s.id);
  const picker = expandedSnapId === s.id ? renderSnapshotPicker(s) : '';

  return `
  <div class="snapshot-item" data-snap-id="${idAttr}">
    <div class="snapshot-when">
      <div class="snapshot-time">${escapeHtml(fmtSnapTime(s.id))}</div>
      <div class="snapshot-date">${escapeHtml(relTime(s.id))}</div>
    </div>
    <div class="snapshot-what">
      <div class="snapshot-meta">${tCount('snap.meta', s.tabs.length, {
        windows: tCount('snap.windows', s.windows),
        sites:   tCount('search.sites', domains.length),
      })}</div>
      <div class="snapshot-domains">${avatars}${more}</div>
      ${picker}
    </div>
    <div class="snapshot-actions">
      <button class="snap-btn" data-action="snapshot-pick-toggle" data-snap-id="${idAttr}">${expandedSnapId === s.id ? t('snap.hidePicker') : t('snap.pickTabs')}</button>
      <button class="snap-btn primary" data-action="snapshot-restore-all" data-snap-id="${idAttr}">${escapeHtml(t('snap.restoreAll'))}</button>
    </div>
  </div>`;
}

function renderSnapshotPicker(s) {
  const byDomain = new Map();
  for (const t of s.tabs) {
    const d = domainOf(t.url) || t('snap.otherDomain');
    if (!byDomain.has(d)) byDomain.set(d, []);
    byDomain.get(d).push(t);
  }

  let rows = '';
  for (const [d, tabs] of byDomain) {
    rows += `
      <div class="picker-domain">
        ${avatarHtml(d)}
        <span>${escapeHtml(d)}</span>
        <button class="pick-all" data-action="snapshot-domain-all" data-snap-id="${escapeHtml(s.id)}" data-domain="${escapeHtml(d)}">${escapeHtml(t('snap.select'))}</button>
      </div>`;
    rows += tabs.map(t => `
      <label class="picker-row" data-domain="${escapeHtml(domainOf(t.url) || t('snap.otherDomain'))}">
        <input type="checkbox" class="snap-check" data-url="${escapeHtml(t.url)}">
        <span class="p-title" title="${escapeHtml(t.title || t.url)}">${escapeHtml(t.title || t.url)}</span>
        <span class="p-url">${escapeHtml(t.url)}</span>
      </label>`).join('');
  }

  return `
  <div class="snapshot-picker">
    ${rows}
    <div class="picker-foot">
      <button class="snap-btn" data-action="snapshot-cancel-pick" data-snap-id="${escapeHtml(s.id)}">${escapeHtml(t('snap.cancel'))}</button>
      <button class="snap-btn primary snap-restore-sel" data-action="snapshot-restore-sel" data-snap-id="${escapeHtml(s.id)}" disabled>${escapeHtml(tCount('snap.restoreSel', 0))}</button>
    </div>
  </div>`;
}

function updatePickCount(item) {
  if (!item) return;
  const n = item.querySelectorAll('.snap-check:checked').length;
  const btn = item.querySelector('.snap-restore-sel');
  if (btn) {
    btn.textContent = tCount('snap.restoreSel', n);
    btn.disabled = n === 0;
  }
}

/**
 * restoreSnapshot(snap, urls?)
 *
 * Restores all tabs, or the given subset. Tabs are grouped by the window
 * they belonged to when the snapshot was taken and re-created window by
 * window (fidelity: window assignment + pinned state are preserved).
 *
 * Native Chrome tab groups ride along (issue #5): tabs sharing a
 * groupId in the snapshot are re-grouped inside their restored window,
 * given the recorded title and color from snap.groups.
 */
async function restoreSnapshot(snap, urls) {
  const wanted = urls ? new Set(urls) : null;
  const tabsToRestore = snap.tabs.filter(t => !wanted || wanted.has(t.url));
  if (tabsToRestore.length === 0) return 0;
  const groupMeta = snap.groups || {};

  // A single tab just opens in the current window
  if (tabsToRestore.length === 1) {
    const t = tabsToRestore[0];
    await chrome.tabs.create({ url: t.url, pinned: !!t.pinned, active: true });
    return 1;
  }

  const winGroups = new Map();
  for (const t of tabsToRestore) {
    if (!winGroups.has(t.windowId)) winGroups.set(t.windowId, []);
    winGroups.get(t.windowId).push(t);
  }

  let restored = 0;
  let first = true;
  for (const gtabs of winGroups.values()) {
    gtabs.sort((a, b) => a.index - b.index);
    const win = await chrome.windows.create({ url: gtabs[0].url, focused: first });
    if (gtabs[0].pinned) {
      try { await chrome.tabs.update(win.tabs[0].id, { pinned: true }); } catch {}
    }
    restored++;
    // newTabIdsByGroup: old groupId → ids of the fresh tabs carrying it
    const newTabIdsByGroup = new Map();
    collectNewTabId(newTabIdsByGroup, gtabs[0], win.tabs[0].id);
    for (const t of gtabs.slice(1)) {
      const created = await chrome.tabs.create({
        windowId: win.id, url: t.url, pinned: !!t.pinned, active: false,
      });
      collectNewTabId(newTabIdsByGroup, t, created.id);
      restored++;
    }
    await regroupRestoredTabs(newTabIdsByGroup, groupMeta);
    first = false;
  }
  return restored;
}

function collectNewTabId(map, snapTab, newTabId) {
  if (snapTab && typeof snapTab.groupId === 'number' && snapTab.groupId !== -1) {
    if (!map.has(snapTab.groupId)) map.set(snapTab.groupId, []);
    map.get(snapTab.groupId).push(newTabId);
  }
}

/**
 * regroupRestoredTabs(byOldGroup, groupMeta)
 *
 * Re-creates native groups from a restore batch: one real group per old
 * groupId that has metadata, named and colored as recorded. Old groupIds
 * are meaningless after restore — everything maps to fresh groups.
 */
async function regroupRestoredTabs(byOldGroup, groupMeta) {
  for (const [oldGid, tabIds] of byOldGroup) {
    const info = groupMeta[oldGid];
    if (!info || tabIds.length === 0) continue;
    try {
      const gid = await chrome.tabs.group({ tabIds });
      const patch = {};
      if (info.title) patch.title = info.title;
      if (info.color) patch.color = info.color;
      if (Object.keys(patch).length > 0) await chrome.tabGroups.update(gid, patch);
    } catch {
      // Grouping loss is cosmetic — never fail the restore over it
    }
  }
}

// Click on the dimmed backdrop closes the panel
const snapOverlayEl = document.getElementById('snapshotOverlay');
if (snapOverlayEl) snapOverlayEl.addEventListener('click', (e) => {
  if (e.target === snapOverlayEl) closeSnapshots();
});

// Live "Restore N selected" count as checkboxes change
document.addEventListener('change', (e) => {
  if (e.target.classList.contains('snap-check')) {
    updatePickCount(e.target.closest('.snapshot-item'));
  }
});


/* ----------------------------------------------------------------
   SETTINGS — "take over the new tab page" toggle.

   Stored in chrome.storage.local under "takeoverNewTab" (absent = true).
   The manifest's chrome_url_overrides can't change at runtime, so the
   new tab page itself decides what to render: when takeover is off, it
   shows a minimal page and never steals focus, letting Chrome keep the
   omnibox focused — a native new tab feel. The dashboard stays one
   click away via the toolbar icon or Alt+T (index.html?entry=icon).
   ---------------------------------------------------------------- */
document.addEventListener('change', async (e) => {
  if (e.target.id !== 'takeoverToggle') return;
  const takeover = e.target.checked;
  await chrome.storage.local.set({ takeoverNewTab: takeover });
  showToast(takeover ? t('takeover.onToast') : t('takeover.offToast'));
});

// Close the settings popover when clicking anywhere outside it
document.addEventListener('click', (e) => {
  const pop = document.getElementById('settingsPopover');
  if (!pop || pop.hidden) return;
  if (!pop.contains(e.target) && !e.target.closest('.settings-btn')) {
    pop.hidden = true;
    const btn = document.querySelector('.settings-btn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }
});


// Keep speaker indicators live: audio starts/stops on background tabs
// without the user touching anything. Some Chrome builds don't surface
// audible transitions through onUpdated changeInfo, so we also poll a
// cheap audible/muted signature and re-render only when it changes.
let audioRefreshTimer = null;
let audioSignature   = '';
function scheduleAudioRefresh() {
  clearTimeout(audioRefreshTimer);
  audioRefreshTimer = setTimeout(() => renderDashboard(), 300);
}
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (!('audible' in info) && !('mutedInfo' in info)) return;
  scheduleAudioRefresh();
});

// Renaming / recoloring / grouping while the dashboard is open should
// show up without waiting for the next render cycle
if (chrome.tabGroups?.onUpdated) {
  chrome.tabGroups.onUpdated.addListener(() => scheduleAudioRefresh());
}

setInterval(async () => {
  // Don't yank the page out from under an in-progress interaction
  const active   = document.activeElement;
  const typing   = active && (active.id === 'tabSearch' || active.tagName === 'TEXTAREA' || active.tagName === 'INPUT');
  const panelOpen = document.getElementById('snapshotOverlay')?.classList.contains('open');
  if (typing || panelOpen) return;
  try {
    const tabs = await chrome.tabs.query({});
    const sig  = tabs.map(t => (t.audible ? 'A' : '-') + (t.mutedInfo?.muted ? 'M' : '-')).join('');
    if (sig !== audioSignature) {
      const hadAudio = audioSignature.includes('A');
      audioSignature = sig;
      // Skip the very first run's guaranteed-mismatch full redraw unless
      // any audio state exists either way (cheap anyway, but be tidy)
      if (hadAudio || sig.includes('A')) renderDashboard();
    }
  } catch {}
}, 4000);


/* ----------------------------------------------------------------
   INITIALIZE
   ---------------------------------------------------------------- */
async function applyLanguage() {
  applyI18nStatic();
  await renderDashboard();          // includes quick links + dupe banner
  const ov = document.getElementById('snapshotOverlay');
  if (ov?.classList.contains('open')) await renderSnapshotPanel();
}

// Language selector in the settings popover (issue #9)
document.addEventListener('change', async (e) => {
  if (e.target.id !== 'languageSelect') return;
  await I18N.setLanguage(e.target.value);
  showToast(I18N.locale === 'zh-CN' ? '界面语言已切换' : 'Language switched');
  await applyLanguage();
});

async function init() {
  await I18N.init();
  applyI18nStatic();
  try {
    const { uiLanguage = 'auto' } = await chrome.storage.local.get('uiLanguage');
    const sel = document.getElementById('languageSelect');
    if (sel) sel.value = uiLanguage;
  } catch {}

  initThemeSwitcher();
  updateSnapDot();
  renderQuickLinks();

  // Reflect the stored takeover setting in the toggle
  const { takeoverNewTab = true } = await chrome.storage.local.get('takeoverNewTab');
  const toggle = document.getElementById('takeoverToggle');
  if (toggle) toggle.checked = takeoverNewTab;

  // New tab load with takeover disabled → minimal page, skip the dashboard.
  // Explicit entry (toolbar icon / Alt+T) always renders the dashboard.
  const explicitEntry = new URLSearchParams(location.search).get('entry') === 'icon';
  if (!takeoverNewTab && !explicitEntry) {
    document.body.classList.add('minimal-newtab');
    const container = document.querySelector('.container');
    if (container) container.remove();
    const hint = document.createElement('div');
    hint.className = 'minimal-hint';
    hint.textContent = t('minimal.hint');
    document.body.appendChild(hint);
    return;
  }

  renderDashboard();
}
init();
