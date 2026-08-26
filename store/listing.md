# Chrome Web Store 上架材料 — Molt 1.0.0

> 使用方法：开发者控制台（https://chrome.google.com/webstore/devconsole）→ 新 item →
> 上传 `dist/molt-1.0.0.zip` → 下列文案逐栏粘贴 → 截图按 shot-list.md 拍摄上传 → 提交审核。

---

## 一、列表信息（英文主版本）

**Name**：**在 manifest.json 里设置，商店回显，列表页不可单独编辑**（已设为
`Molt — New Tab Dashboard`）。控制台里 Name 显示为灰字是正常的。

**Summary**（≤132 字符）：
```
Shed your old tabs. A local-first dashboard of everything you have open — search, mute, snapshot & restore. No account, no tracking.
```
（126 字符 ✓）

**Category**：分组下拉（组标题不可选）→ **PRODUCTIVITY → Tools**
（标签管理类的标准归类；Language 选 English，zh-CN 本地化上架后再加）

**Language**：English（可另加 zh-CN 本地化，见下）

**Description**：

```
Shed your old tabs.

Molt turns your new tab page into a mission control for everything you have open. Tabs are grouped by domain so you can see the whole herd at a glance — then close what you're done with, satisfying swoosh and confetti included.

Closing is reversible. Session snapshots are taken automatically as your tabs change, so you can sweep boldly and restore anything you miss — with window layout and pinned tabs preserved.

100% LOCAL. NO ACCOUNT. NO TRACKING.
No external requests, no analytics, no servers. Everything lives in your browser's local storage. Delete the extension and every trace is gone.

WHY MOLT
• See everything — open tabs grouped by domain, homepages (Gmail, X, YouTube, GitHub…) in their own card
• Find anything — press / to search titles and URLs, Enter jumps to the first match
• Silence anything — amber speaker badges mark tabs that are playing audio; mute one or all in a click
• Close with confidence — duplicate detection, one-click dedupe, and session snapshots that make every close reversible
• Two ways in — takes over your new tab page (optional, switchable) or summon from any page via toolbar icon / Alt+T
• Four themes — warm paper, midnight, arctic, forest; follows your OS color scheme until you pick one
• Made for real work — localhost tabs grouped by port, saved-for-later checklist, dev-friendly

BUILT ON OPEN SOURCE
Molt is an actively maintained fork of Tab Out by Zara Zhang (MIT), with security fixes from the community. Source: https://github.com/ai-daming/molt
```

---

## 二、列表信息（zh-CN 本地化，可选但建议加）

**名称**：
```
Molt — 新标签页仪表盘
```

**简介**：
```
蜕掉旧标签。本地优先的打开标签仪表盘：搜索、静音、快照与恢复。无账号、无追踪、零外联。
```

**描述**：

```
蜕掉你的旧标签。

Molt 把新标签页变成所有打开标签的指挥台：按域名分组，一眼看清整个"标签群"，关掉看完的——swoosh 音效和彩纸礼花相送。

关闭是可逆的。标签变动时自动生成会话快照，放心大胆地清扫，错关了随时恢复——窗口布局和固定标签都会还原。

100% 本地。无账号。无追踪。
零外部请求、无统计、无服务器，一切都在浏览器本地。删除扩展，痕迹清零。

WHY MOLT
• 全局一览 —— 打开标签按域名分组，Gmail/X/YouTube/GitHub 首页独立成卡
• 按任意键即搜 —— 按 / 搜索标题与网址，回车直达第一个结果
• 一键静音 —— 琥珀色扬声器标记正在出声的标签，单个或全部一键静音
• 放心关 —— 重复检测、一键去重，会话快照让每次关闭都可逆
• 双入口 —— 接管新标签页（可选可关），或任意页面点图标 / Alt+T 唤起
• 四套主题 —— 暖纸/午夜/极地/森林，未手动选择时跟随系统深浅
• 为真实工作设计 —— localhost 按端口分组、稍后读清单、开发者友好

开源衍生
Molt 是 Zara Zhang 的 Tab Out（MIT）的活跃维护分支，包含社区安全修复。源码：https://github.com/ai-daming/molt
```

---

## 三、图形素材规格

- 截图：5 张，1280×800 PNG（必须是真实界面，禁止过度加工）
- 小图标（store icon）：用 `extension/icons/icon128.png` 已符合 128×128
- 商店横幅（可选）：440×280，可后续补
