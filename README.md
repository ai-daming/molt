# Molt

**Shed your old tabs.**

Molt is a Chrome extension that replaces your new tab page with a dashboard of everything you have open. Tabs are grouped by domain, so you can see the whole herd at a glance — and close what you're done with, satisfying swoosh + confetti included.

Closing is **reversible**: session snapshots are taken automatically as your tabs change, so you can sweep boldly and restore anything you miss.

No server. No account. No external API calls. Nothing leaves your machine.

---

## Install with a coding agent

Send your coding agent (Claude Code, Codex, etc.) this repo and say **"install this"**:

```
https://github.com/ai-daming/molt
```

The agent will walk you through it. Takes about 1 minute.

---

## Manual Setup

**1. Clone the repo**

```bash
git clone https://github.com/ai-daming/molt.git
```

**2. Load the Chrome extension**

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Navigate to the `extension/` folder inside the cloned repo and select it

**3. Open a new tab**

You'll see Molt.

---

## Features

- **See all your tabs at a glance** — clean grid grouped by domain, homepages (Gmail, X, YouTube, GitHub…) pulled into their own card
- **Global search** — press `/` anywhere on the page, filter by title or URL, `Enter` jumps to the first match
- **Find the noisy tab** — amber speaker markers appear on chips while a tab plays audio; click one to mute, or silence everything at once
- **Session snapshots** — auto-saved as your tabs change; restore all or pick individual tabs, with window grouping and pinned state preserved
- **Two ways in** — takes over your new tab page by default (optional: turn it off in settings), or summon it from any page via the toolbar icon / `Alt+T`
- **Duplicate detection** — the same page open twice gets flagged, one-click cleanup
- **Save for later** — bookmark tabs to a checklist before closing them
- **Localhost grouping** — port numbers shown next to each tab, so your dev projects stay apart
- **Themes** — warm / midnight / arctic / forest; follows your OS color scheme until you pick one
- **100% local** — your data never leaves your machine

---

## How it works

```
You open a new tab (or click the toolbar icon / press Alt+T)
  -> Molt shows your open tabs grouped by domain
  -> Press / to search, spot the noisy tab, sweep duplicates
  -> Close groups you're done with (swoosh + confetti)
  -> Changed your mind? Restore from a session snapshot
```

Everything runs inside the Chrome extension. No external server, no API calls, no data sent anywhere. Saved tabs and snapshots live in `chrome.storage.local`.

---

## Tech stack

| What | How |
|------|-----|
| Extension | Chrome Manifest V3 |
| Storage | chrome.storage.local |
| Sound | Web Audio API (synthesized, no files) |
| Animations | CSS transitions + JS confetti particles |

---

## Attribution & license

Molt is an actively maintained fork of [Tab Out](https://github.com/zarazhangrui/tab-out) by [Zara Zhang](https://x.com/zarazhangrui), MIT licensed — see `LICENSE` and `NOTICE`. It incorporates security fixes from Tab Out's unmerged [PR #29](https://github.com/zarazhangrui/tab-out/pull/29) by [@SivanCola](https://github.com/SivanCola), plus fixes and ideas from the Tab Out fork community.

MIT
