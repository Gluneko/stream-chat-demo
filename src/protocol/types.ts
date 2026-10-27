/**
 * 流式协议:服务端 → 客户端的帧。
 * 每帧带 uniqueId(一次生成的唯一标识)和 seq(单调递增序号)。
 *  - text:增量文本;isAll=true 时是全量快照(重连 / 刷新对齐用)
 *  - tool_call:模型规划了一次工具调用,带参数,等待确认(需要人在回路)
 *  - tool_status:工具执行状态变化(executing / done / failed / skipped),done 时带 result
 *  - citation:一条引用来源,渲染为角标 [n]
 *  - done:生成结束;error:生成失败(带可读原因)
 */
export type Frame =
  | { type: 'text'; uniqueId: string; seq: number; delta: string; isAll?: boolean }
  | { type: 'tool_call'; uniqueId: string; seq: number; callId: string; name: string; args: Record<string, unknown>; reason: string }
  | { type: 'tool_status'; uniqueId: string; seq: number; callId: string; status: 'executing' | 'done' | 'failed' | 'skipped'; result?: string }
  | { type: 'citation'; uniqueId: string; seq: number; n: number; title: string; source: string }
  | { type: 'done'; uniqueId: string; seq: number }
  | { type: 'error'; uniqueId: string; seq: number; message: string };

/** 消息状态机 */
export type MessageStatus = 'idle' | 'connecting' | 'streaming' | 'tool_calling' | 'awaiting_confirm' | 'reconnecting' | 'complete' | 'error' | 'aborted';

export type ToolCall = { callId: string; name: string; args: Record<string, unknown>; reason: string; status: 'planned' | 'executing' | 'done' | 'failed' | 'skipped'; result?: string };

export type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: MessageStatus;
  uniqueId?: string;      // 生成标识,续传用
  lastSeq: number;        // 已消费的最大 seq,续传用
  tools: ToolCall[];
  citations: { n: number; title: string; source: string }[];
  error?: string;
  createdAt: number;
  stats: { frames: number; dup: number; gaps: number; reconnects: number };
};

export type Session = { id: string; title: string; createdAt: number; messages: Message[] };

export const now = () => Date.now();
export const uid = (p = '') => p + Math.random().toString(36).slice(2, 10);
