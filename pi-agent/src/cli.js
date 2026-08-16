#!/usr/bin/env node
import {
  formatStatusReport,
  getRepoStatus,
  getSkillsState,
  resolveAiiDir,
  runAiiUpdate,
} from './manager.js';

const cmd = process.argv[2];
const aiiaDir = resolveAiiDir();

if (cmd === 'status') {
  const report = formatStatusReport(getRepoStatus(aiiaDir), getSkillsState(aiiaDir), aiiaDir);
  console.log(report);
} else if (cmd === 'update') {
  console.log('Updating AIIA…');
  const result = runAiiUpdate(aiiaDir);
  console.log(result.report);
} else if (cmd === 'remote') {
  const subCmd = process.argv[3];
  const { execSync } = await import('child_process');
  const { join } = await import('path');
  const daemonPath = join(aiiaDir, 'pi-agent/src/lark-daemon.js');

  const serviceTpl = `[Unit]
Description=AIIA Pi Remote Daemon
After=network.target

[Service]
ExecStart=${process.execPath} ${daemonPath}
Restart=always
Environment=PATH=${process.env.PATH}

[Install]
WantedBy=default.target
`;

  const servicePath = join(process.env.HOME, '.config/systemd/user/aiia-remote.service');

  try {
    if (subCmd === 'enable') {
      const fs = await import('fs');
      fs.mkdirSync(join(process.env.HOME, '.config/systemd/user'), { recursive: true });
      fs.writeFileSync(servicePath, serviceTpl);
      execSync('systemctl --user daemon-reload');
      execSync('systemctl --user enable aiia-remote.service');
      execSync('systemctl --user start aiia-remote.service');
      console.log('✅ 遥控服务已开启并配置开机自启。');
    } else if (subCmd === 'disable') {
      execSync('systemctl --user stop aiia-remote.service');
      execSync('systemctl --user disable aiia-remote.service');
      console.log('✅ 遥控服务已停止并取消开机自启。');
    } else if (subCmd === 'start') {
      execSync('systemctl --user start aiia-remote.service');
      console.log('✅ 遥控服务已启动。');
    } else if (subCmd === 'stop') {
      execSync('systemctl --user stop aiia-remote.service');
      console.log('✅ 遥控服务已停止。');
    } else if (subCmd === 'status') {
      const out = execSync('systemctl --user status aiia-remote.service || true').toString();
      console.log(out);
    } else {
      console.log('用法: pi remote [enable|disable|start|stop|status]');
    }
  } catch (e) {
    console.error('❌ 服务配置失败 (确保系统支持 systemd user mode):', e.message);
  }
} else {
  console.error(`AIIA CLI Error: Unknown command '${cmd}'`);
  console.error('Available commands: update, status, remote');
  process.exit(1);
}
