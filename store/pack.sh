#!/usr/bin/env bash
# pack.sh — build and verify the Chrome Web Store zip for Molt.
#
# Usage: ./store/pack.sh            # build dist/molt-<version>.zip from extension/
#        ./store/pack.sh --check    # verify the existing zip without rebuilding
#
# Guards against the class of mistake where a fix lands in git but the
# shipping zip stays stale: every property that once regressed gets an
# explicit assertion here (audio fields, bundled fonts, description limit,
# excluded private files). Exits non-zero on any failure.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT="$ROOT/extension"
DIST="$ROOT/dist"
MODE="${1:-build}"

VERSION=$(python3 -c "import json;print(json.load(open('$EXT/manifest.json'))['version'])")
ZIP="$DIST/molt-$VERSION.zip"

fail() { echo "✗ $*"; exit 1; }
pass() { echo "✓ $*"; }

if [ "$MODE" = "--check" ]; then
  [ -f "$ZIP" ] || fail "包不存在: $ZIP（先运行 ./store/pack.sh 构建）"
else
  mkdir -p "$DIST"
  rm -f "$ZIP"
  (cd "$EXT" && zip -r -q "$ZIP" . -x "*.DS_Store" "config.local.js") || fail "zip 打包失败"
fi

TMP=$(mktemp -d)
unzip -q "$ZIP" -d "$TMP"

# 1. git 同步检查：包内 app.js 必须与工作区完全一致（防止忘记重打包）
if ! diff -q "$EXT/app.js" "$TMP/app.js" > /dev/null; then
  fail "包内 app.js 与 extension/app.js 不一致——包是旧的，重新运行 ./store/pack.sh"
fi
pass "包内 app.js 与工作区一致"

# 2. 音频字段映射存在（fetchOpenTabs 曾剥离 audible/muted 导致标记永远不亮）
unzip -p "$ZIP" app.js 2>/dev/null | grep -q "audible:" || TMP_MISSING=1
grep -q "audible:" "$TMP/app.js" || fail "app.js 缺少 audible 字段映射（音频标记会失明）"
pass "音频字段映射在位"

# 3. 轮询兜底存在（部分 Chrome 版本 audible 不走 onUpdated）
grep -q "setInterval" "$TMP/app.js" || fail "缺少音频签名轮询兜底"
pass "音频轮询兜底在位"

# 4. 字体本地化：8 个 woff2 + fonts.css，且 index.html 无任何 googleapis 外链
WOFF=$(find "$TMP/fonts" -name "*.woff2" 2>/dev/null | wc -l | tr -d ' ')
[ "$WOFF" = "8" ] || fail "woff2 数量应为 8，实际 $WOFF"
grep -rql "googleapis\|gstatic\|preconnect" "$TMP"/*.html "$TMP"/*.css && fail "存在字体 CDN 外链残留"
pass "字体已本地化（8 woff2），零 CDN 外链"

# 5. favicon 零外联（曾依赖 google.com/s2/favicons）
grep -rq "s2/favicons" "$TMP" && fail "存在 s2/favicons 外联残留"
pass "favicon 零外联（chrome://favicon2）"

# 6. manifest：名称、版本、描述 ≤132、双入口要素
python3 - "$TMP/manifest.json" <<'EOF' || fail "manifest 校验未通过"
import json, sys
m = json.load(open(sys.argv[1]))
assert m['name'].startswith('Molt'), f"name={m['name']}"
assert len(m['description']) <= 132, f"description {len(m['description'])} > 132"
assert 'commands' in m and 'open-dashboard' in m['commands'], '缺少 Alt+T command'
assert m['permissions'] == ['tabs', 'activeTab', 'storage'], f"权限变了: {m['permissions']}"
EOF
pass "manifest：Molt / v$VERSION / 描述≤132 / Alt+T / 权限最小集"

# 7. 隐私排除项：私有配置与杂文件不得混入
[ ! -e "$TMP/config.local.js" ] || fail "config.local.js 混入了发布包！"
pass "config.local.js 未混入"

# 8. 快照与主题的存储键保持兼容（改名不得破坏用户数据）
grep -q "sessionSnapshots" "$TMP/app.js" || fail "存储键 sessionSnapshots 消失了"
pass "存储键兼容（sessionSnapshots / tab-out-theme）"

rm -rf "$TMP"
SIZE=$(du -h "$ZIP" | cut -f1)
echo ""
echo "✅ $ZIP ($SIZE) 校验全部通过 — 可上传 Chrome Web Store"
