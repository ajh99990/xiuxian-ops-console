# 项目架构

这个项目现在分成两类能力：

1. 长时间运行的账号脚本，例如综合优先、修炼闭关、福地探索。
2. 常驻后台服务，负责 UI、账号配置、脚本进程、日志、游戏 WebView 代理和定时任务。

## 目录职责

- `server/dashboard.js`
  - 兼容旧启动命令的薄入口。
  - 实际启动逻辑在 `server/index.js`。

- `server/index.js`
  - 服务端主入口。
  - 创建运行时对象，挂载前端资源，启动 HTTP 服务，启动定时器。
  - 统一处理退出时的清理：停止定时任务、停止脚本进程、关闭 Vite。

- `server/app.js`
  - Express 路由层。
  - 只负责 HTTP API 编排，不直接管理子进程或读写文件细节。

- `server/services/`
  - 后台服务模块。
  - `account-store.js` 负责账号配置读写和脱敏。
  - `daily-cultivation-service.js` 负责每日普通修炼、幂等记录和加成状态。
  - `job-manager.js` 负责启动、停止、批量管理脚本进程。
  - `log-service.js` 负责运行日志读写、按大小裁剪、定时行数清理和清空。
  - `role-state-service.js` 负责角色状态快照、手动刷新、脚本上报和前端推送。
  - `xiuxian-service.js` 封装账号连接和单次游戏 RPC。
  - `json-store.js` 是通用 JSON 状态存储，供每日任务记录执行状态。
  - 日志文件名会保留中文，并只替换路径分隔符等危险字符，避免中文任务名互相撞日志。

- `server/scheduler/`
  - 定时任务基础设施。
  - 使用 `node-cron` 作为底层调度器。
  - 任务文件以后放在 `server/scheduler/tasks/`。

- `lib/`
  - 脚本复用的游戏行为模块。
  - 这里不依赖 dashboard，也不应该处理 UI 或 HTTP。

- `src/`
  - Web 控制台前端。
  - `src/pages/` 放页面级组合，例如角色一览页、角色控制页和每日修炼页。
  - `src/components/` 放可复用 UI 组件，角色控制相关组件放在 `src/components/jobs/`。
  - `src/hooks/` 放前端状态和事件流编排。
  - `src/lib/` 放 API 客户端、格式化函数和无状态工具。

- `auto-*.js`
  - 可独立启动的账号脚本。
  - 长跑脚本继续走 `job-manager` 管理。

- `doc/`
  - 按功能模块维护项目文档。

## 当前边界

dashboard 是单机常驻服务，目前状态仍以本地 JSON 和日志文件为主。

将来如果需要更强的持久化，优先考虑 SQLite。Redis 更适合后续做队列、锁和多 worker 协调。
