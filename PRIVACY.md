# Molt Privacy Policy

Last updated: 2026-08-26

Molt is a browser extension. This policy is short because the product is simple: **it collects nothing.**

## What Molt does not do

- No accounts, no sign-in, no identifiers of any kind
- No servers — the extension has no backend to send anything to
- No analytics, telemetry, or crash reporting
- No advertising or data monetization, ever
- No external requests — the extension makes zero network calls (icons come from your browser's own local favicon database)

## What stays on your device

Everything Molt stores lives in `chrome.storage.local` on your machine:

- Your theme choice and settings
- Your "saved for later" list
- Session snapshots (the list of tabs you had open, taken automatically)

Deleting the extension removes all of it. Nothing was ever sent anywhere, so there is nothing to delete anywhere else.

## Permissions and why

- **tabs** — to display your open tabs on the dashboard (grouping, duplicates, audio badges, snapshots). The data is shown to you, on your own new tab page, and never leaves the device.
- **activeTab** — to open/focus the dashboard when you click the toolbar icon.
- **storage** — to save the items listed above, locally.

## Source code

Molt is fully open source: https://github.com/ai-daming/molt — you can verify every claim above by reading it.

## Contact

Open an issue at https://github.com/ai-daming/molt/issues for any privacy question.

---

Molt is based on Tab Out by Zara Zhang (MIT). This policy covers the Molt fork only.
