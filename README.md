# 川普资本台账 · 公开脱敏版

公开页面：https://blackrimmedlol-code.github.io/gnot-capital-ledger/

## 架构

- **唯一数据源**：`data/ledger-full.json`（完整台账，含股数/成本/成交/周期，raw 可爬取）
- **公开页面**：`public/index.html`（脱敏版，浏览器只加载脱敏数据）
- **构建脚本**：`build_public.js`（从 ledger-full.json 生成脱敏 public/index.html）
- **部署**：GitHub Actions 自动部署 `public/` 目录到 Pages

## 数据口径

- **成本**：分开 `actualCostBasis`（真实买入均价）与 `netInvestedCost`（净投入摊薄）。RAM/IRE/MSTU 为摊薄口径，真实成本待核实
- **统计**："已登记兑现条目"（含部分减仓）≠"完整交易"；胜率仅为条目胜率，样本小不具统计意义
- **覆盖**：分开计算备兑是否足额、正股覆盖比例、未封顶正股、覆盖缺口
- **仓位**：显示等级（轻/中/重/空仓），不显示精确百分比

## 隐私

- 页面不显示：股数、成交股数、期权张数、未覆盖股票数量、投入金额、市值、盈亏金额、权利金总额、现金、NAV
- 源码保留完整数据（供 Agent 爬取），但渲染层不显示

## 更新

```bash
# 1. 修改 data/ledger-full.json（数据）或 投资台账复盘_20260920.html（模板）
# 2. 构建
node build_public.js
# 3. 提交
git add -A && git commit -m "更新" && git push
```

## 文件说明

- `data/ledger-full.json` — 完整台账（唯一数据源）
- `public/index.html` — 公开脱敏版（自动生成，勿手动编辑）
- `build_public.js` — 构建脚本
- `.github/workflows/pages.yml` — Pages 部署配置
