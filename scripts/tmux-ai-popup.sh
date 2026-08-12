#!/bin/bash
set -euo pipefail

CTX_FILE="/tmp/tmux-ctx.txt"

if [ "${1:-}" = "--inner" ]; then
    echo -e "\033[1;34m=== AIIA Tmux 屏幕抓取助手 ===\033[0m"
    echo -e "\033[90m已成功抓取底层 Pane 的日志输出作为大模型上下文。\033[0m\n"
    
    read -r -p "请输入指令 (例如: '帮我解释这个报错' 或 '生成修复命令'): " p
    if [ -n "$p" ]; then
        echo -e "\n\033[33m[处理中] 正在呼叫 Pi 引擎...\033[0m\n"
        
        # 读取最后150行避免过度冗长，拼接给大模型
        CONTEXT=$(tail -n 150 "$CTX_FILE")
        
        # 调用 Pi
        pi "$p。
==============
以下为抓取的底层终端输出上下文：
$CONTEXT"
        
        echo ""
        read -r -p "按回车退出..."
    fi
    exit 0
fi

# --- 外部入口逻辑 ---
# 1. 抓取当前 active pane 的可见内容与回溯日志
tmux capture-pane -J -p -S -150 > "$CTX_FILE" 2>/dev/null || tmux capture-pane -J -p > "$CTX_FILE"

# 2. 弹窗并调用自身进入交互逻辑
tmux display-popup -w 85% -h 85% -E "bash '$0' --inner"
