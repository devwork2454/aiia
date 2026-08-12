#!/bin/bash
set -euo pipefail

# 获取当前脚本所在目录的绝对路径，继而拿到项目根目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AIIA_DIR="$(dirname "$SCRIPT_DIR")"
POPUP_SCRIPT="$SCRIPT_DIR/tmux-ai-popup.sh"

TMUX_CONF="${HOME}/.tmux.conf"
MARKER="# --- AIIA Tmux AI Integration ---"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RESET='\033[0m'

echo -e "正在配置 AIIA Tmux AI 集成..."

# 确保 popup 脚本有执行权限
chmod +x "$POPUP_SCRIPT" 2>/dev/null || true

# 如果 ~/.tmux.conf 不存在，创建一个空的
if [ ! -f "$TMUX_CONF" ]; then
    touch "$TMUX_CONF"
fi

if grep -qF "$MARKER" "$TMUX_CONF"; then
    echo -e "${YELLOW}检测到 $TMUX_CONF 中已存在 AIIA Tmux 配置，跳过注入。${RESET}"
else
    echo -e "向 $TMUX_CONF 写入热键绑定 (Prefix + q)..."
    cat << EOF >> "$TMUX_CONF"

$MARKER
# 绑定 Prefix + q 呼出 Pi 屏幕抓取助手
bind-key q run-shell "bash '$POPUP_SCRIPT'"
# --------------------------------
EOF
    echo -e "${GREEN}注入成功！${RESET}"
fi

echo -e "\n${YELLOW}重要提示：${RESET}"
echo -e "如果你当前正在 Tmux 会话中，请执行以下命令使配置立即生效："
echo -e "  ${GREEN}tmux source-file ~/.tmux.conf${RESET}"
echo -e "随后可在任意窗格中按下 ${GREEN}Prefix (默认 Ctrl+B) 然后按 q${RESET} 进行体验。"
