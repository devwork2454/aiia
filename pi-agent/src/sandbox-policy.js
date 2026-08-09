/**
 * AIIA MCP / Skill Security Sandbox Policy Engine (Phase 2 P7)
 * 为 MCP 工具、Skill 及宿主 Shell 执行提供细粒度权限控制与沙箱隔离。
 */

const HIGH_RISK_TOOLS = ['bash', 'execute_code', 'write_to_file'];
const DENIED_PATHS = ['/etc/passwd', '/etc/shadow', '/root/.ssh', '~/.ssh/id_rsa'];

export class SandboxPolicy {
  /**
   * @param {{ mode?: 'strict' | 'permissive' | 'sandbox', allowedTools?: string[], blockedPaths?: string[] }} opts
   */
  constructor({ mode = 'sandbox', allowedTools = [], blockedPaths = [] } = {}) {
    this.mode = mode;
    this.allowedTools = new Set(allowedTools);
    this.blockedPaths = [...DENIED_PATHS, ...blockedPaths];
  }

  /**
   * 评估工具调用的安全性
   * @param {string} toolName
   * @param {object} input
   * @returns {{ allowed: boolean, reason?: string }}
   */
  evaluate(toolName, input = {}) {
    if (this.mode === 'permissive') {
      return { allowed: true };
    }

    if (this.mode === 'strict' && this.allowedTools.size > 0) {
      if (!this.allowedTools.has(toolName)) {
        return { allowed: false, reason: `Tool '${toolName}' is not in strict whitelist.` };
      }
    }

    // 路径越权与高危敏感路径检测
    const inputStr = JSON.stringify(input);
    for (const p of this.blockedPaths) {
      if (inputStr.includes(p)) {
        return { allowed: false, reason: `Access to restricted path '${p}' blocked by Sandbox Policy.` };
      }
    }

    // 高危命令/可执行代码的二重语法过滤
    if (HIGH_RISK_TOOLS.includes(toolName)) {
      const command = input.command || input.CodeContent || input.code || '';
      if (typeof command === 'string') {
        if (/rm\s+-rf\s+(\/|~|\/\*)/i.test(command)) {
          return { allowed: false, reason: 'Destructive command rm -rf blocked by Sandbox.' };
        }
        if (/sudo\s+/i.test(command)) {
          return { allowed: false, reason: 'Privilege escalation sudo blocked by Sandbox.' };
        }
      }
    }

    return { allowed: true };
  }
}
