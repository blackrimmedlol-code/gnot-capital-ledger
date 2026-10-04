# 川普资本台账 · 公开脱敏版

公开页面：https://blackrimmedlol-code.github.io/gnot-capital-ledger/

## 架构

- **唯一数据源**：`data/ledger-full.json`（完整台账，含股数/成本/成交/周期，raw 可爬取）
- **公开页面**：`public/index.html`（脱敏版，浏览器只加载脱敏数据）
- **构建脚本**：`build_public.js`（从 ledger-full.json 生成脱敏 public/index.html）
- **校验脚本**：`verify.js`（executionId 去重 + 成本口径合规 + 内容哈希）
- **部署**：GitHub Actions 自动部署 `public/` 目录到 Pages

## 数据口径

- **成本三轨**（不得混用）：
  - `actualCostBasis`（真实买入均价）：内部复盘统一按**移动加权平均法**计算，卖出不改变剩余均价（此性质仅适用该口径）；券商若用 FIFO 或指定批次，保留券商口径不强行覆盖。
  - `netInvestedCost`（正股净投入摊薄）：按正股买卖现金流及对应费用摊薄，**只含正股现金流**。
  - `compositeNetInvested`（组合净投入）：在正股现金流基础上计入期权现金流（权利金收入、期权盈亏），与正股净投入分开记。
  - 历史数据不足（批次/费用/权利金缺失）时保留「待核实」（value=null），不倒推。
- **统计**："已登记兑现条目"（含部分减仓）≠"完整交易"；胜率仅为条目胜率，样本小不具统计意义
- **覆盖**：分开计算备兑是否足额、正股覆盖比例、未封顶正股、覆盖缺口
- **仓位**：显示等级（轻/中/重/空仓），不显示精确百分比

完整成本算法详见 `data/ledger-full.json` 的 `methodology.costAlgorithm`。

## 隐私

- 页面不显示：股数、成交股数、期权张数、未覆盖股票数量、投入金额、市值、盈亏金额、权利金总额、现金、NAV
- 源码保留完整数据（供 Agent 爬取），但渲染层不显示

## 更新（日常）

```bash
# 1. 记录起始版本 + 校验
node verify.js            # 确认 executionId 无重复、成本口径分记正确、记录内容哈希
git fetch origin main     # 核对远程最新，有新增记录先合并（勿用旧台账覆盖）
# 2. 修改 data/ledger-full.json（数据）或 投资台账复盘_20260920.html（模板文字），局部补丁
# 3. 构建脱敏页
node build_public.js
# 4. 再校验 + 提交
node verify.js
git add -A && git commit -m "更新" && git push
```

三种模式（本次迁移/日常更新/完整复盘）与 token 优化规则见 `RULES_日常更新.md`。

## 文件说明

- `data/ledger-full.json` — 完整台账（唯一数据源，含完整 qty/cost/executions/episodes）
- `public/index.html` — 公开脱敏版（自动生成，勿手动编辑）
- `build_public.js` — 构建脚本（脱敏 + 渲染层零泄露自检）
- `verify.js` — 校验脚本（去重 + 成本口径 + 哈希）
- `RULES_日常更新.md` — 日常更新规则（三种模式 + 程序化边界 + token 优化）
- `.hashes.json` — 内容哈希记录（数据/模板/规则/脚本，用于判断是否有变化）
- `.github/workflows/pages.yml` — Pages 部署配置