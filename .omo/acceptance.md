# Acceptance — 代码质量审查工具落地

| id | 类型 | 标准 | 如何验证 |
|----|------|------|----------|
| A1 | auto | Biome 可对 pi-agent JS 跑 lint | `cd pi-agent && npx biome check src extensions test` exit 0 |
| A2 | auto | quality-gate 对 .js 含 biome（或 node --check 保底） | `node --test test/quality-gate.test.js` 绿 |
| A3 | auto | quality-gate 对 .py 含 ruff（有则跑） | unit test 覆盖 pickRunners |
| A4 | auto | ast-grep 架构红线可执行 | `bash scripts/quality-check.sh` 中 sg 段 exit 0 |
| A5 | auto | pre-commit 配置存在且 hooks 可装 | 文件存在 + `pre-commit run --all-files` 或 dry 文档 |
| A6 | auto | `.harness/verify.sh` 全绿 | `bash .harness/verify.sh` exit 0 |
