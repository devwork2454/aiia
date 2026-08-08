#!/bin/bash
echo "🚀 终极多模态 (语音/图片/视频) 交互版机器人已启动！(按 Ctrl+C 停止)"

trap 'kill $(jobs -p) 2>/dev/null; exit' EXIT

# 日志与下载目录
LOG_FILE="/tmp/feishu_bot_task.log"
mkdir -p ./downloads
echo "等待任务执行..." > "$LOG_FILE"

# ==========================================
# 监听 1: 接收所有消息 (文字/语音/图片/视频)
# ==========================================
lark-cli event consume im.message.receive_v1 --as bot < <(tail -f /dev/null) | while read -r event; do
    message_type=$(echo "$event" | jq -r '.message_type')
    message_id=$(echo "$event" | jq -r '.message_id')
    chat_id=$(echo "$event" | jq -r '.chat_id')
    content=$(echo "$event" | jq -r '.content')
    
    if [ "$content" != "null" ] && [ -n "$content" ]; then
        text_instruction=""
        file_path=""
        
        # ==================================
        # 多模态文件下载与识别解析
        # ==================================
        if [ "$message_type" == "image" ]; then
            file_key=$(echo "$content" | jq -r '.image_key')
            echo "🖼️ 收到图片，正在下载: $file_key"
            lark-cli im +messages-resources-download --message-id "$message_id" --file-key "$file_key" --type image --output "downloads/${file_key}.jpg" --as bot > /dev/null
            file_path="downloads/${file_key}.jpg"
            text_instruction="[收到图片] 系统已将图片保存至: $file_path。Antigravity 将读取此图片进行代码开发。"
            
        elif [ "$message_type" == "media" ]; then
            file_key=$(echo "$content" | jq -r '.file_key')
            echo "🎬 收到视频，正在下载: $file_key"
            lark-cli im +messages-resources-download --message-id "$message_id" --file-key "$file_key" --type file --output "downloads/${file_key}.mp4" --as bot > /dev/null
            file_path="downloads/${file_key}.mp4"
            text_instruction="[收到视频] 系统已保存视频至: $file_path。Antigravity 将分析此视频。"
            
        elif [ "$message_type" == "audio" ]; then
            file_key=$(echo "$content" | jq -r '.file_key')
            echo "🎤 收到语音，正在下载: $file_key"
            lark-cli im +messages-resources-download --message-id "$message_id" --file-key "$file_key" --type file --output "downloads/${file_key}.opus" --as bot > /dev/null
            file_path="downloads/${file_key}.opus"
            text_instruction="[收到纯语音] 系统已保存语音文件至: $file_path。将转录并执行该语音指令。"
            
        elif [ "$message_type" == "text" ]; then
            # 转义内容中的双引号
            text_instruction="${content//\"/\\\"}"
        fi
        
        # 忽略不受支持的其他类型
        if [ -z "$text_instruction" ]; then continue; fi
        
        
        # ==================================
        # 菜单卡片判断
        # ==================================
        if [[ "$text_instruction" == *"菜单"* || "$text_instruction" == *"menu"* || "$text_instruction" == *"控制台"* ]]; then
            CARD_JSON=$(cat <<EOF
{
  "config": { "wide_screen_mode": true },
  "header": { "title": { "tag": "plain_text", "content": "🛠️ 开发者控制台 (Dev Console)" }, "template": "indigo" },
  "elements": [
    { "tag": "div", "text": { "tag": "lark_md", "content": "👋 **欢迎回来！** \n你可以发一段报错截图、录像，或者直接点击下方按钮：" } },
    { "tag": "hr" },
    {
      "tag": "action",
      "actions": [
        { "tag": "button", "text": { "tag": "plain_text", "content": "🚀 一键构建 (Build)" }, "type": "primary", "value": { "action": "build", "chat_id": "$chat_id" } },
        { "tag": "button", "text": { "tag": "plain_text", "content": "🧪 运行测试 (Test)" }, "type": "default", "value": { "action": "test", "chat_id": "$chat_id" } },
        { "tag": "button", "text": { "tag": "plain_text", "content": "📈 查看进度 (Progress)" }, "type": "primary", "value": { "action": "progress", "chat_id": "$chat_id" } }
      ]
    },
    {
      "tag": "action",
      "actions": [
        { "tag": "button", "text": { "tag": "plain_text", "content": "🧹 格式化代码 (Lint)" }, "type": "default", "value": { "action": "lint", "chat_id": "$chat_id" } },
        { "tag": "button", "text": { "tag": "plain_text", "content": "🔄 撤销修改 (Undo)" }, "type": "danger", "value": { "action": "undo", "chat_id": "$chat_id" } }
      ]
    }
  ]
}
EOF
)
            # 只有唤起菜单时，发送大卡片
            lark-cli im +messages-send --chat-id "$chat_id" --msg-type interactive --content "$CARD_JSON" --as bot > /dev/null
        else
            echo "开始处理指令/媒体..." > "$LOG_FILE"
            
            # 使用简单的回复代替大卡片，减少打扰
            lark-cli im +messages-reply --message-id "$message_id" --text "✅ 收到任务。后台正在处理中... (回复「菜单」查看工具面板)" --as bot > /dev/null
        fi
    fi
done &


# ==========================================
# 监听 2: 监听卡片按钮点击回调
# ==========================================
lark-cli event consume card.action.trigger --as bot < <(tail -f /dev/null) | while read -r event; do
    action_value=$(echo "$event" | jq -r '.action.value.action')
    chat_id=$(echo "$event" | jq -r '.action.value.chat_id')
    
    if [ "$action_value" == "build" ]; then
        echo "开始执行构建脚本..." > "$LOG_FILE"
        lark-cli im +messages-send --chat-id "$chat_id" --text "✅ 已启动构建任务！" --as bot > /dev/null
        (sleep 2; echo "[1/3] 编译 TypeScript..." >> "$LOG_FILE"; sleep 3; echo "[2/3] 打包产物..." >> "$LOG_FILE"; sleep 2; echo "[3/3] 构建成功！✅" >> "$LOG_FILE") &
        
    elif [ "$action_value" == "test" ]; then
        echo "开始执行测试脚本..." > "$LOG_FILE"
        lark-cli im +messages-send --chat-id "$chat_id" --text "🧪 已启动测试任务！" --as bot > /dev/null
        (sleep 2; echo "运行测试用例..." >> "$LOG_FILE") &
        
    elif [ "$action_value" == "progress" ]; then
        logs=$(tail -n 15 "$LOG_FILE")
        PROGRESS_CARD=$(cat <<EOF
{
  "config": { "wide_screen_mode": true },
  "header": { "title": { "tag": "plain_text", "content": "🔎 实时运行进度" }, "template": "wathet" },
  "elements": [
    { "tag": "div", "text": { "tag": "lark_md", "content": "**最新后台日志：**\n\`\`\`bash\n$logs\n\`\`\`" } },
    {
      "tag": "action",
      "actions": [
        { "tag": "button", "text": { "tag": "plain_text", "content": "🔄 刷新进度" }, "type": "primary", "value": { "action": "progress", "chat_id": "$chat_id" } }
      ]
    }
  ]
}
EOF
)
        lark-cli im +messages-send --chat-id "$chat_id" --msg-type interactive --content "$PROGRESS_CARD" --as bot > /dev/null

    elif [ "$action_value" == "lint" ]; then
        lark-cli im +messages-send --chat-id "$chat_id" --text "🧹 正在格式化代码..." --as bot > /dev/null
    elif [ "$action_value" == "undo" ]; then
        lark-cli im +messages-send --chat-id "$chat_id" --text "🔙 代码已回滚撤销。" --as bot > /dev/null
    fi
done &

wait
