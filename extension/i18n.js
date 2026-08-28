/* ================================================================
   Molt — i18n runtime (issue #9)

   One shared dictionary object. app.js reaches it through the global
   helpers t() / tCount(); static HTML strings are translated via
   data-i18n / data-i18n-placeholder / data-i18n-title attributes at
   startup and on every language change.

   Language resolution: stored choice wins ("auto" = follow Chrome's
   UI language). Manifest name/description live in _locales/ (MV3
   standard), so CWS can localize them too.
   ================================================================ */

'use strict';

const I18N = (() => {
  const LANG_KEY  = 'uiLanguage';
  const SUPPORTED = ['en', 'zh-CN'];

  let currentLocale = 'en';

  /* ----------------------------------------------------------------
     Dictionaries.

     A value is a plain string, or { one, other } for count strings:
     tCount picks "one" vs "other" by English plural rules for en and
     always "other" for zh-CN. Placeholders look like {name}.
     ---------------------------------------------------------------- */
  const DICTS = {
    'en': {
      // Header / greetings / dates
      'greeting.morning':   'Good morning',
      'greeting.afternoon': 'Good afternoon',
      'greeting.evening':   'Good evening',

      // Tabs & cards
      'tabs.openBadge':        { one: '{n} tab open', other: '{n} tabs open' },
      'tabs.dupeBadge':        { one: '{n} duplicate', other: '{n} duplicates' },
      'tabs.closeAll':         { one: 'Close all {n} tab', other: 'Close all {n} tabs' },
      'tabs.closeDupes':       { one: 'Close {n} duplicate', other: 'Close {n} duplicates' },
      'tabs.pageLabel':        'tabs',
      'tabs.more':             '+{n} more',
      'tabs.domainsLine':      { one: '{n} domain', other: '{n} domains' },
      'tabs.mutePlaying':      { one: 'Mute {n} playing', other: 'Mute {n} playing' },
      'tabs.countLabel':       { one: '{n} tab', other: '{n} tabs' },

      // Chip actions + lock (issue #8)
      'chip.save':             'Save for later',
      'chip.close':            'Close this tab',
      'chip.audioMutedTitle':  'Muted — click to unmute',
      'chip.audioOnTitle':     'Playing audio — click to mute',
      'chip.lockTitle':        'Lock this tab',
      'chip.lockedTitle':      'Locked — click to unlock',

      // Section headers / search
      'section.openTabs':    'Open tabs',
      'section.savedLater':  'Saved for later',
      'search.matches':      { one: '<b>{n}</b> match for “{q}” in {sites}', other: '<b>{n}</b> matches for “{q}” in {sites}' },
      'search.sites':        { one: '{n} site', other: '{n} sites' },
      'search.noMatches':    'No matches for “{q}”',
      'search.emptyHint':    'Nothing found — try a shorter query, or press Esc to clear.',
      'search.placeholder':  'Search tabs  ( / )',
      'archive.noResults':   'No results',

      // Empty states
      'empty.checkmarkTitle': 'Inbox zero, but for tabs.',
      'empty.checkmarkSub':   "You're free.",
      'empty.zeroDomains':    '0 domains',
      'empty.deferred':       'Nothing saved. Living in the moment.',

      // Saved for later
      'deferred.items':      { one: '{n} item', other: '{n} items' },
      'deferred.dismiss':    'Dismiss',
      'archive.label':       'Archive',
      'archive.placeholder': 'Search archived tabs...',

      // Quick links (issue #7)
      'quick.title':          'Quick links',
      'quick.add':            'Add shortcut',
      'quick.remove':         'Remove shortcut',
      'quick.toggle':         'Collapse or expand quick links',
      'quick.urlPlaceholder': 'https://example.com',
      'quick.namePlaceholder':'Name (optional)',
      'quick.added':          'Shortcut added',
      'quick.updated':        'Shortcut updated',
      'quick.removed':        'Shortcut removed',
      'quick.invalidUrl':     'Enter a valid web address',

      // Locks (issue #8)
      'lock.lockedToast':      'Tab locked — bulk close will skip it',
      'lock.unlockedToast':    'Tab unlocked',
      'lock.singleBlocked':    'This tab is locked — click the open lock to unlock first',
      'lock.closedKept':       'Closed {closed} from {label} — kept {skipped} locked',
      'lock.keptGlobal':       'Closed {closed} — kept {skipped} locked',
      'lock.dedupeKept':       'Closed {closed} duplicates — kept {skipped} locked',
      'lock.allFreshKept':     'Closed {closed} — kept {skipped} locked',

      // Toasts / actions
      'toast.tabClosed':      'Tab closed',
      'toast.savedLater':     'Saved for later',
      'toast.saveFailed':     'Failed to save tab',
      'toast.muted':          { one: 'Muted {n} tab', other: 'Muted {n} tabs' },
      'toast.unmuted':        { one: 'Unmuted {n} tab', other: 'Unmuted {n} tabs' },
      'toast.mutedPlaying':   { one: 'Muted {n} playing tab', other: 'Muted {n} playing tabs' },
      'toast.domainClosed':   { one: 'Closed {n} tab from {label}', other: 'Closed {n} tabs from {label}' },
      'toast.dedupeDone':     'Closed duplicates, kept one copy each',
      'toast.freshStart':     'All tabs closed. Fresh start.',
      'toast.restored':       { one: 'Restored {n} tab from {when}', other: 'Restored {n} tabs from {when}' },
      'toast.taboutClosed':   'Closed extra Molt tabs',
      'banner.dupesOpen':     'You have <strong>{n}</strong> Molt tabs open. Keep just this one?',
      'banner.closeExtras':   'Close extras',
      'defer.one':            'Dismiss',

      // Time formatting
      'time.justNow':  'just now',
      'time.minAgo':   '{n} min ago',
      'time.hrAgo':    { one: '{n} hr ago', other: '{n} hrs ago' },
      'time.yesterday':'yesterday',
      'time.daysAgo':  '{n} days ago',
      'time.minRel':   '{n}m ago',
      'time.hrRel':    '{n}h ago',
      'day.today':     'Today',
      'day.yesterday': 'Yesterday',

      // Hover preview increment (issue #6)
      'preview.dupes':      { one: '{n} copy of this URL is open', other: '{n} copies of this URL are open' },
      'preview.playing':    'Playing audio',
      'preview.muted':      'Muted',
      'preview.locked':     'Locked — bulk close skips it',
      'preview.saved':      'In Saved for later',
      'preview.lastActive': 'Active {when}',

      // Snapshots panel
      'snap.title':           'Session snapshots',
      'snap.subtitle':        'Auto-saved as your tabs change  ·  100% local, nothing leaves your machine',
      'snap.retention':       'Keeps every change today  ·  snapshots for the last 48 h  ·  one per day after that',
      'snap.keptStorage':     '{kept} · ~{size}',
      'snap.kept':            { one: '{n} snapshot kept', other: '{n} snapshots kept' },
      'snap.empty':           'Nothing here yet — snapshots are taken automatically as your tabs change.',
      'snap.meta':            '<b>{tabs}</b> · {windows} · {sites}',
      'snap.windows':         { one: '{n} window', other: '{n} windows' },
      'snap.pickTabs':        'Pick tabs…',
      'snap.hidePicker':      'Hide picker',
      'snap.restoreAll':      'Restore all',
      'snap.select':          'select all',
      'snap.cancel':          'Cancel',
      'snap.restoreSel':      'Restore {n} selected',
      'snap.restoring':       'Restoring…',
      'snap.close':           'Close',
      'snap.otherDomain':     '(other)',
      'snap.btnTitle':        'Session snapshots',

      // Settings / takeover
      'settings.title':       'Settings',
      'settings.takeover':    'Take over the new tab page',
      'settings.hint':        'Off: Cmd+T stays native; open the dashboard via the toolbar icon or Alt+T.',
      'settings.language':    'Language',
      'settings.langAuto':    'Auto (browser)',
      'takeover.onToast':     'New tab takeover on — takes effect on your next new tab',
      'takeover.offToast':    'New tab takeover off — dashboard now opens via icon or Alt+T',
      'minimal.hint':         'Molt is not taking over new tabs — open the dashboard via the toolbar icon or Alt+T',

      // Themes (titles)
      'theme.warm':     'Warm paper',
      'theme.midnight': 'Midnight',
      'theme.arctic':   'Arctic frost',
      'theme.forest':   'Forest canopy',
      'theme.group':    'Theme',

      // Tab groups (issue #5)
      'group.create':        'Create tab group',
      'group.createTitle':   "Put this site's tabs into a native Chrome tab group",
      'group.created':       { one: 'Grouped {n} tab', other: 'Grouped {n} tabs' },
      'group.createFailed':  "Couldn't create the tab group",
      'footer.statLabel':'Open tabs',
    },

    'zh-CN': {
      'greeting.morning':   '早上好',
      'greeting.afternoon': '下午好',
      'greeting.evening':   '晚上好',

      'tabs.openBadge':        '{n} 个标签页打开中',
      'tabs.dupeBadge':        '{n} 个重复',
      'tabs.closeAll':         '关闭全部 {n} 个标签页',
      'tabs.closeDupes':       '关闭 {n} 个重复标签页',
      'tabs.pageLabel':        '个标签页',
      'tabs.more':             '还有 {n} 个',
      'tabs.domainsLine':      '{n} 个站点',
      'tabs.mutePlaying':      '静音 {n} 个正在播放的标签页',
      'tabs.countLabel':       '{n} 个标签页',

      'chip.save':             '稍后读',
      'chip.close':            '关闭此标签页',
      'chip.audioMutedTitle':  '已静音 — 点击取消静音',
      'chip.audioOnTitle':     '正在播放声音 — 点击静音',
      'chip.lockTitle':        '锁定此标签页',
      'chip.lockedTitle':      '已锁定 — 点击解锁',

      'section.openTabs':    '打开的标签页',
      'section.savedLater':  '稍后读清单',
      'search.matches':      '“{q}” 在 {sites} 中匹配到 <b>{n}</b> 条',
      'search.sites':        '{n} 个站点',
      'search.noMatches':    '没有匹配“{q}”的结果',
      'search.emptyHint':    '没找到 — 换个更短的关键词，或按 Esc 清空。',
      'search.placeholder':  '搜索标签页（快捷键 / ）',
      'archive.noResults':   '无结果',

      'empty.checkmarkTitle': '所有标签都清零了。',
      'empty.checkmarkSub':   '彻底自由了。',
      'empty.zeroDomains':    '0 个站点',
      'empty.deferred':       '这里还什么都没存。活在当下。',

      'deferred.items':      '{n} 条',
      'deferred.dismiss':    '忽略',
      'archive.label':       '归档',
      'archive.placeholder': '搜索已归档的标签页...',

      'quick.title':          '快捷方式',
      'quick.add':            '添加快捷方式',
      'quick.remove':         '移除快捷方式',
      'quick.toggle':         '收起或展开快捷方式',
      'quick.urlPlaceholder': 'https://example.com',
      'quick.namePlaceholder':'名称（可选）',
      'quick.added':          '已添加快捷方式',
      'quick.updated':        '已更新快捷方式',
      'quick.removed':        '已移除快捷方式',
      'quick.invalidUrl':     '请输入有效的网址',

      'lock.lockedToast':      '已锁定 — 批量关闭会跳过它',
      'lock.unlockedToast':    '已解锁',
      'lock.singleBlocked':    '该标签页已锁定 — 点击开锁图标先解锁',
      'lock.closedKept':       '从{label}关闭 {closed} 个，保留 {skipped} 个锁定的',
      'lock.keptGlobal':       '已关闭 {closed} 个，保留 {skipped} 个锁定的',
      'lock.dedupeKept':       '已关闭 {closed} 个重复，保留 {skipped} 个锁定的',
      'lock.allFreshKept':     '已关闭 {closed} 个，保留 {skipped} 个锁定的',

      'toast.tabClosed':      '标签页已关闭',
      'toast.savedLater':     '已存入稍后读',
      'toast.saveFailed':     '保存失败',
      'toast.muted':          '已静音 {n} 个标签页',
      'toast.unmuted':        '已取消静音 {n} 个标签页',
      'toast.mutedPlaying':   '已静音 {n} 个正在播放的标签页',
      'toast.domainClosed':   '已从{label}关闭 {n} 个标签页',
      'toast.dedupeDone':     '已去重，各保留一份',
      'toast.freshStart':     '全部关闭，焕然一新。',
      'toast.restored':       '已从{when}恢复 {n} 个标签页',
      'toast.taboutClosed':   '多余的 Molt 页已关闭',
      'banner.dupesOpen':     '你开着 <strong>{n}</strong> 个 Molt 页面。只保留这一个？',
      'banner.closeExtras':   '关闭多余的',
      'defer.one':            '忽略',

      'time.justNow':  '刚刚',
      'time.minAgo':   '{n} 分钟前',
      'time.hrAgo':    '{n} 小时前',
      'time.yesterday':'昨天',
      'time.daysAgo':  '{n} 天前',
      'time.minRel':   '{n} 分钟前',
      'time.hrRel':    '{n} 小时前',
      'day.today':     '今天',
      'day.yesterday': '昨天',

      // 悬停预览增量信息（issue #6）
      'preview.dupes':      '这个网址开着 {n} 个标签页',
      'preview.playing':    '正在播放声音',
      'preview.muted':      '已静音',
      'preview.locked':     '已锁定，批量关闭会跳过',
      'preview.saved':      '已在稍后读清单',
      'preview.lastActive': '{when}活跃',

      'snap.title':           '会话快照',
      'snap.subtitle':        '随标签页变化自动保存 · 全部本地存储，数据不出你的电脑',
      'snap.retention':       '今天的每次变化都会保留 · 最近 48 小时的快照 · 再往后每天一份',
      'snap.keptStorage':     '{kept} · 约 {size}',
      'snap.kept':            '保留了 {n} 份快照',
      'snap.empty':           '还没有快照 — 标签页有变化时会自动拍摄。',
      'snap.meta':            '<b>{tabs}</b> · {windows} · {sites}',
      'snap.windows':         '{n} 个窗口',
      'snap.pickTabs':        '挑选标签页…',
      'snap.hidePicker':      '收起选择',
      'snap.restoreAll':      '全部恢复',
      'snap.select':          '全选',
      'snap.cancel':          '取消',
      'snap.restoreSel':      '恢复所选 {n} 个',
      'snap.restoring':       '恢复中…',
      'snap.close':           '关闭',
      'snap.otherDomain':     '（其他）',
      'snap.btnTitle':        '会话快照',

      'settings.title':       '设置',
      'settings.takeover':    '接管新标签页',
      'settings.hint':        '关闭后：Cmd+T 保持原生新标签；通过工具栏图标或 Alt+T 打开仪表盘。',
      'settings.language':    '界面语言',
      'settings.langAuto':    '自动（跟随浏览器）',
      'takeover.onToast':     '新标签页接管已开启 — 下次新建标签页时生效',
      'takeover.offToast':    '新标签页接管已关闭 — 通过图标或 Alt+T 打开仪表盘',
      'minimal.hint':         'Molt 未接管新标签页 — 通过工具栏图标或 Alt+T 打开仪表盘',

      'theme.warm':     '暖纸',
      'theme.midnight': '午夜',
      'theme.arctic':   '霜蓝',
      'theme.forest':   '松林',
      'theme.group':    '主题',

      'group.create':        '转为标签组',
      'group.createTitle':   '把这个站点的标签页在 Chrome 标签条上编为一个原生标签组',
      'group.created':       '已将 {n} 个标签页编入标签组',
      'group.createFailed':  '创建标签组失败',
      'footer.statLabel':'打开的标签页',
    },
  };

  function browserUILanguage() {
    try {
      if (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage) {
        return chrome.i18n.getUILanguage();
      }
    } catch {}
    return (typeof navigator !== 'undefined' && navigator.language) || 'en';
  }

  function normalize(tag) {
    const lower = String(tag || '').toLowerCase();
    if (lower.startsWith('zh')) return 'zh-CN';
    return 'en';
  }

  async function init() {
    let stored = null;
    try {
      const { [LANG_KEY]: saved } = await chrome.storage.local.get(LANG_KEY);
      stored = saved || null;
    } catch {}
    currentLocale = stored && stored !== 'auto'
      ? normalize(stored)
      : normalize(browserUILanguage());
    return currentLocale;
  }

  /** Re-resolve after a settings change; persists the raw choice ('auto' allowed). */
  async function setLanguage(choice) {
    try { await chrome.storage.local.set({ [LANG_KEY]: choice }); } catch {}
    currentLocale = choice === 'auto' ? normalize(browserUILanguage()) : normalize(choice);
    return currentLocale;
  }

  function interpolate(template, vars) {
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (_, k) =>
      Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : `{${k}}`);
  }

  /**
   * t(key, vars) — plain lookup with {placeholder} interpolation.
   * Missing keys fall back to English, then to the key itself, so a
   * forgotten translation degrades instead of rendering blanks.
   */
  function t(key, vars) {
    const dict = DICTS[currentLocale] || DICTS.en;
    let value = dict[key];
    if (value == null) value = DICTS.en[key];
    if (value == null) return key;
    if (typeof value !== 'string') value = value.other;
    return interpolate(value, vars);
  }

  /**
   * tCount(key, n, vars) — plural-aware lookup; n is also available as
   * the {n} placeholder. Chinese has no plural forms, so "other" wins.
   */
  function tCount(key, n, vars) {
    const dict = DICTS[currentLocale] || DICTS.en;
    let value = dict[key] != null ? dict[key] : DICTS.en[key];
    if (value == null) return key;
    const form = typeof value === 'string'
      ? value
      : (currentLocale === 'zh-CN' ? value.other : (n === 1 ? value.one : value.other));
    return interpolate(form, { ...(vars || {}), n });
  }

  return {
    SUPPORTED,
    init,
    setLanguage,
    get locale() { return currentLocale; },
    t,
    tCount,
    DICTS,
  };
})();

// Global shims used throughout app.js
function t(key, vars)            { return I18N.t(key, vars); }
function tCount(key, n, vars)    { return I18N.tCount(key, n, vars); }

/**
 * applyI18nStatic(root)
 *
 * Translates the server-less static markup in index.html: elements with
 * data-i18n (textContent), data-i18n-html (innerHTML, dictionary-only),
 * data-i18n-placeholder, data-i18n-title, and data-i18n-aria.
 */
function applyI18nStatic(root) {
  const scope = root || document;
  scope.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  scope.querySelectorAll('[data-i18n-html]').forEach(el => {
    el.innerHTML = t(el.dataset.i18nHtml); // dictionary-sourced markup only
  });
  scope.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));
  });
  scope.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.setAttribute('title', t(el.dataset.i18nTitle));
  });
  scope.querySelectorAll('[data-i18n-aria]').forEach(el => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  });
}
