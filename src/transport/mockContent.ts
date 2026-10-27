/** mock 服务端的"模型":按 prompt 生成一份确定性的帧计划(文本按 2–4 字切成增量帧,中间可插入工具调用与引用) */
import type { Frame } from '../protocol/types';

/** 对联合类型逐项 Omit(普通 Omit 会把联合折叠成公共字段) */
export type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;
export type Planned = DistributiveOmit<Frame, 'uniqueId' | 'seq'>;

const ANSWERS: { match: RegExp; md: string; tool?: { name: string; args: Record<string, unknown>; reason: string; result: string } }[] = [
  {
    match: /sse|流式|断线|续传|重连/i,
    md: `## 流式协议怎么做到"不丢不重"

关键是三个字段:\`uniqueId\`、\`seq\`、\`isAll\`。

1. **序号保序**:每帧带单调递增的 seq,客户端只接受 \`seq > lastSeq\` 的帧,重复的直接丢
2. **断点续传**:断线后带 \`lastSeq\` 重连,服务端从断点补发;服务端在缓存里保留中间帧
3. **全量对齐**:缺口太大时服务端发一帧 \`isAll=true\` 的快照覆盖本地内容

\`\`\`ts
function applyFrame(msg, f) {
  if (f.seq <= msg.lastSeq) return msg;            // 重复帧
  if (f.seq > msg.lastSeq + 1) msg.stats.gaps++;   // 缺口
  return f.isAll ? { ...msg, content: f.delta } : { ...msg, content: msg.content + f.delta };
}
\`\`\`

| 场景 | 触发 | 客户端动作 |
|---|---|---|
| 网络抖动 | onerror | 指数退避重连,带 lastSeq |
| 刷新页面 | 进程重启 | 读本地状态,按 uniqueId + lastSeq 续接 |
| 用户停止 | 点击 | 先发服务端 stop,再 abort 连接 |

线上这套协议把异常中断率压到了 0.5% 以内[1]。`,
  },
  {
    match: /crdt|协同|yjs|编辑器/i,
    md: `## CRDT 为什么能收敛

每个字符带一个全局唯一的 \`(client, clock)\` id 和它插入时的左邻 \`origin\`。并发在同一个 origin 后插入时,所有副本都按 id 排序,所以顺序一致;删除只打墓碑,不真删。

- 离线编辑:本地照常写,上线后交换 state vector,各补缺的部分
- 撤销:只撤自己的事务(按 origin 过滤),不会撤掉别人刚写的
- 大文档:周期快照合并日志,GC 掉墓碑

\`\`\`js
// 最小 RGA:并发兄弟按 id 排序
while (idx < items.length && sibling(items[idx]) && cmpId(items[idx].id, op.id) > 0) idx++;
items.splice(idx, 0, op);
\`\`\`

OT 需要中心服务器按序变换,离线难做;CRDT 可交换、任意顺序合并,这是协作产品选它的原因[1]。`,
  },
  {
    match: /./,
    md: `## 先说结论

这个问题可以拆成三层:**协议**负责不丢不重,**状态机**负责界面和服务端一致,**渲染**负责高频下不卡。

- 协议:\`uniqueId + seq + isAll\`
- 状态机:\`idle → connecting → streaming → tool_calling → complete | error | aborted\`
- 渲染:帧先进缓冲,按 rAF 固定节奏冲刷,Markdown 增量解析

\`\`\`json
{ "type": "text", "seq": 42, "delta": "下一段…" }
\`\`\`

> 试试:点右上角"模拟断网"再"恢复",或者直接刷新页面,这条回答会从断点继续。

需要工具的时候,模型先给出调用计划,**人确认后**才执行[1]。`,
  },
];

const CITATIONS = [{ n: 1, title: 'GeoGPT 流式协议设计说明', source: 'internal/sse-protocol.md · p.3' }];

export function planFrames(prompt: string): Planned[] {
  const answer = ANSWERS.find(a => a.match.test(prompt))!;
  const out: Planned[] = [];
  const wantsTool = /搜|查|找|天气|计算|价格|资料|文献|search/i.test(prompt);
  if (wantsTool) {
    const callId = 'call_' + Math.random().toString(36).slice(2, 8);
    const name = /天气/.test(prompt) ? 'get_weather' : /计算|价格/.test(prompt) ? 'calculator' : 'search_docs';
    const args = name === 'get_weather' ? { city: '杭州', unit: 'celsius' } : name === 'calculator' ? { expression: '(37*89+12)/3' } : { query: prompt.slice(0, 20), top_k: 3 };
    for (const ch of chunks('我先确认一下是否需要调用工具。\n\n')) out.push({ type: 'text', delta: ch });
    out.push({ type: 'tool_call', callId, name, args, reason: '这个问题需要外部数据,直接回答会有幻觉风险' } as Planned);
    out.push({ type: 'tool_status', callId, status: 'executing' } as Planned);
    out.push({ type: 'tool_status', callId, status: 'done', result: name === 'get_weather' ? '杭州 22°C,多云,东北风 2 级' : name === 'calculator' ? '1101.67' : '命中 3 篇:sse-protocol.md、crdt-notes.md、agent-harness.md' } as Planned);
    for (const ch of chunks('工具返回了结果,基于它继续回答:\n\n')) out.push({ type: 'text', delta: ch });
  }
  for (const ch of chunks(answer.md)) out.push({ type: 'text', delta: ch });
  for (const c of CITATIONS) out.push({ type: 'citation', ...c } as Planned);
  out.push({ type: 'done' } as Planned);
  return out;
}

/** 按 2–4 个字符切片,代码块里按行切,模拟 token 粒度 */
function chunks(text: string): string[] {
  const out: string[] = [];
  let i = 0, inCode = false;
  while (i < text.length) {
    if (text.startsWith('```', i)) { const end = text.indexOf('\n', i); out.push(text.slice(i, end + 1)); i = end + 1; inCode = !inCode; continue; }
    if (inCode) { const end = text.indexOf('\n', i); const line = text.slice(i, end + 1); out.push(line); i = end + 1; continue; }
    const n = 2 + Math.floor(Math.random() * 3);
    out.push(text.slice(i, i + n)); i += n;
  }
  return out;
}
