# 地震台站数据质量检测服务

纯后端 Node.js + TypeScript + Fastify 服务，面向地震台站观测数据接入与质量检测。

## 能力

- 台站档案管理
- 观测摘要批量接入（重复观测幂等去重）
- 采样完整性、波形削顶、时间同步检测
- 质量评分与问题标签
- 质量事件闭环：按台站 + 问题类型自动聚合事件，支持确认、转派、恢复、关闭
- 事件状态与原始观测对账（不一致检测与自动修复）
- 按台站/分数查询观测记录
- 生成时间窗口质量报告

## 质量事件闭环

连续出现的同类问题观测会聚合为一个事件（`台站 + 问题类型`），值守人员按事件处理，无需逐条阅读记录。

### 事件生命周期

```
open → acknowledged → assigned → resolved → closed
```

- 观测接入时自动聚合：命中活动事件则追加关联，否则新建事件
- 本次观测未再出现的问题，对应事件自动恢复（`resolved`）
- 恢复后再次发生会开启新事件，旧事件保留历史
- 重复/乱序补录的观测只补充关联，不改变事件状态与计数

### 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/incidents?stationId=&status=&issueType=` | 事件查询 |
| GET | `/api/incidents/:id` | 事件详情（含历史与关联观测） |
| POST | `/api/incidents/:id/acknowledge` | 确认 `{operator, note?}` |
| POST | `/api/incidents/:id/assign` | 转派 `{operator, assignee, note?}` |
| POST | `/api/incidents/:id/resolve` | 恢复 `{operator, note?}` |
| POST | `/api/incidents/:id/close` | 关闭（仅已恢复事件）`{operator, note?}` |
| GET | `/api/incidents/inconsistencies` | 检测事件状态与最新观测不一致 |
| POST | `/api/incidents/reconcile` | 对账修复：自动恢复/重开 `{operator?}` |

非法状态流转返回 `409`；参数校验失败返回 `400`。

## 启动

```bash
npm install
npm run dev
```

默认端口：`4301`。当前使用内存存储，后续可替换 PostgreSQL/时序数据库，并接入 Kafka、SeedLink 或对象存储。
