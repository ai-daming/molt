# Roadmap

Active fork of [zarazhangrui/tab-out](https://github.com/zarazhangrui/tab-out) (MIT).
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

- [ ] **真机回归**：加载 unpacked 扩展，覆盖上游 issue #33（Chrome 147 报错）、#12（新标签页加载慢）两个场景，记录基线
- [ ] **性能**：渲染防抖 + 首屏优化（参考 soarpenguin fork 的 refresh debounce 思路）
- [ ] **暗色模式**：默认跟随系统，手动可切换（PR #29 已带来切换器，需打磨）
- [ ] **全局搜索**：`/` 或 Cmd+F 聚焦，按标题/URL 过滤（参考 PR #54）
- [ ] **双入口开关**：设置项可选"接管新标签页"或"点图标打开面板"（manifest 的 `chrome_url_overrides` 动态化，参考 PR #51 + birkdev 商店版）
- [ ] **会话自动快照**：`chrome.storage.local` 定期存打开标签列表，崩溃/断电可恢复（对齐 Session Buddy 口碑，品类第一痛点是数据丢失）

## Phase 2 — AI 增值（MVP 上架后，第一个只做"AI 清扫建议"）

- [ ] **AI 清扫建议**（唯一首发功能）：分析标签的激活时间/停留时长/语义重复 → "这 N 个标签建议关闭" → 一键执行
  - L1：Chrome 内置 AI（Gemini Nano / Prompt API，Chrome 138+ stable），免费/本地/无 key —— 默认
  - L2：BYO key（OpenAI 兼容端点），用户自愿开启，调用前明示
  - 原则继承自上游：默认静态视图，AI 只按需触发；AI 是按钮不是界面
- [ ] 验证后再排：语义分组、语义搜索、稍后阅读摘要、会话自动命名、每日注意力一行报

## Phase 3 — 上架准备

- [ ] 产品命名 + 三处查重（Chrome 商店 / GitHub / Firefox AMO）
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
