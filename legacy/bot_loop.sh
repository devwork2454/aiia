#!/bin/bash
echo "🤖 飞书 x Antigravity 自动回复机器人已启动！(按 Ctrl+C 停止)"

# 实时监听接收到的消息
lark-cli event consume im.message.receive_v1 --as bot | while read -r event; do
    # 解析出消息内容和聊天窗口 ID
    content=$(echo "$event" | jq -r '.content')
    chat_id=$(echo "$event" | jq -r '.chat_id')
    
    if [ "$content" != "null" ] && [ -n "$content" ]; then
        echo "收到来自手机的指令: $content"
        
        # 1. 马上回复用户，表示已经收到指令
        lark-cli im +messages-send --chat-id "$chat_id" --text "✅ 收到指令：「$content」\n我正在执行中，请稍候..." --as bot > /dev/null
        
        # 2. 将内容直接传给 Antigravity (这里你可以替换成任意 agy 命令)
        # 注意: 实际运行需要你在系统中配好 agy 环境
        echo "正在执行 agy..."
        
        # 为了演示，我们把命令直接打印回去。如果想真的执行代码，可以去掉下面这行的注释:
        # result=$(agy --prompt "$content" --no-interactive)
        result="[模拟执行成功] 这是 Antigravity 后台返回的结果。如果要真实执行请在 bot_loop.sh 中解除注释。"
        
        # 3. 将结果发送回飞书手机端
        lark-cli im +messages-send --chat-id "$chat_id" --text "🎯 执行完毕！结果如下：\n$result" --as bot > /dev/null
    fi
done
