import type { Frame } from '../protocol/types';

export type CloseReason = 'end' | 'drop' | 'offline' | 'abort' | 'error';
export type ChatTurn = { role: 'user' | 'assistant'; content: string };

/**
 * 传输层接口:客户端只依赖它,不关心背后是页内 mock 服务端还是真实的 OpenAI 兼容接口。
 *  - create:服务端创建一次生成,返回 uniqueId
 *  - subscribe:从 lastSeq 之后开始接收帧;返回的函数只是关闭连接(不等于停止生成)
 *  - stop:两级停止的第一级——通知服务端停止生成并保存现场
 *  - confirmTool:人在回路的确认结果
 */
export interface Transport {
  readonly name: string;
  readonly supportsResume: boolean;
  create(prompt: string, history: ChatTurn[]): string;
  subscribe(req: { uniqueId: string; lastSeq: number }, onFrame: (f: Frame) => void, onClose: (reason: CloseReason, detail?: string) => void): () => void;
  stop(uniqueId: string): void;
  confirmTool(uniqueId: string, callId: string, decision: 'run' | 'skip', args?: Record<string, unknown>): void;
}

/** 模拟网络条件(只对 mock 传输生效,也用于展示) */
export type NetworkConfig = { offline: boolean; latencyMs: number; dropRate: number };
