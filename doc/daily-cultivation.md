# 每日修炼

每日修炼是一个定时一次性任务，不是长跑脚本。

它每天默认在北京时间 `00:05:00` 执行，对配置中的每个带续玩编号的角色发送一次普通修炼：

```js
action.cultivate { mode: 'manual' }
```

不会闭关、不会突破、不会循环。

## 定时任务

任务名：

```text
daily-cultivate
```

默认 cron：

```text
0 5 0 * * *
```

可通过环境变量覆盖：

- `XIUXIAN_DAILY_CULTIVATION_CRON`
- `XIUXIAN_TIMEZONE`
- `XIUXIAN_DAILY_CULTIVATION_INCLUDE_DISABLED=false`

默认会包含有续玩编号的角色，即使该角色对应的长跑脚本策略未启用。这样可以让不跑自动化脚本的角色也继续累积修炼加成。

服务端有一层互斥保护：如果定时任务正在执行，手动执行会被跳过，不会并发发送重复修炼请求。

## 状态文件

状态保存在：

```text
.runtime/daily-cultivation.json
```

记录内容包括：

- 每个角色当天是否已经尝试
- 最近成功/失败时间
- 连续修炼天数
- 经验加成百分比
- 当前修炼倍率
- 最近错误信息

状态文件不保存完整续玩编号，只保存哈希 key 和脱敏显示值。

每日状态会按当天日期归一：昨天已经完成的角色，到了新的一天会重新显示为未执行，但仍保留历史加成、连续天数和倍率信息。异常中断留下的 `running` 状态在超过 10 分钟后会被视为可重试。

执行日志写入：

```text
.runtime/logs/daily-cultivation.log
```

## API

- `GET /api/daily-cultivation`
  - 获取所有角色的每日修炼状态。

- `POST /api/daily-cultivation/run`
  - 手动执行一次每日修炼。
  - 默认遵守当天幂等规则，不会重复修炼已经尝试过的角色。

- `POST /api/schedules/daily-cultivate/run`
  - 通过通用调度器手动触发同一个任务。

## UI

控制台有单独的“每日修炼”页面，包括：

- 角色名
- 执行状态
- 连续修炼天数
- 经验加成
- 最近修炼日
- 当前修炼倍率

手动执行入口也在这个独立页面，角色控制页不再直接放每日修炼的执行按钮。

经验加成计算方式与游戏前端一致：

```text
min(cultivation_streak * 5, 50)
```
