# 川普资本台账 · 交易复盘页

本仓库托管「投资台账复盘」页面的 GitHub Pages 站点，**源码含完整交易数据**。

**页面链接**：`https://blackrimmedlol-code.github.io/gnot-capital-ledger/`

## 隐私设计（2026-10-03 定调）
- **源码（DATA）保留完整字段**：股数 `qty`、每股成本 `cost`、期权张数 `mult`/行权价 `strike`、平仓记录等全部保留，方便其他 Agent 抓取仓库里的交易记录做表现回顾。
- **页面渲染层不显示**：`renderHoldings` / `renderClosed` 等渲染函数不把 `qty`（股数）输出到可见 DOM，只显示价格、张数、收益率%、仓位%、覆盖率%。公布页面（浏览器可见内容）仍无股数、无美元总金额、无隐含市值。

## 如何更新
每次复盘/交易登记后，从内部主文件重新生成并推送，GitHub Actions 自动更新 Pages：

```bash
node build_public.js <内部主文件.html> index.html
git add . && git commit -m "复盘更新" && git push origin main
```

`build_public.js` 会：①渲染层零股数自检（拼接 HTML 的行不得出现 qty）；②原样复制源文件（保留完整 qty/cost）；③打印数据完整性摘要。

## 文件
- `index.html`：发布页面（由 `build_public.js` 生成，请勿手改）
- `build_public.js`：发布脚本
- `.github/workflows/pages.yml`：GitHub Pages 自动部署