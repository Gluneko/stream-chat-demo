import { useState } from 'react';
import type { Message, ToolCall } from '../protocol/types';
import { Markdown } from './Markdown';

const STATUS_LABEL: Record<Message['status'], string> = {
  idle: '待发送', connecting: '连接中', streaming: '生成中', tool_calling: '工具执行中', awaiting_confirm: '等待确认', reconnecting: '重连中', complete: '完成', error: '出错', aborted: '已停止',
};

type Props = {
  msg: Message; isLast: boolean;
  onStop(): void; onRegenerate(): void; onResume(): void;
  onConfirmTool(callId: string, decision: 'run' | 'skip', args?: Record<string, unknown>): void;
};

export function MessageView({ msg, isLast, onStop, onRegenerate, onResume, onConfirmTool }: Props) {
  const [openCite, setOpenCite] = useState<number | null>(null);
  if (msg.role === 'user') return <div className="row user"><div className="bubble">{msg.content}</div></div>;
  const busy = ['connecting', 'streaming', 'tool_calling', 'awaiting_confirm', 'reconnecting'].includes(msg.status);
  return (
    <div className={`row assistant status-${msg.status}`}>
      <div className="meta">
        <span className={`chip ${msg.status}`}>{STATUS_LABEL[msg.status]}</span>
        <span className="muted">seq {msg.lastSeq} · 帧 {msg.stats.frames} · 重复 {msg.stats.dup} · 缺口 {msg.stats.gaps} · 重连 {msg.stats.reconnects}</span>
        {msg.uniqueId && <span className="muted mono">{msg.uniqueId}</span>}
      </div>
      {msg.tools.map(t => <ToolPanel key={t.callId} tool={t} onConfirm={(d, a) => onConfirmTool(t.callId, d, a)} />)}
      {msg.content ? <Markdown content={msg.content} onCite={setOpenCite} /> : busy ? <div className="thinking"><span /><span /><span /></div> : null}
      {msg.status === 'streaming' && <span className="caret" />}
      {msg.status === 'reconnecting' && <div className="notice">连接中断,正在带 lastSeq={msg.lastSeq} 重连… {msg.error && <span className="muted">({msg.error})</span>}</div>}
      {msg.status === 'error' && <div className="notice err">{msg.error} <button onClick={onResume}>从断点续接</button> <button onClick={onRegenerate}>重新生成</button></div>}
      {msg.citations.length > 0 && (
        <div className="cites">{msg.citations.map(c => (
          <div key={c.n} className={`cite-item ${openCite === c.n ? 'on' : ''}`} onClick={() => setOpenCite(openCite === c.n ? null : c.n)}>[{c.n}] {c.title} <span className="muted">· {c.source}</span></div>
        ))}</div>
      )}
      <div className="actions">
        {busy && <button onClick={onStop}>停止</button>}
        {!busy && isLast && <button onClick={onRegenerate}>重新生成</button>}
        {!busy && <button onClick={() => navigator.clipboard?.writeText(msg.content)}>复制</button>}
      </div>
    </div>
  );
}

/** 工具调用面板:planned 时可编辑参数、确认 / 跳过;之后显示执行状态与结果 */
function ToolPanel({ tool, onConfirm }: { tool: ToolCall; onConfirm(d: 'run' | 'skip', args?: Record<string, unknown>): void }) {
  const [text, setText] = useState(JSON.stringify(tool.args, null, 2));
  const [err, setErr] = useState('');
  const run = () => { try { onConfirm('run', JSON.parse(text)); } catch { setErr('参数不是合法 JSON'); } };
  return (
    <div className={`tool ${tool.status}`}>
      <div className="tool-head"><b>工具调用</b> <code>{tool.name}</code> <span className={`chip ${tool.status}`}>{{ planned: '待确认', executing: '执行中', done: '完成', failed: '失败', skipped: '已跳过' }[tool.status]}</span></div>
      <div className="muted">{tool.reason}</div>
      {tool.status === 'planned' ? (
        <>
          <textarea value={text} onChange={e => { setText(e.target.value); setErr(''); }} rows={4} spellCheck={false} />
          {err && <div className="notice err">{err}</div>}
          <div className="actions"><button className="primary" onClick={run}>确认执行</button><button onClick={() => onConfirm('skip')}>跳过</button></div>
        </>
      ) : (
        <pre className="tool-args">{JSON.stringify(tool.args)}</pre>
      )}
      {tool.result && <div className="tool-result">结果:{tool.result}</div>}
    </div>
  );
}
