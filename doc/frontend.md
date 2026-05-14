# Web 前端

前端使用 Vite、React 和 Tailwind CSS。

## 目录

- `src/main.jsx`
  - React 入口，只负责挂载 App 和全局样式。

- `src/App.jsx`
  - 页面路由和整体壳层。
  - 当前使用 hash 路由：`#/` 是角色控制页，`#/daily` 是每日修炼页。

- `src/pages/`
  - 页面级组合。
  - `RoleOverviewPage.jsx` 是角色状态一览。
  - `DashboardPage.jsx` 是角色列表、脚本策略配置和运行日志。
  - `DailyCultivationPage.jsx` 是每日修炼状态和手动执行入口。

- `src/components/`
  - 通用 UI 组件。
  - `src/components/jobs/` 放角色控制页专用组件。

- `src/hooks/`
  - 前端状态和事件流。
  - `useOpsConsole.js` 负责加载配置、监听 SSE、管理选中任务和日志。

- `src/lib/`
  - 纯工具函数。
  - `api.js` 是 fetch 封装。
  - `ops.js` 是任务、日志和每日修炼的格式化工具。

## 样式

大多数视觉样式使用 Tailwind utility class。

`src/styles.css` 只保留：

- Tailwind 入口
- 全局背景和字体
- 少量字体工具类
- 日志面板扫描线背景
