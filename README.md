# 川普资本台账 · 公开脱敏版

公开页面：https://blackrimmedlol-code.github.io/gnot-capital-ledger/

记录 Agent 先读 `AGENTS.md` 和 `RULES_日常更新.md`。日常提交前运行 `node check_update.js`；程序完成数据校验、构建、脱敏检查、派生与实际渲染回归。新交易必须同步持仓、兑现卡片和当日复盘；源码包含标题或部署成功不等于页面已正常显示。

## 架构

- **唯一数据源**：`data/ledger-full.json`（完整台账，含股数/成本/成交/周期，raw 可爬取）
- **公开页面**：`public/index.html`（脱敏版，浏览器只加载脱敏数据）
- **HTML 模板**：`template.html`（已纳入仓库，构建用仓库内相对路径，全新检出即可构建）
- **构建脚本**：`build_public.js`（从 ledger-full.json + template.html 脱敏生成 public/index.html，构建阶段用完整台账预计算期权覆盖）
- **展示计算**：`presentation.js`（账户内正股集中度档位、观察仓排除及过期数量备注清理）
- **校验脚本**：`verify.js`（executionId/episodeId 去重、引用关系、疑似重复成交、持仓对账、成本一致性、成本口径合规、内容哈希）
- **发布检查**：`check_public.js`（允许期权张数、禁止股数与资金金额）
- **部署**：GitHub Actions 顺序执行「数据校验 → 生成公开页面 → 检查发布产物 → 部署 public/」，任一步失败即中止

## 数据口径

- **成本三轨**（不得混用）：
  - `actualCostBasis`（真实买入均价）：内部复盘统一按**移动加权平均法**计算，卖出不改变剩余均价（此性质仅适用该口径）；券商若用 FIFO 或指定批次，保留券商口径不强行覆盖。
  - `netInvestedCost`（正股净投入摊薄）：按正股买卖现金流摊薄，**只含正股现金流**；当前复盘计算忽略费用。
  - `compositeNetInvested`（组合净投入）：仅保留历史数据；当前期权只记录足额备兑状态，不追补权利金、不核算期权或组合收益。
  - 先查已有结单与用户确认；真实必要的数量/价格缺失保留null，不猜填。原始费用保留供对账，不列待补任务。公开不可核算值用“—”，不重复显示内部待补提示。
- **统计**：兑现条目含部分减仓，胜率只纳入可核算完整清仓周期；清仓登记数和可核算周期数分列。交易仓排除已确认观察份额。
- **覆盖**：公开显示足额备兑状态及期权张数，不显示精确正股覆盖比例或自由股数。
- **集中度**：按账户内正股交易仓数量×已有行情价格计算，公开仅档位、排序和最大持仓标的；精确权重只留仓库。持仓日与行情日独立。
- **日期**：复盘及成交展示按中国时间；原始时区及来源时间保留。缺时刻不制造时间；仅有原日期时保留中国日期区间。
- **纪律**：当前约定在`discipline.rules`，页面自动渲染；旧规则/内部观察在`disciplineHistory`及`inactiveRules`，不作当前录入指令。

完整成本算法详见 `data/ledger-full.json` 的 `methodology.costAlgorithm`。

## 隐私

- 页面不显示：股数、成交股数、未覆盖股票数量、投入金额、市值、盈亏金额、权利金总额、现金、NAV
- 页面允许显示：期权张数（call/put 张数，如 ×8）；实际持股股数与资金金额仍禁止
- 完整数据仅在仓库台账供Agent读取；网站只加载白名单脱敏产物，不用隐藏样式替代剥离。

## 更新（日常）

```bash
# 1. 读取AGENTS.md和RULES_日常更新.md，核对远程最新版本
git fetch origin main
# 2. 增量更新唯一台账：execution → 持仓/周期 → 同日review（引用executionId）
# 3. 全链路验收；无需逐项重复运行
node check_update.js
# 4. 再核对远程；有新记录按ID合并并重跑验收，然后提交发布
git add -A && git commit -m "更新" && git push
# 5. 等Actions成功，下载实际线上HTML并执行渲染检查
node test_render.js /实际下载的线上文件路径
```

常规更新只读取相关账户、周期、当前纪律和计划证据；不全读历史规则或重复手算。完整流程与token规则见 `RULES_日常更新.md`。

## 文件说明

- `data/ledger-full.json` — 完整台账（唯一数据源，含完整 qty/cost/executions/episodes）
- `template.html` — HTML 模板（已纳入仓库；构建用完整台账预计算期权覆盖，页面只读预计算结果）
- `public/index.html` — 公开脱敏版（自动生成，勿手动编辑）
- `build_public.js` — 构建脚本（脱敏 + 构建阶段预计算期权覆盖 + 渲染层零泄露自检）
- `presentation.js` — 展示计算（正股集中度档位与过期备注清理，不输出数量/金额/精确比例）
- `verify.js` — 校验脚本（executionId/episodeId 去重、引用关系、疑似重复、持仓对账、成本一致性、成本口径、哈希）
- `check_public.js` — 发布产物检查（允许期权张数、禁止股数与资金金额）
- `AGENTS.md` / `RULES_日常更新.md` — Agent入口、日常闭环、展示及纪律口径、token优化
- `.hashes.json` — 内容哈希记录（数据/模板/规则/脚本，用于判断是否有变化）
- `.github/workflows/pages.yml` — Pages 部署配置（校验→生成→检查→部署）
