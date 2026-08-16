# 岗位画像澄清智能体 · 企业实践介绍

这是一个与招聘工作台完全独立的全屏介绍前端。页面采用固定 1920×1080 画布和“动态蓝图”视觉系统，用 13 页讲清楚：企业为什么需要岗位画像澄清、招聘编制审批完成后如何主动发起澄清、四方角色如何协作、模拟企业数据如何按需进入模型上下文、为什么形成四类业务产物，以及整体技术架构如何保证准确、可控和可追溯。

正式页面是单个自包含的 `index.html`，CSS、动画、图形和交互均为原生实现，不依赖 React 运行时。

## 本地运行

```bash
corepack pnpm install
corepack pnpm dev:intro
```

访问 <http://localhost:5174>。

## 浏览与编辑

- `←` / `→`、`PageUp` / `PageDown`、空格：切换页面
- 鼠标滚轮或手机滑动：切换页面
- 底部圆点：直接跳转到指定页面
- `Home` / `End`：跳到第一页或最后一页
- 按 `E`，或悬停页面左上角：进入浏览器内文本编辑模式
- 编辑模式中的 `SAVE`：将修改保存到浏览器本地
- `DOWNLOAD HTML`：下载包含当前修改的单文件版本

最后一页的“进入 Railway 线上招聘工作台”跳转到 <https://web-production-a9f14.up.railway.app>。

## 构建验证

```bash
corepack pnpm --filter @role-clarifier/intro-web build
```
