# 画像澄清 Agent · 系统设计演示

这是一个与招聘工作台完全独立的全屏介绍前端。页面采用固定 1920×1080 画布和“动态蓝图”视觉系统，用 11 页讲清楚：为什么需要画像澄清 Agent、意图如何分流、工具如何按任务收紧、Prompt 如何分层、Sidecar-only 如何执行，以及简单问候为何仍会调用真实模型。

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

最后一页的“进入招聘工作台”默认跳转到 <http://127.0.0.1:5173/>。

## 构建验证

```bash
corepack pnpm --filter @role-clarifier/intro-web build
```
