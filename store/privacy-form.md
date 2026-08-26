# 隐私表单答案（Chrome Web Store 提交流程逐项）

> 2023 年起 CWS 要求所有新 item 完成数据使用披露。Molt 的答案全部如实：零收集。

## 1. Single purpose（一句话用途声明）

```
Molt replaces the browser's new tab page with a local dashboard of the
user's open tabs, letting them view, search, mute, close, and restore
tabs. All data stays on the device.
```

## 2. 权限用途说明（Permission justification，逐条）

**tabs**
```
Reads the titles, URLs, and state (audible/pinned/window) of open tabs to
build the dashboard: domain grouping, duplicate detection, audio badges,
and local session snapshots. Tab data is displayed on the user's own new
tab page and never transmitted anywhere.
```

**activeTab**
```
Allows the dashboard to act on the currently active tab when the user
invokes Molt from the toolbar icon (open/focus the dashboard).
```

**storage**
```
Stores the user's theme choice, saved-for-later list, settings, and
session snapshots in chrome.storage.local — entirely on the device.
```

## 3. 数据使用披露（Data usage）

界面是复选框语义：**勾选 = 声明收集，留空 = 声明不收集**。
九项（PII / Health / Financial / Authentication / Personal communications /
Location / Web history / User activity / Website content）**全部保持不勾**。
下方三条 "I certify" 认证**全部勾选**（必须全勾才能提交，对我们均为事实）。
判断标准：数据是否离开用户设备——Molt 零上传，故全空。

## 4. 远程代码声明

**不使用远程代码。** 无 CDN 脚本、无 eval、无远程配置。字体经 Google Fonts CSS 引用属于
静态资源——注意：上架审核对远程字体通常放行，但为绝对稳妥，可在提交前将
index.html 的 Google Fonts `<link>` 移除（系统字体栈兜底）。**建议提交时移除**，
见 shot-list 附注。

## 5. 隐私政策（Privacy policy URL）

表单在零收集时非必填，但建议填写，填仓库里的：
```
https://github.com/ai-daming/molt/blob/main/PRIVACY.md
```

## 6. 分发设置

- 可见性：Public
- 地区：所有地区
- 付费：免费（且永久免费——定位红线）
- 类目：Productivity
