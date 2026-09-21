# DSH App Server 设计

## 目标

提供稳定的 Thread、Turn、Item 控制面，同时保持协议、Transport、应用服务和 DSH Runtime 解耦。DSH Session event log 是持久事实源，App Server 不创建第二套业务状态。

## 模块边界

```text
Transport
  ├─ stdio：JSONL framing
  └─ HTTP/SSE：连接、认证、回放、背压
            ↓
Protocol
  ├─ JSON-RPC 校验与响应
  ├─ 声明式 Method Schema（校验与调度元数据）
  └─ Domain Error 映射
            ↓
Application
  ├─ Resource method registry
  ├─ Request scheduler
  └─ Approval manager
            ↓
DSH Integration
  ├─ NativeDshAdapter
  ├─ AgentRuntimeRegistry
  ├─ Session Repository / Attachment Gateway
  ├─ Command / Skill / Model Catalog Services
  ├─ Credential / Model Settings / Runtime Capability Services
  └─ Event Normalizer / Transcript / Turn / Notification Projections
```

## 核心约束

- 同一 Thread 的变更串行执行，不同 Thread 并行。
- 模型配置和 Credential 写入分别使用独立管理队列。
- 全局只读请求不共享一个进程级串行队列。
- Runtime Registry 只保存进程内句柄和瞬态状态；关闭 Thread 时集中清理。
- 冷历史通过 persistence read handle 读取，并在读取后立即关闭 handle。
- 事件分页优先使用宿主 `readEvents` 能力；旧 Runtime 回退到快照读取。
- UI transcript 保留完整历史；DSH compaction 只改变模型上下文表面。
- Adapter 不解析 JSON-RPC；Transport 不实现领域行为。
- capabilities 必须反映当前 Context 中真实可用的 DSH 服务。
- 可观测事件只包含标识、耗时、状态和队列统计，不记录业务正文或密钥。
- 超过阈值的纯历史投影进入 Worker Pool，实时 Agent 事件始终留在主线程。
- 大型导出写入受控临时目录并按 TTL 自动删除；小型导出保持内联兼容。

## SSE 一致性

建立 SSE 连接后先订阅并缓冲实时事件，再回放 `afterSeq` 之后的持久通知。回放结束后按 `sourceSeq` 丢弃缓冲区中的重复事件，然后切换到实时模式。带序号事件写入 SSE `id`，客户端可以用 `Last-Event-ID` 恢复。

没有持久序号的 server request（例如 approval）不参与序号去重，在持久回放完成后单独补发。

## 错误模型

- JSON-RPC 结构或参数错误使用标准错误码。
- 领域错误返回稳定的 `error.data.kind`。
- 不允许客户端依赖英文错误消息判断错误类型。
- DSH 旧版本只有错误文本时，可以保留窄范围兼容匹配，但稳定错误码优先。

## 安全边界

- HTTP 默认只绑定回环地址。
- 配置 `authToken` 后使用 Bearer authentication。
- 浏览器 Origin 请求默认拒绝，避免本地服务被网页跨站调用。
- Credential、prompt、附件内容不得进入普通日志。
- 外部网络暴露由宿主提供 TLS、密钥轮换和访问控制。

## 后续演进

`NativeDshAdapter` 仍保留兼容门面。后续新增领域能力时，应优先放入小型端口和应用服务，例如 `ThreadPort`、`SessionQueryPort`、`ModelAdminPort`，避免继续扩大 Adapter。Event projector 应继续拆分为事件归一化、Transcript 投影和通知投影三个阶段。
