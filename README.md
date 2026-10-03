# 川普资本台账 · 公开脱敏版

本仓库托管「投资台账复盘」页面的**公开零暴露版**（GitHub Pages 站点）。

**页面链接**：`https://<owner>.github.io/<repo>/`

## 隐私说明（设计前提）
此处是**脱敏后**的公开副本，遵循约定：页面/源码**不出现股数、美元金额、隐含市值**，仅保留价格、张数、收益率%、仓位%。内部完整数据（股数/成本等）保留在 Agent 本地主文件 `投资台账复盘_20260920.html`，**不进本仓库**。

## 如何更新
每次复盘/交易登记后，从内部主文件重新生成公开版并推送，GitHub Actions 会自动更新 Pages：

```bash
node build_public.js <内部主文件.html> index.html
# 提交并推送，触发 workflow
```

`build_public.js` 会自动：剔除所有 `qty` 股数字段、预计算期权覆盖%（`_cov`）并注入、保留价格/张数/收益率/仓位，生成可在纯静态 GitHub Pages 上正常渲染的零暴露页面。

## 文件
- `index.html`：公开脱敏页面（由 `build_public.js` 生成，请勿手改）
- `build_public.js`：脱敏构建脚本