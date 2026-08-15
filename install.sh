#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# AIIA 新设备一键安装脚本
# 用法: curl -fsSL https://raw.githubusercontent.com/你的账号/aiia/main/install.sh | bash
# 或:   bash install.sh
# 自动识别网络环境:国内优先 Gitee 镜像,海外用 GitHub;可用 AIIA_MIRROR=gitee|github 强制指定
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ─── 颜色 ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${BLUE}ℹ️  $*${RESET}"; }
success() { echo -e "${GREEN}✅ $*${RESET}"; }
warn()    { echo -e "${YELLOW}⚠️  $*${RESET}"; }
error()   { echo -e "${RED}❌ $*${RESET}"; exit 1; }
step()    { echo -e "\n${BOLD}${CYAN}── $* ${RESET}"; }

# ─── 网络环境自动识别 ─────────────────────────────────────────────────────────
# 未显式指定 AIIA_MIRROR 时,探测 gitee / github 连接延迟,自动选快的。
# 国内网络 Gitee 通常显著更快;海外 GitHub 更快;离线时兜底 GitHub。
detect_mirror() {
  if [ -n "${AIIA_MIRROR:-}" ]; then return 0; fi
  info "检测网络环境(gitee vs github)…"
  local gitee_ms github_ms
  gitee_ms=$(curl -o /dev/null -s -m 5 -I -w '%{time_connect}' https://gitee.com 2>/dev/null || true)
  github_ms=$(curl -o /dev/null -s -m 5 -I -w '%{time_connect}' https://github.com 2>/dev/null || true)
  case "$gitee_ms" in ''|*[!0-9.]*) gitee_ms=999;; esac
  case "$github_ms" in ''|*[!0-9.]*) github_ms=999;; esac
  if awk -v g="$gitee_ms" -v h="$github_ms" 'BEGIN{exit !(g<h)}' 2>/dev/null; then
    AIIA_MIRROR=gitee
    info "→ 检测到 Gitee 更快(gitee ${gitee_ms}s / github ${github_ms}s),启用 Gitee 镜像"
  else
    AIIA_MIRROR=github
    info "→ 使用 GitHub 源(gitee ${gitee_ms}s / github ${github_ms}s)"
  fi
}

# ─── 环境检测 ─────────────────────────────────────────────────────────────────
AIIA_DIR="${AIIA_DIR:-$HOME/project/aiia}"
AIIA_REPO="${AIIA_REPO:-devwork2454/aiia}"         # GitHub owner/repo
AIIA_GITEE_OWNER="${AIIA_GITEE_OWNER:-wbff}"       # Gitee 镜像 owner(可与 GitHub 不同)
AIIA_GITEE_REPO="${AIIA_GITEE_REPO:-${AIIA_REPO##*/}}" # Gitee repo 名,默认取 AIIA_REPO 的 repo 段


echo -e "${BOLD}"
echo "  ╔══════════════════════════════════════╗"
echo "  ║     AIIA 新设备一键安装程序           ║"
echo "  ║     个人 AI Agent 增强系统            ║"
echo "  ╚══════════════════════════════════════╝"
echo -e "${RESET}"

# ─── Step 1: 检查 Node.js ────────────────────────────────────────────────────
step "Step 1/9  检查 Node.js 环境"

# pi 依赖的 undici(≥8) 在加载时调用 node:worker_threads 的 markAsUncloneable，
# 该 API 仅 Node ≥ 22.10 提供(Node 20 与 22.0-22.9 都缺，加载即崩)。
# 用语义探测而非硬编码版本号：未来 undici 要求再变化时无需改门限。
node_has_mark_uncloneable() {
  node -e 'process.exitCode = typeof require("node:worker_threads").markAsUncloneable === "function" ? 0 : 1' 2>/dev/null
}

if command -v node &>/dev/null; then
  NODE_VER=$(node --version)
  if node_has_mark_uncloneable; then
    success "Node.js $NODE_VER ✓"
    install_node=false
  else
    warn "当前 Node.js $NODE_VER 过旧：pi 依赖的 undici 需要 Node ≥ 22.10（缺 markAsUncloneable）"
    info "正在升级到 Node.js 22..."
    install_node=true
  fi
else
  warn "未检测到 Node.js"
  install_node=true
fi

if [ "$install_node" = true ]; then
  # 优先使用 nvm
  if command -v nvm &>/dev/null || [ -f "$HOME/.nvm/nvm.sh" ]; then
    source "$HOME/.nvm/nvm.sh" 2>/dev/null || true
    nvm install 22 && nvm use 22 && nvm alias default 22
    success "Node.js 22 安装完成 (nvm)"
  elif command -v apt-get &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
    success "Node.js 22 安装完成 (apt)"
  elif command -v brew &>/dev/null; then
    brew install node@22
    success "Node.js 22 安装完成 (brew)"
  else
    error "无法自动安装 Node.js，请手动安装 Node.js ≥ 22.10 后重试\n       推荐: https://nodejs.org 或使用 nvm"
  fi
fi

# ─── Step 2: 安装 pi CLI ──────────────────────────────────────────────────────
step "Step 2/9  安装 Pi CLI"

detect_mirror
if [ "$AIIA_MIRROR" = "gitee" ]; then
  info "启用 Gitee 镜像模式，设置 NPM 淘宝源加速..."
  npm config set registry https://registry.npmmirror.com
fi

if command -v pi &>/dev/null; then
  PI_VER=$(pi --version 2>/dev/null || echo "未知")
  success "Pi CLI 已安装 ($PI_VER)"
else
  info "正在全局安装 @earendil-works/pi-coding-agent..."
  npm install -g @earendil-works/pi-coding-agent
  success "Pi CLI 安装完成"
fi

# ─── Step 3: 获取 AIIA 项目 ──────────────────────────────────────────────────
step "Step 3/9  获取 AIIA 项目"

if [ -d "$AIIA_DIR/pi-agent" ]; then
  success "AIIA 项目已存在于 $AIIA_DIR"
  if [ -n "$AIIA_REPO" ]; then
    info "正在拉取最新代码..."
    if git -C "$AIIA_DIR" pull --ff-only; then
      success "代码更新成功，当前版本信息："
      echo -e "${CYAN}"
      git -C "$AIIA_DIR" log -3 --oneline --color=always | sed 's/^/  /'
      echo -e "${RESET}"
    else
      warn "git pull 失败，使用本地版本"
    fi
  fi
else
  if [ -n "$AIIA_REPO" ]; then
    info "正在从 ${AIIA_MIRROR} 源克隆..."
    mkdir -p "$(dirname "$AIIA_DIR")"
    if [ "$AIIA_MIRROR" = "gitee" ]; then
      GITEE_URL="https://gitee.com/$AIIA_GITEE_OWNER/$AIIA_GITEE_REPO.git"
      info "Gitee 源: $GITEE_URL"
      git clone "$GITEE_URL" "$AIIA_DIR"
    else
      if command -v gh &>/dev/null && gh auth status &>/dev/null; then
        gh repo clone "$AIIA_REPO" "$AIIA_DIR" || git clone "https://github.com/$AIIA_REPO.git" "$AIIA_DIR"
      else
        git clone "https://github.com/$AIIA_REPO.git" "$AIIA_DIR" || git clone "$AIIA_REPO" "$AIIA_DIR"
      fi
    fi
    success "项目克隆完成，当前版本信息："
    echo -e "${CYAN}"
    git -C "$AIIA_DIR" log -3 --oneline --color=always | sed 's/^/  /'
    echo -e "${RESET}"
  else
    # 没有 git 仓库时，从当前脚本所在目录使用
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [ -d "$SCRIPT_DIR/pi-agent" ]; then
      AIIA_DIR="$SCRIPT_DIR"
      success "使用当前目录: $AIIA_DIR"
    else
      error "未找到 AIIA 项目！\n       请设置 AIIA_REPO=<你的git仓库地址> 后重试\n       或在 AIIA 项目根目录下执行此脚本"
    fi
  fi
fi

# ─── Step 4: 安装 Pi-agent 依赖 ───────────────────────────────────────────────
step "Step 4/9  安装 AIIA 依赖"

cd "$AIIA_DIR/pi-agent"
info "正在安装 npm 依赖..."
npm install --prefer-offline 2>/dev/null || npm install
success "依赖安装完成"

# ─── Step 5: 注册为 Pi Package ───────────────────────────────────────────────
step "Step 5/9  注册 AIIA 为 Pi 全局插件"

# 检查是否已注册
if pi list 2>/dev/null | grep -q "aiia"; then
  success "AIIA 已注册为 Pi 插件"
else
  info "正在注册..."
  pi install "$AIIA_DIR/pi-agent"
  success "AIIA 注册完成"
fi

# 项目根 .pi/extensions → pi-agent/extensions 的半截软链会导致 jiti 按
# <repo>/.pi/src 解析相对 import 而失败（真源在 pi-agent/src）。扩展应由
# `pi install pi-agent` 加载，不要在仓库根再挂一层 extensions-only 软链。
if [[ -L "$AIIA_DIR/.pi/extensions" ]]; then
  warn "检测到损坏布局 $AIIA_DIR/.pi/extensions（软链）；正在移除以免 Pi 启动失败"
  rm -f "$AIIA_DIR/.pi/extensions"
  rmdir "$AIIA_DIR/.pi" 2>/dev/null || true
fi
# ~/.pi/agent/extensions/<file> -> pi-agent/extensions 的半截软链同样会炸：
# jiti 把 ../src 解析成 ~/.pi/agent/src（不存在）。
if [[ -f "$AIIA_DIR/scripts/clean-stray-pi-extensions.sh" ]]; then
  AIIA_DIR="$AIIA_DIR" bash "$AIIA_DIR/scripts/clean-stray-pi-extensions.sh" || true
fi

# ─── Step 6: 链接默认 Pi Skills（新机即用）───────────────────────────────────
step "Step 6/9  链接默认 Pi Skills（auto-harness、goal、imp 等）"

if [[ ! -f "$AIIA_DIR/scripts/link-pi-skills.sh" ]]; then
  error "缺少 $AIIA_DIR/scripts/link-pi-skills.sh（新机无法默认启用 auto-harness/goal）"
fi
info "正在将仓库 skills 链接到 ~/.pi/agent/skills ..."
AIIA_DIR="$AIIA_DIR" bash "$AIIA_DIR/scripts/link-pi-skills.sh" \
  || error "Pi skills 链接失败；请检查 $AIIA_DIR/.agents/skills/{auto-harness,goal,imp}"
success "Pi 默认 skills 已链接（含 auto-harness、goal、imp；支持 /goal /imp）"


# 推荐关闭 skill slash 补全（skill 仍可被 agent 发现）
SETTINGS_JSON="$HOME/.pi/agent/settings.json"
REC="$AIIA_DIR/docs/pi-settings-recommended.json"
if [[ -f "$REC" ]]; then
  mkdir -p "$(dirname "$SETTINGS_JSON")"
  if [[ ! -f "$SETTINGS_JSON" ]]; then
    echo '{}' > "$SETTINGS_JSON"
  fi
  if command -v node >/dev/null 2>&1; then
    node -e '
const fs=require("fs");
const settingsPath=process.argv[1];
const recPath=process.argv[2];
const s=JSON.parse(fs.readFileSync(settingsPath,"utf8")||"{}");
const r=JSON.parse(fs.readFileSync(recPath,"utf8"));
for (const k of Object.keys(r)) {
  if (k.startsWith("_")) continue;
  if (s[k] === undefined) s[k] = r[k];
}
fs.writeFileSync(settingsPath, JSON.stringify(s,null,2)+"\n");
' "$SETTINGS_JSON" "$REC" && success "已写入推荐 Pi settings（仅补缺 missing keys）" \
      || info "跳过 settings 合并（可手动参考 docs/pi-settings-recommended.json）"
  fi
fi

# ─── Step 7: 配置环境变量 ─────────────────────────────────────────────────────
step "Step 7/9  配置环境变量"

SHELL_RC=""
if [ -f "$HOME/.zshrc" ]; then
  SHELL_RC="$HOME/.zshrc"
elif [ -f "$HOME/.bashrc" ]; then
  SHELL_RC="$HOME/.bashrc"
elif [ -f "$HOME/.bash_profile" ]; then
  SHELL_RC="$HOME/.bash_profile"
fi

# 检查是否已配置 AIIA_GITHUB_CLIENT_ID
if [ -n "$SHELL_RC" ] && ! grep -q "AIIA_GITHUB_CLIENT_ID" "$SHELL_RC"; then
  cat >> "$SHELL_RC" << 'ENVEOF'

# ─── AIIA 配置 ────────────────────────────────────────────────────────────────
export PATH="$HOME/.local/bin:$PATH"                # 确保全局包装器路径优先
export AIIA_GITHUB_CLIENT_ID=Ov23lifLgXiZSFLXmvww   # AIIA Sync OAuth App

# 加载机密环境变量（如果存在）
[ -f "$HOME/.secrets/env" ] && set -a && . "$HOME/.secrets/env" && set +a
ENVEOF
  success "环境变量已写入 $SHELL_RC"
else
  success "环境变量已配置（跳过）"
fi

# ─── Step 8: 注入全局命令包装器 ───────────────────────────────────────────────
step "Step 8/9  注入 Pi 全局防崩包装器"

# 创建 ~/.local/bin 包装器，替代脆弱的 shell function
mkdir -p "$HOME/.local/bin"
PI_WRAPPER="$HOME/.local/bin/pi"

cat > "$PI_WRAPPER" << 'EOF'
#!/usr/bin/env bash

# 拦截 pi aiia 指令
if [[ "$1" == "aiia" ]]; then
  if [[ "$2" == "update" ]]; then
    exec bash "$HOME/project/aiia/install.sh"
  else
    exec node "$HOME/project/aiia/pi-agent/src/cli.js" "$2"
  fi
fi

# 寻找真实的 pi 可执行文件，跳过本脚本
REAL_PI=$(which -a pi | grep -v "$HOME/.local/bin/pi" | head -n 1)

if [[ -z "$REAL_PI" ]]; then
  echo "Error: Cannot find original 'pi' executable." >&2
  exit 1
fi

exec "$REAL_PI" "$@"
EOF
chmod +x "$PI_WRAPPER"
success "全局包装器已安装至 $PI_WRAPPER"

# ─── Step 8: Tmux AI 助手配置 ─────────────────────────────────────────────────
step "Step 8/9  Tmux AI 助手配置 (可选)"

if command -v tmux &>/dev/null; then
  echo -e "${YELLOW}检测到系统已安装 Tmux。是否为您配置 AIIA 的 Tmux 屏幕抓取助手？${RESET}"
  echo -e "配置后，在 Tmux 内按 Prefix + q 即可弹窗抓取屏幕报错并呼叫 Pi。"
  
  if [ -t 0 ] || [ -c /dev/tty ]; then
    read -p "是否安装配置？(y/N): " -n 1 -r < /dev/tty || true
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      if [ -f "$AIIA_DIR/scripts/setup-tmux-ai.sh" ]; then
        bash "$AIIA_DIR/scripts/setup-tmux-ai.sh"
      else
        warn "未找到 $AIIA_DIR/scripts/setup-tmux-ai.sh，跳过配置。"
      fi
    else
      info "跳过 Tmux 配置。"
    fi
  else
    info "非交互式环境，跳过 Tmux 配置。"
  fi
else
  info "未检测到 Tmux，跳过该步。"
fi

# ─── Step 9: pi 启动冒烟检查 ────────────────────────────────────────────────
# 段错误(SIGSEGV)多由 Node 版本与系统 glibc 兼容问题引起(如 Node 20.20.x);
# undici 报 markAsUncloneable 则是 Node < 22.10 缺少 worker_threads API。
# 检测到即自动切 Node 22 重装 pi;进程无致命错误则安装成功,不因缺模型配置阻断。
step "Step 9/9  pi 启动冒烟检查"

if command -v pi &>/dev/null; then
  PI_SMOKE_LOG="${TMPDIR:-/tmp}/aiia-pi-smoke.log"

  run_pi_smoke() { timeout 30 pi -p "hello" >"$PI_SMOKE_LOG" 2>&1; }

  # 切 Node 22 并重装 pi 后重跑冒烟;通过(0/124)返回 0
  retry_pi_on_node22() {
    export NVM_DIR="$HOME/.nvm"
    if [ -s "$NVM_DIR/nvm.sh" ]; then
      . "$NVM_DIR/nvm.sh"
    else
      curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
      . "$NVM_DIR/nvm.sh" 2>/dev/null || true
    fi
    if [ "$AIIA_MIRROR" = "gitee" ]; then
      export NVM_NODEJS_ORG_MIRROR=https://npmmirror.com/mirrors/node
    fi
    nvm install 22 >/dev/null 2>&1 && nvm use 22 >/dev/null 2>&1 && nvm alias default 22 >/dev/null 2>&1
    npm install -g @earendil-works/pi-coding-agent >/dev/null 2>&1
    run_pi_smoke
  }

  info "运行 pi 冒烟测试(pi -p hello)…"
  run_pi_smoke
  SMOKE_CODE=$?

  # 需要自动切 Node 22 重试的原因;空串则无需重试
  SMOKE_RETRY=""
  if [ "$SMOKE_CODE" -eq 139 ]; then
    SMOKE_RETRY="段错误(SIGSEGV),疑似 Node 版本与 glibc 兼容问题"
  elif [ "$SMOKE_CODE" -ne 0 ] && [ "$SMOKE_CODE" -ne 124 ] \
       && grep -q "markAsUncloneable" "$PI_SMOKE_LOG" 2>/dev/null; then
    SMOKE_RETRY="undici/Node 版本不兼容(缺 markAsUncloneable,需 Node ≥ 22.10)"
  fi

  if [ -n "$SMOKE_RETRY" ]; then
    warn "⚠️  pi 启动异常:$SMOKE_RETRY。自动切换 Node 22 并重装 pi…"
    if retry_pi_on_node22; then
      SMOKE_CODE=0
    else
      SMOKE_CODE=$?
    fi
    if [ "$SMOKE_CODE" -eq 139 ]; then
      error "pi 在 Node 22 下仍段错误。请反馈: $(uname -m) / $(ldd --version 2>/dev/null | head -1) / node $(node -v 2>/dev/null)"
    elif [ "$SMOKE_CODE" -ne 0 ] && [ "$SMOKE_CODE" -ne 124 ]; then
      warn "pi 在 Node 22 下仍退出码 $SMOKE_CODE(常为模型未配置)。详情: $PI_SMOKE_LOG"
      success "pi 在 Node 22 下启动正常(进程无致命错误,可继续安装)"
    else
      success "pi 在 Node 22 下启动正常 ✓"
    fi
  elif [ "$SMOKE_CODE" -ne 0 ] && [ "$SMOKE_CODE" -ne 124 ]; then
    warn "pi 冒烟退出码 $SMOKE_CODE(常为模型未配置)。详情: $PI_SMOKE_LOG"
    success "pi 冒烟完成(进程无致命错误,可继续安装)"
  else
    success "pi 启动冒烟通过 ✓"
  fi
else
  warn "未找到 pi,跳过冒烟检查。"
fi

# ─── 完成 ─────────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}${GREEN}"
echo "  ╔══════════════════════════════════════════════════════════╗"
echo "  ║                  🎉 安装完成！                           ║"
echo "  ╚══════════════════════════════════════════════════════════╝"
echo -e "${RESET}"

echo -e "${BOLD}下一步操作：${RESET}"
echo ""

if [ -f "$HOME/.config/aiia/.credentials.json" ]; then
  # 已有凭据（旧设备迁移场景）
  echo -e "  1. 重启终端（让环境变量生效）"
  echo -e "     ${CYAN}source $SHELL_RC${RESET}"
  echo ""
  echo -e "  2. 启动 Pi 并从云端恢复所有配置："
  echo -e "     ${CYAN}pi${RESET}"
  echo -e "     ${CYAN}/sync pull${RESET}   ← 输入主密码，30秒恢复所有设置"
else
  # 全新设备场景
  echo -e "  1. 重启终端（让环境变量生效）"
  echo -e "     ${CYAN}source $SHELL_RC${RESET}"
  echo ""
  echo -e "  2. 启动 Pi："
  echo -e "     ${CYAN}pi${RESET}"
  echo ""
  echo -e "  3. 如果您在其他设备已经设置过云端同步："
  echo -e "     ${CYAN}/sync login${RESET}  ← 点链接授权 GitHub"
  echo -e "     ${CYAN}/sync pull${RESET}   ← 输入主密码，恢复所有配置"
  echo ""
  echo -e "  4. 全新开始（未使用过同步）："
  echo -e "     ${CYAN}/sync login${RESET}  ← 授权 + 设置主密码"
  echo -e "     ${CYAN}/vault add account 第一个账号${RESET}  ← 开始使用保险箱"
  echo -e "     ${CYAN}/sync push${RESET}   ← 上传配置到云端"
fi

echo ""
echo -e "  💡 随时输入 ${CYAN}/sync list${RESET} 查看所有同步资源状态"
echo -e "  💡 随时输入 ${CYAN}/vault${RESET}      查看保险箱命令帮助"
echo ""
echo -e "${YELLOW}  ⚠️  如果 pi 命令未找到，请执行: export PATH=\"\$PATH:\$(npm bin -g)\"${RESET}"
echo ""
