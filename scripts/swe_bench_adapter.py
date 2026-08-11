#!/usr/bin/env python3
"""
AIIA SWE-bench Adapter (Phase 1 Prototype)
桥接 SWE-bench 评测环境与 AIIA L6 调度层。
"""

import sys
import json
import subprocess
import os

# 模拟读取 SWE-bench Lite JSON 数据
def load_real_instance(instance_id):
    json_path = os.path.join(os.getcwd(), "artifacts", "swe_bench_lite_mini_10.json")
    try:
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            for inst in data:
                if inst["instance_id"] == instance_id:
                    return inst
    except Exception as e:
        print(f"[!] 读取 JSON 失败: {e}")
    return None

def trigger_aiia_agent(issue_text: str, repo_path: str):
    """
    启动 AIIA 引擎去解决给定的 Issue。
    这里使用 ARCHITECTURE.md 规划的 L2 后台 RPC 模式拉起 Pi 内核。
    """
    print(f"[*] Starting AIIA Agentic Loop for issue in {repo_path}...")
    
    # 构建拉起 Pi 的命令，利用 L6 编排能力
    cmd = [
        "pi", 
        "--mode", "rpc",
        "--task", f"SWE-bench 任务: {issue_text}\n请查阅当前仓库代码，使用 spawn_worktree_subagent 分支隔离修复此 Bug，并在完成后输出修复结果。"
    ]
    
    # Phase 1 暂且使用 dry-run 或 mock 的 subprocess 执行
    print(f"[*] Executing: {' '.join(cmd)}")
    
    # 真实场景中，这将是一个长达数十分钟的阻塞调用，并且会产生大量的标准输出
    # 此时仅演示 Mock 调用
    try:
        # Mock 延时模拟 agent 执行
        print("[*] (Mock) Agent is analyzing the codebase...")
        print("[*] (Mock) Agent spawned subagent for deep logic trace...")
        print("[*] (Mock) Subagent returned structured Diff payload via micro-context...")
        print("[*] (Mock) Main Agent merged worktree.")
        
        # 伪造一份生成的 patch
        patch_path = os.path.join(repo_path, "swe_bench_resolution.patch")
        with open(patch_path, "w", encoding="utf-8") as f:
            f.write("--- a/django/conf/global_settings.py\n+++ b/django/conf/global_settings.py\n@@ -304,2 +304,2 @@\n-FILE_UPLOAD_PERMISSIONS = None\n+FILE_UPLOAD_PERMISSIONS = 0o644\n")
            
        print(f"[*] AIIA successfully generated patch at: {patch_path}")
        return patch_path
    except Exception as e:
        print(f"[!] AIIA execution failed: {e}")
        return None

def main():
    print("=== AIIA SWE-bench Adapter (Prototype) ===")
    
    # 1. 解析/接收 SWE-bench 环境信息
    instance = load_real_instance("django__django-10914")
    if not instance:
        print("[-] 找不到指定的题目数据。")
        return
    print(f"[*] Received instance: {instance['instance_id']}")
    
    # 2. 划定代码沙箱工作区
    workspace_dir = os.path.join(os.getcwd(), "artifacts", "scratch", "swe_bench_mock_workspace")
    os.makedirs(workspace_dir, exist_ok=True)
    
    # 3. 注入任务给 AIIA
    patch_file = trigger_aiia_agent(instance["problem_statement"], workspace_dir)
    
    if patch_file:
        print(f"[+] 适配器已成功捕获 Agent 的 Diff 产物。SWE-bench 现可对 {patch_file} 执行验证。")
    else:
        print("[-] 适配器未能获得有效的补丁产物。")
        sys.exit(1)

if __name__ == "__main__":
    main()
