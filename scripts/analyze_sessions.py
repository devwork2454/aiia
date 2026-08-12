import os
import json
import glob
from collections import Counter

def process_pi_sessions(base_dir):
    user_intents = []
    errors = []
    
    session_files = glob.glob(os.path.join(base_dir, '**', '*.jsonl'), recursive=True)
    for fpath in session_files:
        try:
            with open(fpath, 'r', encoding='utf-8') as f:
                for line in f:
                    if not line.strip(): continue
                    data = json.loads(line)
                    # Pi format extraction
                    if data.get('type') == 'message' and isinstance(data.get('message'), dict):
                        msg = data['message']
                        if msg.get('role') == 'user':
                            content = msg.get('content', [])
                            if isinstance(content, list) and len(content) > 0 and isinstance(content[0], dict):
                                text = content[0].get('text', '')
                                if text: user_intents.append(text[:200].replace('\n', ' '))
                    elif data.get('type') == 'USER_INPUT':
                        user_intents.append(str(data.get('content', ''))[:200].replace('\n', ' '))
                    
                    if 'error' in data or ('result' in data and 'error' in str(data['result']).lower()):
                        errors.append(str(data)[:200])
        except Exception:
            pass
    return user_intents, errors

def process_agy_sessions(base_dir):
    user_intents = []
    errors = []
    
    session_files = glob.glob(os.path.join(base_dir, '**', 'transcript.jsonl'), recursive=True)
    for fpath in session_files:
        try:
            with open(fpath, 'r', encoding='utf-8') as f:
                for line in f:
                    if not line.strip(): continue
                    data = json.loads(line)
                    # Agy format
                    if data.get('type') == 'USER_INPUT':
                        user_intents.append(str(data.get('content', ''))[:200].replace('\n', ' '))
                    elif data.get('status') == 'ERROR':
                        errors.append(str(data.get('content', ''))[:200])
        except Exception:
            pass
    return user_intents, errors

def main():
    home = os.path.expanduser('~')
    pi_dir = os.path.join(home, '.pi', 'agent', 'sessions')
    agy_dir = os.path.join(home, '.gemini', 'antigravity-cli', 'brain')
    
    pi_intents, pi_errors = process_pi_sessions(pi_dir)
    agy_intents, agy_errors = process_agy_sessions(agy_dir)
    
    all_intents = pi_intents + agy_intents
    all_errors = pi_errors + agy_errors
    
    # Simple cleaning / dedup
    all_intents = [i for i in all_intents if i.strip()]
    all_errors = [e for e in all_errors if e.strip()]
    
    report = [
        "# 多 Agent 历史会话分析与 aiia 改进建议书\n",
        "## 1. 数据采集概况",
        f"- **Pi 会话数**：抽取到 {len(pi_intents)} 条有效交互指令",
        f"- **Agy (Antigravity) 会话数**：抽取到 {len(agy_intents)} 条有效交互指令",
        f"- **共计发现报错/异常节点**：{len(all_errors)} 次\n",
        "## 2. 高频用户意图（Top Intents）",
        "*(展示部分最常见意图，可用于强化 aiia 的内置 Skill)*"
    ]
    
    for intent, count in Counter(all_intents).most_common(10):
        if len(intent) > 5:
            report.append(f"- [{count}次] {intent}")
            
    report.extend([
        "\n## 3. 高频错误与拦截场景",
        "*(典型报错截取，用于优化 aiia 沙箱或异常自愈逻辑)*"
    ])
    
    for err, count in Counter(all_errors).most_common(5):
        if len(err) > 5:
            report.append(f"- [{count}次] {err}")
            
    report.extend([
        "\n## 4. 对 aiia 项目的优化建议 (Action Items)",
        "1. **丰富高频场景 Skill**：结合上述意图，将用户最常手动要求的长指令固化为 aiia 的 `/slash` 命令或内置 Skill。",
        "2. **增强特定工具的容错自愈**：针对出现过报错的工具调用（如沙箱拦截、依赖缺失等），在 aiia 的 Quality Gate 中加入专项 Check，避免阻断任务。",
        "3. **会话上下文瘦身优化**：分析历史积攒的无效冗长日志，为 aiia 的 Context Compaction 提供裁剪策略。"
    ])
    
    out_path = os.path.join(os.getcwd(), 'artifacts', 'aiia_optimization_report.md')
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(report))
        
    print(f"Report generated successfully at: {out_path}")

if __name__ == '__main__':
    main()
