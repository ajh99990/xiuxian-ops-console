# 角色状态

角色状态是控制台的状态快照能力，用来支撑“角色一览”页面。

## 同步方式

状态有两条来源：

- 后台定时刷新
  - 默认每 5 分钟执行一次。
  - cron：`0 */5 * * * *`
  - 可通过 `XIUXIAN_ROLE_STATE_REFRESH_CRON` 覆盖。

- 脚本运行时上报
  - `job-manager` 启动脚本时会注入：
    - `XIUXIAN_ROLE_NAME`
    - `XIUXIAN_ROLE_STATE_REPORT_URL`
  - 公共 RPC 客户端在返回结果包含 `player` 时，会节流上报角色快照。
  - 默认上报节流间隔为 3 秒，可通过 `XIUXIAN_ROLE_STATE_REPORT_MIN_INTERVAL_MS` 调整。

## 状态文件

状态保存在：

```text
.runtime/role-states.json
```

文件保存每个角色最近一次状态摘要和原始 `player.state` 数据。续玩编号不会写入这个状态文件。

## API

- `GET /api/role-states`
  - 获取当前角色状态。

- `POST /api/role-states/refresh`
  - 手动刷新所有角色状态。

- `POST /api/role-states/report`
  - 脚本运行时上报角色状态。

## UI

`#/roles` 是角色一览页。

卡片会展示：

- 境界
- 灵根
- 灵石
- 战力
- 寿命
- 修为进度
- 当前脚本策略
- 是否运行中
- 最近同步时间

详情按钮会打开浮窗查看完整原始状态。
