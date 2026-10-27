/** 会话与消息:useReducer + localStorage。刷新后消息状态还在,未完成的消息由控制器续接。 */
import type { Message, Session } from './protocol/types';
import { now, uid } from './protocol/types';

export type State = { sessions: Session[]; activeId: string };
export type Action =
  | { type: 'new_session' }
  | { type: 'select'; id: string }
  | { type: 'delete'; id: string }
  | { type: 'add_messages'; sessionId: string; messages: Message[] }
  | { type: 'update'; sessionId: string; messageId: string; patch: Partial<Message> | ((m: Message) => Message) }
  | { type: 'truncate_after'; sessionId: string; messageId: string };

const LS_KEY = 'chat-demo:sessions';

export const newSession = (): Session => ({ id: uid('s_'), title: '新对话', createdAt: now(), messages: [] });

export function load(): State {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) || 'null') as State | null;
    if (s && s.sessions.length) return s;
  } catch { /* ignore */ }
  const s = newSession(); return { sessions: [s], activeId: s.id };
}
export function save(state: State) { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* ignore */ } }

export function reducer(state: State, a: Action): State {
  switch (a.type) {
    case 'new_session': { const s = newSession(); return { sessions: [s, ...state.sessions], activeId: s.id }; }
    case 'select': return { ...state, activeId: a.id };
    case 'delete': { const sessions = state.sessions.filter(s => s.id !== a.id); const next = sessions[0] ?? newSession(); return { sessions: sessions.length ? sessions : [next], activeId: state.activeId === a.id ? next.id : state.activeId }; }
    case 'add_messages': return mapSession(state, a.sessionId, s => ({ ...s, title: s.messages.length ? s.title : (a.messages[0]?.content.slice(0, 24) || s.title), messages: [...s.messages, ...a.messages] }));
    case 'update': return mapSession(state, a.sessionId, s => ({ ...s, messages: s.messages.map(m => (m.id === a.messageId ? (typeof a.patch === 'function' ? a.patch(m) : { ...m, ...a.patch }) : m)) }));
    case 'truncate_after': return mapSession(state, a.sessionId, s => { const i = s.messages.findIndex(m => m.id === a.messageId); return i < 0 ? s : { ...s, messages: s.messages.slice(0, i) }; });
  }
}
const mapSession = (state: State, id: string, fn: (s: Session) => Session): State => ({ ...state, sessions: state.sessions.map(s => (s.id === id ? fn(s) : s)) });

export const mkMessage = (role: Message['role'], content = ''): Message => ({
  id: uid('m_'), role, content, status: role === 'user' ? 'complete' : 'idle', lastSeq: 0, tools: [], citations: [], createdAt: now(),
  stats: { frames: 0, dup: 0, gaps: 0, reconnects: 0 },
});
