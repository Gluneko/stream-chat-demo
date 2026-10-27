import { useState, type KeyboardEvent } from 'react';

export function Composer({ disabled, onSend, onStop, busy }: { disabled: boolean; busy: boolean; onSend(text: string): void; onStop(): void }) {
  const [text, setText] = useState('');
  const submit = () => { const t = text.trim(); if (!t || disabled) return; onSend(t); setText(''); };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } };
  return (
    <div className="composer">
      <textarea value={text} onChange={e => setText(e.target.value)} onKeyDown={onKey} placeholder="输入问题,Enter 发送,Shift+Enter 换行" rows={2} />
      {busy ? <button className="danger" onClick={onStop}>停止</button> : <button className="primary" onClick={submit} disabled={disabled || !text.trim()}>发送</button>}
    </div>
  );
}
