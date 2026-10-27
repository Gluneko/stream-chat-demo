# Stream Chat Demo — AI 对话交互的最小实现

在线:https://gluneko.github.io/Gluneko/me/chat/

一个只关心"AI 对话这类产品最难的交互层"的演示:流式输出怎么不丢不重、断线和刷新怎么恢复、停止怎么不留半截、工具调用怎么让人确认、高频帧怎么不卡。协议、状态机、冲刷器、传输层都是手写的;Markdown 渲染用 react-markdown。

## 能演示什么

| 场景 | 怎么触发 | 看什么 |
|---|---|---|
| 流式输出 | 发任意问题 | 打字机、状态芯片 `生成中`、`seq` 递增 |
| 工具调用 + 人在回路 | 问"帮我查一下杭州天气" | 面板里改参数 → 确认执行 / 跳过 → 执行中 → 结果 |
| 断线续传 | 生成中点"模拟断网",再"恢复网络" | `重连中`、退避重连、恢复后 `重复 1`(服务端故意多补一帧,客户端去重) |
| 刷新恢复 | 生成中直接刷新页面 | 已输出的内容还在,从 `lastSeq` 续接,不重跑 |
| 两级停止 | 点"停止" | 先服务端 stop 保存现场,再本地 abort,状态 `已停止` |
| 随机断流 | 把"随机断流"调到 50% | 连接反复被掐,内容依然连续,`缺口 0` |
| 真实模型 | 传输切到 OpenAI 兼容,填 baseURL / key | 真实流式;上游不支持续传,重连走 `isAll` 快照对齐的降级路径 |

## 结构

```
src/protocol/types.ts       帧协议:text / tool_call / tool_status / citation / done / error,每帧 uniqueId + seq
src/protocol/machine.ts     applyFrame:去重、缺口检测、isAll 对齐、状态流转(纯函数,有单测);backoff
src/stream/scheduler.ts     rAF 固定节奏冲刷:数据节奏与渲染节奏解耦,缓冲不丢帧只合并
src/transport/types.ts      Transport 接口:create / subscribe(lastSeq) / stop / confirmTool
src/transport/mockServer.ts 页内服务端:帧计划、生产者、续传补发、工具暂停、localStorage 持久化、网络模拟
src/transport/openaiCompat.ts OpenAI 兼容流式(BYOK),重连 = 重跑 + 快照对齐
src/hooks/useStreamController.ts 控制器:send / stop / regenerate / resume / confirmTool / 刷新恢复 / 退避重连
src/components/*            消息列表(跟随到底、content-visibility)、Markdown(代码块复制、引用角标)、工具面板、网络栏
```

## 设计要点

- **协议三字段**:`uniqueId` 标识一次生成,`seq` 保序去重,`isAll` 让服务端能用快照覆盖对齐。客户端只接受 `seq > lastSeq`。
- **状态机**:`idle → connecting → streaming ⇄ tool_calling / awaiting_confirm → complete | error | aborted`,任一步断连进 `reconnecting`。终态判断不依赖 React 状态(dispatch 是异步的),用帧流里是否见过 `done` 判。
- **两级停止**:用户停止先通知服务端(真正省算力的一级),本地断连只是兜底。
- **刷新恢复 ≠ 断线重连**:前者进程没了,先从本地恢复消息与 `lastSeq` 再续接;后者连接对象还在,`onClose` 直接退避重连。两者最后走同一个 `subscribe(lastSeq)`。
- **渲染**:帧先进缓冲,rAF 按 30fps 冲刷,一帧内的多条 `text` 合并成一次状态更新;长列表用 `content-visibility: auto` 跳过屏外。

## 本地跑

```bash
pnpm install
pnpm test     # 协议状态机单测
pnpm dev      # http://localhost:3300/Gluneko/me/chat/
pnpm build
```
