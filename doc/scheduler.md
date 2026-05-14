# 定时器模块

定时任务基础设施位于 `server/scheduler/`。

底层使用 `node-cron`，上层封装成接近 EggJS schedule 的结构：一个任务声明自己的名称、cron 表达式、时区和执行函数。

## 文件

- `server/scheduler/create-scheduled-task.js`
  - 包装单个定时任务。
  - 支持 `disabled`、`immediate`、`noOverlap`。
  - 记录最近开始时间、结束时间和错误。

- `server/scheduler/index.js`
  - 管理多个定时任务。
  - 提供 `register`、`registerMany`、`startAll`、`stopAll`、`list`、`runNow`。

- `server/scheduler/tasks/index.js`
  - 后续定时任务统一从这里注册。
  - 当前注册了 `daily-cultivate` 每日修炼任务、`role-state-refresh` 角色状态刷新任务和 `log-cleanup` 日志清理任务。

## 任务形状

```js
{
  name: 'daily-cultivate',
  schedule: '0 5 0 * * *',
  timezone: 'Asia/Shanghai',
  noOverlap: true,
  disabled: false,
  async run(context) {
    // 执行业务逻辑
  },
}
```

`schedule` 使用 6 段 cron，第一段是秒。每天北京时间 00:05 是：

```text
0 5 0 * * *
```

## 当前任务

- `daily-cultivate`
  - 默认每天 00:05 执行一次。

- `role-state-refresh`
  - 默认每 5 分钟执行一次。

- `log-cleanup`
  - 默认每小时执行一次。
  - cron：`0 0 * * * *`
  - 会把 `.runtime/logs/*.log` 全部裁剪到最近 100 行。
  - 可通过 `XIUXIAN_LOG_CLEANUP_CRON` 和 `XIUXIAN_LOG_CLEANUP_MAX_LINES` 覆盖。

## API

dashboard 当前提供两个调度器 API：

- `GET /api/schedules`
  - 查看所有注册任务的状态。

- `POST /api/schedules/:name/run`
  - 手动触发某个定时任务。

## 设计约束

- 定时任务只做编排，不直接堆复杂业务逻辑。
- 涉及账号状态、每日执行记录、RPC 调用时，应放到服务模块里。
- 对游戏行为有副作用的任务必须有幂等记录，避免服务重启后重复执行。
- 简单持久状态先用 `server/services/json-store.js`，后续复杂后再迁 SQLite。
- 默认时区为 `Asia/Shanghai`，可通过 `XIUXIAN_TIMEZONE` 覆盖。
