/**
 * 真实传输:OpenAI 兼容的 /chat/completions,stream=true。BYOK(key 只存浏览器 localStorage)。
 * 上游不支持续传,所以重连 = 重新生成,第一帧用 isAll 快照把客户端内容对齐(协议层的降级路径)。
 */
import type { Frame } from '../protocol/types';
import { uid } from '../protocol/types';
import type { ChatTurn, CloseReason, Transport } from './types';

export type OpenAIConfig = { baseURL: string; apiKey: string; model: string };

export class OpenAICompat implements Transport {
  readonly name = 'openai-compatible';
  readonly supportsResume = false;
  private runs = new Map<string, { prompt: string; history: ChatTurn[]; content: string; ctrl?: AbortController; stopped: boolean }>();
  constructor(private cfg: OpenAIConfig) {}

  create(prompt: string, history: ChatTurn[]) { const id = uid('oa_'); this.runs.set(id, { prompt, history, content: '', stopped: false }); return id; }

  subscribe(req: { uniqueId: string; lastSeq: number }, onFrame: (f: Frame) => void, onClose: (r: CloseReason, d?: string) => void) {
    const run = this.runs.get(req.uniqueId);
    if (!run) { queueMicrotask(() => onClose('error', '没有这次生成的记录')); return () => {}; }
    const ctrl = new AbortController(); run.ctrl = ctrl;
    let seq = req.lastSeq;
    (async () => {
      try {
        const res = await fetch(`${this.cfg.baseURL.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST', signal: ctrl.signal,
          headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.apiKey}` },
          body: JSON.stringify({ model: this.cfg.model, stream: true, messages: [...run.history, { role: 'user', content: run.prompt }] }),
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        if (req.lastSeq > 0) { run.content = ''; onFrame({ type: 'text', uniqueId: req.uniqueId, seq: ++seq, delta: '', isAll: true }); } // 重跑:先清空对齐
        const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
            for (const line of chunk.split('\n')) {
              if (!line.startsWith('data:')) continue;
              const data = line.slice(5).trim();
              if (data === '[DONE]') { onFrame({ type: 'done', uniqueId: req.uniqueId, seq: ++seq }); onClose('end'); return; }
              try {
                const j = JSON.parse(data); const delta = j.choices?.[0]?.delta?.content;
                if (typeof delta === 'string' && delta) { run.content += delta; onFrame({ type: 'text', uniqueId: req.uniqueId, seq: ++seq, delta }); }
              } catch { /* 坏帧忽略 */ }
            }
          }
        }
        onFrame({ type: 'done', uniqueId: req.uniqueId, seq: ++seq }); onClose('end');
      } catch (e: any) {
        if (e?.name === 'AbortError') onClose(run.stopped ? 'end' : 'abort');
        else onClose('error', e?.message || String(e));
      }
    })();
    return () => ctrl.abort();
  }
  stop(uniqueId: string) { const r = this.runs.get(uniqueId); if (r) { r.stopped = true; r.ctrl?.abort(); } }
  confirmTool() { /* 本传输不演示工具调用 */ }
}
