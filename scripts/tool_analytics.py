#!/usr/bin/env python3
"""
Agent Tool Analytics Probe
Analyzes system-generated transcript logs to compute adoption rate, error rate, 
and blocking rate of Agent tools, helping evaluate their ROI.
"""

import json
import glob
import os
from collections import defaultdict
import argparse

def analyze_logs(brain_dir, verbose=False):
    transcript_files = glob.glob(os.path.join(brain_dir, '*', '.system_generated', 'logs', 'transcript.jsonl'))
    
    tool_stats = defaultdict(lambda: {'count': 0, 'errors': 0})
    error_logs = defaultdict(list)
    total_tool_calls = 0

    for t_file in transcript_files:
        try:
            pending_tools = []
            with open(t_file, 'r', encoding='utf-8') as f:
                for line in f:
                    if not line.strip(): continue
                    try:
                        data = json.loads(line)
                    except:
                        continue
                    
                    dtype = data.get('type')
                    
                    if dtype == 'PLANNER_RESPONSE' and data.get('tool_calls'):
                        for tc in data['tool_calls']:
                            tool_name = None
                            if 'function' in tc and 'name' in tc['function']:
                                tool_name = tc['function']['name']
                            elif 'name' in tc:
                                tool_name = tc['name']
                            
                            if tool_name:
                                if tool_name.startswith('default_api:'):
                                    tool_name = tool_name.replace('default_api:', '')
                                pending_tools.append(tool_name)
                                tool_stats[tool_name]['count'] += 1
                                total_tool_calls += 1
                                
                    elif dtype in ('CODE_ACTION', 'RUN_COMMAND', 'TOOL_RESPONSE'):
                        content = data.get('content', '')
                        if not isinstance(content, str):
                            content = str(content)
                            
                        is_error = False
                        if 'exited with code ' in content:
                            if 'exited with code 0' not in content:
                                is_error = True
                        elif content.strip().startswith('Error:') or '\nError:' in content or 'error:' in content.lower():
                            is_error = True
                            
                        if pending_tools:
                            tname = pending_tools.pop(0)
                            if is_error:
                                tool_stats[tname]['errors'] += 1
                                snippet = content.strip()[:200].replace('\n', ' ')
                                error_logs[tname].append(snippet)
        except Exception as e:
            pass

    print('=' * 60)
    print('【 🤖 AIIA Agent 工具效能与阻断率探针 (Analytics Probe) 】')
    print('=' * 60)
    print(f'共扫描会话空间: {len(transcript_files)} 个')
    print(f'累计调度工具: {total_tool_calls} 次\n')
    
    print(f'| {"工具名称 (Tool Name)":<30} | {"调用总数":<8} | {"阻断数":<8} | {"成功率":<8} |')
    print(f'| {"-"*30} | {"-"*8} | {"-"*8} | {"-"*8} |')
    for tool, stats in sorted(tool_stats.items(), key=lambda x: x[1]['count'], reverse=True):
        if stats['count'] == 0: continue
        success_rate = ((stats['count'] - stats['errors']) / stats['count']) * 100
        print(f'| {tool:<30} | {stats["count"]:>8} | {stats["errors"]:>8} | {success_rate:>7.1f}% |')

    if verbose:
        print('\n' + '=' * 60)
        print('【 典型工具阻断错误采样 (Error Samples) 】')
        print('=' * 60)
        for tool in ['invoke_subagent', 'run_command', 'replace_file_content']:
            if tool in error_logs and error_logs[tool]:
                print(f'\n>> {tool} 报错采样:')
                for i, err in enumerate(error_logs[tool][:5], 1):
                    print(f"  {i}. {err}")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="AIIA Agent Tool Analytics Probe")
    parser.add_argument('--dir', type=str, default=os.path.expanduser('~/.gemini/antigravity-cli/brain'),
                        help='Path to the brain logs directory.')
    parser.add_argument('--verbose', '-v', action='store_true', help='Show detailed error logs.')
    args = parser.parse_args()
    
    analyze_logs(args.dir, args.verbose)
