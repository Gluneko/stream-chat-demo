/**
 * 把一帧应用到一条助手消息上:负责去重、缺口检测、状态流转。纯函数,可单测。
 *  - seq <= lastSeq → 重复帧,丢弃(重连时服务端可能从更早的位置补发)
 *  - seq > lastSeq + 1 → 缺口,记一次 gap;text 帧若是全量快照(isAll)直接覆盖内容对齐
 *  - 状态:streaming / tool_calling / awaiting_confirm / complete / error
 */
import type { Frame, Message } from './types';

export function applyFrame(msg: Message, f: Frame): Message {
  if (f.uniqueId !== msg.uniqueId) return msg;                       // 不是这条消息的帧(旧连接的迟到帧)
  const stats = { ...msg.stats, frames: msg.stats.frames + 1 };
  if (f.seq <= msg.lastSeq) return { ...msg, stats: { ...stats, dup: stats.dup + 1 } };
  if (f.seq > msg.lastSeq + 1) stats.gaps += 1;
  const base: Message = { ...msg, lastSeq: f.seq, stats };
  switch (f.type) {
    case 'text':
      return { ...base, status: 'streaming', content: f.isAll ? f.delta : base.content + f.delta };
    case 'tool_call':
      return { ...base, status: 'awaiting_confirm', tools: [...base.tools, { callId: f.callId, name: f.name, args: f.args, reason: f.reason, status: 'planned' }] };
    case 'tool_status': {
      const tools = base.tools.map(t => (t.callId === f.callId ? { ...t, status: f.status, result: f.result ?? t.result } : t));
      const status = f.status === 'executing' ? 'tool_calling' : 'streaming';
      return { ...base, tools, status };
    }
    case 'citation':
      return { ...base, citations: [...base.citations, { n: f.n, title: f.title, source: f.source }] };
    case 'done':
      return { ...base, status: 'complete' };
    case 'error':
      return { ...base, status: 'error', error: f.message };
  }
}

/** 指数退避:1s, 2s, 4s … 封顶 10s,加随机抖动防止同时重连 */
export const backoff = (attempt: number) => Math.min(10000, 1000 * 2 ** attempt) * (0.8 + Math.random() * 0.4);
