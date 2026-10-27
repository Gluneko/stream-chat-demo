import { useEffect, useRef, useState } from 'react';
import type { Message } from '../protocol/types';
import { MessageView } from './MessageView';

/**
 * 消息列表:跟随到底(用户往上翻时不打扰),长列表靠 content-visibility 跳过屏外渲染。
 */
export function MessageList(props: { messages: Message[]; handlers: (m: Message) => Parameters<typeof MessageView>[0] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState(true);
  const last = props.messages[props.messages.length - 1];
  useEffect(() => { if (stick && ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [last?.content, last?.status, props.messages.length, stick]);
  const onScroll = () => { const el = ref.current!; setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 40); };
  return (
    <div className="list" ref={ref} onScroll={onScroll}>
      {props.messages.length === 0 && (
        <div className="empty">
          <h2>Stream Chat Demo</h2>
          <p>一个 AI 对话交互的最小实现:流式协议(seq / uniqueId / isAll)、断线续传、刷新恢复、两级停止、工具调用确认、Markdown 流式渲染。</p>
          <p className="muted">试试输入:"SSE 断线续传怎么做"、"帮我查一下杭州天气"、"CRDT 为什么能收敛"。然后点右上角"模拟断网"或直接刷新页面。</p>
        </div>
      )}
      {props.messages.map((m, i) => <div key={m.id} className="item"><MessageView {...props.handlers(m)} msg={m} isLast={i === props.messages.length - 1} /></div>)}
      {!stick && <button className="to-bottom" onClick={() => { setStick(true); ref.current!.scrollTop = ref.current!.scrollHeight; }}>回到底部 ↓</button>}
    </div>
  );
}
