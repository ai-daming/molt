# Roadmap

产品名：**Molt**（2026-08-26 定名，GitHub/CWS/AMO 三处查重通过）。上游：[zarazhangrui/tab-out](https://github.com/zarazhangrui/tab-out) (MIT)。
定位：**本地优先、无账号、无追踪的新标签页标签仪表盘**，长期维护，目标上架 Chrome Web Store。

## 定位红线（永远不做）

- 无广告、无数据变现、无电商返利（Infinity/WeTab 教训）
- 不对已有免费功能收费（Toby 教训）
- 不强制账号（保持"装上即用"）
- 权限保持最小：`tabs` / `activeTab` / `storage`

## Phase 0 — 安全与兼容地基（已完成 ✅ 2026-08-22）

- [x] XSS 修复：合入上游 PR #29（@SivanCola）——`escapeHtml()` 全量转义 + `isSafeNavUrl()` 拦 `javascript:` 协议（修复上游 issue #36）
- [x] CSP 修复：内联 `onerror` 处理器全部替换为事件委托（修复上游 issue #31 报错根因）
- [x] 复扫残留注入点：`showToast` 走 `textContent`，安全
- [ ] Chrome 147+ 真机回归（issue #33 的报错需真机验证，见 Phase 1）

## Phase 1 — MVP（目标：2 周内，上架前完成）

- [x] **真机回归**：用户 2026-08-26 全量真机验证通过（Chrome 147 报错未复现，加载速度正常，快照/接管/主题/音频全部确认）
- [ ] **性能**：渲染防抖 + 首屏优化（参考 soarpenguin fork 的 refresh debounce 思路）
- [x] **favicon 本地化**（issue #4）：全部改用 `chrome://favicon2` 本地数据库，零外联、离线可用、内网有图标（2026-08-26）
- [x] **全局搜索**：`/` 聚焦（标题/URL 实时过滤、120ms 防抖）、Esc 清空、Enter 跳转首个结果；搜索时隐藏"Close all"防误关（2026-08-22）
- [x] **双入口-图标/快捷键**：图标点击 + Alt+T 唤起，聚焦已有仪表盘防重复（2026-08-22）
- [x] **双入口-接管开关**：设置弹层可关闭"接管新标签页"，极简页不抢焦点（2026-08-25，待真机回归）
- [x] **主题跟随系统**：无手动选择时跟随 prefers-color-scheme，实时响应（2026-08-25，待肉眼验收）
- [x] **音频定位与静音**：芯片扬声器标记（琥珀呼吸=播放中/灰划线=已静音）、点击静音、Mute N playing 一键全静音（2026-08-25）
- [ ] **会话自动快照**（issue #1）：事件驱动快照 + 滚动保留 + 挑选恢复；保真度要求：**pinned 状态、窗口归属、恢复后清理空组**（来自商店竞品评论的三条具体需求）

## Phase 1.5 — 证据驱动 Backlog（2026-08-25 调查）

全量扫描 485 个 fork（194 个有真实工作、约 1961 条提交）+ Reddit/HN/V2EX + 商店大竞品（Session Buddy/OneTab/Toby/Workona/TMP）评论交叉验证。功能按证据强度排序：

| 优先级 | 功能 | fork 数 | 社区/商店证据 | Issue |
|---|---|---|---|---|
| 1 | Tab Groups 原生支持 | 32 | Toby×2 + TMP×2 条评论请求；Super Tab Out 唯一好评即域名分组 | #5 |
| 2 | 芯片悬停预览 | 38 | — | #6 |
| 3 | 快捷方式/导航栏 | 15 | V2EX"起始页+导航+收藏一举三得" | #7 |
| 4 | 锁定标签防误关 | — | Reddit 两帖"wish to lock tabs"；chess99 受保护标签 | #8 |
| 5 | i18n 首发 zh-CN | 40 | 受众约半数中文用户 | #9 |

调查中的其他结论：**数据丢失是全品类第一痛点**（8 条评论横跨五个大竞品 + 43 个 fork 做会话恢复 + Reddit 三帖）→ 快照为锚；**37 个 fork 独立修复同一 XSS**（我们的地基选择正确）；"AI" 表面 68 fork 居首，但多数是提交署名 Co-Authored-By Claude/GPT 被关键词命中，真实 AI 功能实现约十几个，Phase 2 节奏不变；27 个 fork 做了品牌化（产品化是终局形态）；TMP 两年未更新被差评——维护即护城河。

## Phase 2 — AI 增值（MVP 上架后，第一个只做"AI 清扫建议"）

- [ ] **AI 清扫建议**（唯一首发功能）：分析标签的激活时间/停留时长/语义重复 → "这 N 个标签建议关闭" → 一键执行
  - L1：Chrome 内置 AI（Gemini Nano / Prompt API，Chrome 138+ stable），免费/本地/无 key —— 默认
  - L2：BYO key（OpenAI 兼容端点），用户自愿开启，调用前明示
  - 原则继承自上游：默认静态视图，AI 只按需触发；AI 是按钮不是界面
- [ ] 验证后再排：语义分组、语义搜索、稍后阅读摘要、会话自动命名、每日注意力一行报

## Phase 3 — 上架准备

- [x] 产品命名 + 三处查重（Chrome 商店 / GitHub / Firefox AMO）—— 定名 **Molt**（2026-08-26）
- [ ] 品牌替换：manifest name、图标、README 中英双语
- [ ] 商店素材：5 张截图（1280×800）、描述首行写"100% 本地，无账号，无追踪"
- [ ] 隐私表单：勾选"不收集任何数据"（属实）
- [ ] 注册 CWS 开发者账号（$5 一次性），提交审核（预期 3 天–3 周）
- [ ] 合规：保留上游 MIT 版权声明；README 标注 fork 来源

## Phase 4 — 冷启动（上架当天）

- [ ] 上游 issue #9 / #2 回复商店链接（存量精准需求池）
- [ ] V2EX / r/chrome_extensions / 即刻 分享
- [ ] （AI 功能成型后）投稿 Chrome Built-in AI Challenge / 官方案例

## 维护节奏（长期）

- Chrome stable 每次大版本：真机过一遍核心流程（上游 #33 断供的教训）
- 每月扫一次上游 issue 区（免费需求工单）
- 商业化：见对话结论——AI 免费获客，同步/自动化规则进 Pro（12 个月后再议），永不碰广告/数据/砍功能

## 上游资产索引（可直接参考的未合并 PR）

| PR | 内容 |
|----|------|
| #54 | 搜索 + 深色 + 设置系统（IterateLife） |
| #58 | 原生 Chrome Tab Groups（flyawayfarfar） |
| #59 | 收藏书签栏（pkumza） |
| #43 | Firefox 支持（caezium） |
| #61 | 书签侧栏 + CSP 清理（Niansi） |
| #48 | Tab Groups + 拖拽（vivekjain17） |
| #51 | 独立标签页模式（xionglinlin） |
| #29 | ✅ 已合入（安全修复 + 主题） |
