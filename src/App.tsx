import { useEffect, useMemo, useReducer, useState } from 'react';
import { load, reducer, save } from './store';
import { MockServer } from './transport/mockServer';
import { OpenAICompat, type OpenAIConfig } from './transport/openaiCompat';
import type { NetworkConfig, Transport } from './transport/types';
import { useStreamController } from './hooks/useStreamController';
import { NetworkBar } from './components/NetworkBar';
import { MessageList } from './components/MessageList';
import { Composer } from './components/Composer';

const mock = new MockServer();   // 单例:它就是"服务端",状态在 localStorage 里,刷新不丢
const LS_OA = 'chat-demo:openai';

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, load);
  useEffect(() => save(state), [state]);
  const [mode, setMode] = useState<'mock' | 'openai'>('mock');
  const [network, setNetwork] = useState<NetworkConfig>({ offline: false, latencyMs: 60, dropRate: 0 });
  const [openai, setOpenai] = useState<OpenAIConfig>(() => { try { return JSON.parse(localStorage.getItem(LS_OA) || 'null') || { baseURL: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini' }; } catch { return { baseURL: '', apiKey: '', model: '' }; } });
  useEffect(() => { try { localStorage.setItem(LS_OA, JSON.stringify(openai)); } catch { /* ignore */ } }, [openai]);
  useEffect(() => { mock.network = network; }, [network]);

  const transport: Transport = useMemo(() => (mode === 'mock' ? mock : new OpenAICompat(openai)), [mode, openai]);
  const ctl = useStreamController(state, dispatch, transport);
  const session = state.sessions.find(s => s.id === state.activeId) ?? state.sessions[0];
  const last = session.messages[session.messages.length - 1];
  const busy = !!last && last.role === 'assistant' && ['connecting', 'streaming', 'tool_calling', 'awaiting_confirm', 'reconnecting'].includes(last.status);

  return (
    <div className="app">
      <NetworkBar mode={mode} onMode={setMode} network={network} onNetwork={setNetwork} openai={openai} onOpenai={setOpenai} />
      <div className="body">
        <aside className="side">
          <button className="primary wide" onClick={() => dispatch({ type: 'new_session' })}>+ 新对话</button>
          {state.sessions.map(s => (
            <div key={s.id} className={`sess ${s.id === state.activeId ? 'on' : ''}`} onClick={() => dispatch({ type: 'select', id: s.id })}>
              <span>{s.title}</span><button className="x" onClick={e => { e.stopPropagation(); dispatch({ type: 'delete', id: s.id }); }}>×</button>
            </div>
          ))}
          <div className="legend">
            <div><b>状态机</b></div>
            <div>idle → connecting → streaming ⇄ tool_calling / awaiting_confirm → complete</div>
            <div>任一步断连 → reconnecting(退避,带 lastSeq)</div>
            <div>停止 → aborted(先服务端 stop 再本地 abort)</div>
          </div>
        </aside>
        <main className="main">
          <MessageList messages={session.messages} handlers={m => ({
            msg: m, isLast: false,
            onStop: () => ctl.stop(session.id, m.id),
            onRegenerate: () => ctl.regenerate(session.id, m.id),
            onResume: () => ctl.resume(session.id, m.id),
            onConfirmTool: (callId, d, a) => ctl.confirmTool(session.id, m.id, callId, d, a),
          })} />
          <Composer disabled={busy || (mode === 'openai' && !openai.apiKey)} busy={busy} onSend={t => ctl.send(session.id, t)} onStop={() => last && ctl.stop(session.id, last.id)} />
        </main>
      </div>
    </div>
  );
}
