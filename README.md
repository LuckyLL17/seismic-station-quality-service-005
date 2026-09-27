# 地震台站数据质量检测服务

纯后端 Node.js + TypeScript + Fastify 服务，面向地震台站观测数据接入与质量检测。

## 能力

- 台站档案管理
- 观测摘要批量接入
- 采样完整性、波形削顶、时间同步检测
- 质量评分与问题标签
- 按台站/分数查询观测记录
- 按台站/分数查询观测记录
- 生成时间窗口质量报告
- 质量事件闭环：按台站+问题类型聚合连续异常，支持确认、转派、恢复、关闭，自动去重、复发重开与状态对账

## 质量事件闭环

同站台、同问题类型的连续异常观测聚合为一个可交接事件，状态机：

```
open → acknowledged → assigned → resolved → closed
                    ↘ resolved ↗
resolved/closed 后再次发生 → 自动 reopened（沿用原事件与历史）
```

- 观测接入时按 `stationId + observedAt` 判重，重复上报返回原记录（`deduplicated: true`），不重复计数
- 恢复/关闭前校验事件状态与原始观测是否一致；最新观测仍含该问题时拒绝恢复，可带 `force: true` 人工兜底
- `POST /api/quality/incidents/reconcile` 对账：最新观测已正常的未闭环事件自动置为恢复

接口：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/quality/incidents?stationId&status&issueType` | 事件列表（支持过滤） |
| GET | `/api/quality/incidents/:id` | 事件详情，含完整处理历史与一致性检查 |
| POST | `/api/quality/incidents/:id/acknowledge` | 确认（open 可操作） |
| POST | `/api/quality/incidents/:id/assign` | 转派（body: `assignee`） |
| POST | `/api/quality/incidents/:id/resolve` | 恢复（支持 `force`） |
| POST | `/api/quality/incidents/:id/close` | 关闭（仅 resolved，支持 `force`） |
| POST | `/api/quality/incidents/reconcile` | 批量对账 |

## 启动

```bash
npm install
npm run dev
```

默认端口：`4301`。当前使用内存存储，后续可替换 PostgreSQL/时序数据库，并接入 Kafka、SeedLink 或对象存储。
