/**
 * 流式控制器:把传输层、状态机、冲刷器串起来。
 *  - send:创建用户消息 + 助手消息,向服务端 create 一次生成,订阅
 *  - 帧 → 冲刷器(30fps 批量)→ applyFrame → 状态更新
 *  - 连接关闭:end 正常结束;drop / offline / error 且消息未完成 → 指数退避重连,带最新 lastSeq
 *  - stop:两级停止,先服务端 stop 保存现场,再关本地连接,状态 aborted
 *  - 刷新恢复:挂载时扫描未完成的消息,按 uniqueId + lastSeq 续接(不重跑)
 */
import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch } from 'react';
import type { Frame, Message, MessageStatus } from '../protocol/types';
import { applyFrame, backoff } from '../protocol/machine';
import { createFlusher } from '../stream/scheduler';
import type { Transport } from '../transport/types';
import { mkMessage, type Action, type State } from '../store';

const UNFINISHED: MessageStatus[] = ['connecting', 'streaming', 'tool_calling', 'awaiting_confirm', 'reconnecting'];
type Active = { unsub: () => void; attempt: number; timer?: number; flusher: ReturnType<typeof createFlusher<Frame>> };

export function useStreamController(state: State, dispatch: Dispatch<Action>, transport: Transport, maxFps = 30) {
  const stateRef = useRef(state); stateRef.current = state;
  const active = useRef(new Map<string, Active>());

  const findMsg = (sessionId: string, messageId: string) => stateRef.current.sessions.find(s => s.id === sessionId)?.messages.find(m => m.id === messageId);
  const patch = useCallback((sessionId: string, messageId: string, p: Partial<Message> | ((m: Message) => Message)) => dispatch({ type: 'update', sessionId, messageId, patch: p }), [dispatch]);

  const close = useCallback((messageId: string) => {
    const a = active.current.get(messageId); if (!a) return;
    if (a.timer) clearTimeout(a.timer); a.flusher.stop(); a.unsub(); active.current.delete(messageId);
  }, []);

  const open = useCallback((sessionId: string, messageId: string, attempt = 0) => {
    const msg = findMsg(sessionId, messageId); if (!msg?.uniqueId) return;
    close(messageId);
    const flusher = createFlusher<Frame>(maxFps, frames => patch(sessionId, messageId, m => frames.reduce(applyFrame, m)));
    const entry: Active = { unsub: () => {}, attempt, flusher };
    active.current.set(messageId, entry);
    if (attempt === 0) patch(sessionId, messageId, m => ({ ...m, status: m.status === 'idle' ? 'connecting' : m.status }));
    // 终态帧是否已经到达:不能靠 React 状态判断(dispatch 是异步的,onClose 时可能还没应用到 state)
    let terminal = false;
    entry.unsub = transport.subscribe({ uniqueId: msg.uniqueId, lastSeq: msg.lastSeq }, f => { if (f.type === 'done' || f.type === 'error') terminal = true; flusher.push(f); }, (reason, detail) => {
      flusher.flushNow();
      const cur = findMsg(sessionId, messageId); if (!cur) return;
      const finished = terminal || !UNFINISHED.includes(cur.status);
      if (reason === 'end') {
        active.current.delete(messageId);
        if (!finished) patch(sessionId, messageId, m => (UNFINISHED.includes(m.status) ? { ...m, status: 'aborted' } : m));   // 服务端停止了但没发 done
        return;
      }
      if (reason === 'abort' || finished) { active.current.delete(messageId); return; }
      // 掉线 / 离线 / 出错:退避重连,带最新 lastSeq
      const next = entry.attempt + 1;
      if (next > 8) { active.current.delete(messageId); patch(sessionId, messageId, { status: 'error', error: `重连 ${next - 1} 次失败:${detail ?? reason}` }); return; }
      patch(sessionId, messageId, m => ({ ...m, status: 'reconnecting', error: detail, stats: { ...m.stats, reconnects: m.stats.reconnects + 1 } }));
      entry.timer = window.setTimeout(() => open(sessionId, messageId, next), backoff(entry.attempt));
    });
  }, [transport, patch, close, maxFps]);

  const send = useCallback((sessionId: string, prompt: string) => {
    const session = stateRef.current.sessions.find(s => s.id === sessionId); if (!session) return;
    const history = session.messages.filter(m => m.status === 'complete').map(m => ({ role: m.role, content: m.content }));
    const user = mkMessage('user', prompt);
    const assistant = mkMessage('assistant'); assistant.status = 'connecting'; assistant.uniqueId = transport.create(prompt, history);
    dispatch({ type: 'add_messages', sessionId, messages: [user, assistant] });
    queueMicrotask(() => open(sessionId, assistant.id));
  }, [transport, dispatch, open]);

  const stop = useCallback((sessionId: string, messageId: string) => {
    const msg = findMsg(sessionId, messageId); if (!msg?.uniqueId) return;
    transport.stop(msg.uniqueId);                                                   // 第一级:服务端停止并保存现场
    close(messageId);                                                               // 第二级:本地断开
    patch(sessionId, messageId, m => (UNFINISHED.includes(m.status) ? { ...m, status: 'aborted' } : m));
  }, [transport, close, patch]);

  /** 重新生成:删掉这条及之后,用同一个 prompt 再发 */
  const regenerate = useCallback((sessionId: string, messageId: string) => {
    const s = stateRef.current.sessions.find(x => x.id === sessionId); if (!s) return;
    const i = s.messages.findIndex(m => m.id === messageId); const userMsg = s.messages.slice(0, i).reverse().find(m => m.role === 'user'); if (!userMsg) return;
    close(messageId);
    dispatch({ type: 'truncate_after', sessionId, messageId: userMsg.id });
    queueMicrotask(() => send(sessionId, userMsg.content));
  }, [close, dispatch, send]);

  /** 出错后的续接:不重跑,带 lastSeq 再订阅 */
  const resume = useCallback((sessionId: string, messageId: string) => { patch(sessionId, messageId, { status: 'reconnecting', error: undefined }); open(sessionId, messageId, 0); }, [open, patch]);

  const confirmTool = useCallback((sessionId: string, messageId: string, callId: string, decision: 'run' | 'skip', args?: Record<string, unknown>) => {
    const msg = findMsg(sessionId, messageId); if (!msg?.uniqueId) return;
    patch(sessionId, messageId, m => ({ ...m, status: 'tool_calling', tools: m.tools.map(t => (t.callId === callId ? { ...t, args: args ?? t.args, status: decision === 'run' ? 'executing' : 'skipped' } : t)) }));
    transport.confirmTool(msg.uniqueId, callId, decision, args);
  }, [transport, patch]);

  // 刷新恢复:挂载或切换传输时,把所有未完成的消息续接上
  useEffect(() => {
    for (const s of stateRef.current.sessions) for (const m of s.messages) {
      if (m.role === 'assistant' && UNFINISHED.includes(m.status) && m.uniqueId && !active.current.has(m.id)) {
        if (transport.supportsResume) open(s.id, m.id, 0);
        else patch(s.id, m.id, { status: 'error', error: '当前传输不支持续传,请重新生成' });
      }
    }
    const map = active.current;
    return () => { for (const id of [...map.keys()]) { const a = map.get(id)!; if (a.timer) clearTimeout(a.timer); a.flusher.stop(); a.unsub(); } map.clear(); };
  }, [transport, open, patch]);

  return { send, stop, regenerate, resume, confirmTool, isActive: (id: string) => active.current.has(id) };
}
