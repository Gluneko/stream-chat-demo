import { describe, it, expect } from 'vitest';
import { applyFrame } from './machine';
import type { Message, Frame } from './types';

const mk = (): Message => ({ id: 'm', role: 'assistant', content: '', status: 'connecting', uniqueId: 'u1', lastSeq: 0, tools: [], citations: [], createdAt: 0, stats: { frames: 0, dup: 0, gaps: 0, reconnects: 0 } });
const t = (seq: number, delta: string, isAll = false): Frame => ({ type: 'text', uniqueId: 'u1', seq, delta, isAll });

describe('applyFrame', () => {
  it('appends in order and ignores duplicates', () => {
    let m = mk();
    m = applyFrame(m, t(1, 'a')); m = applyFrame(m, t(2, 'b')); m = applyFrame(m, t(2, 'b')); m = applyFrame(m, t(1, 'a'));
    expect(m.content).toBe('ab'); expect(m.lastSeq).toBe(2); expect(m.stats.dup).toBe(2);
  });
  it('counts gaps and realigns on full snapshot', () => {
    let m = mk();
    m = applyFrame(m, t(1, 'a')); m = applyFrame(m, t(5, 'e'));
    expect(m.stats.gaps).toBe(1); expect(m.content).toBe('ae');
    m = applyFrame(m, t(6, 'abcdef', true));
    expect(m.content).toBe('abcdef');
  });
  it('drops frames from another uniqueId', () => {
    const m = applyFrame(mk(), { type: 'text', uniqueId: 'other', seq: 1, delta: 'x' });
    expect(m.content).toBe(''); expect(m.lastSeq).toBe(0);
  });
  it('walks the tool-call state machine', () => {
    let m = mk();
    m = applyFrame(m, { type: 'tool_call', uniqueId: 'u1', seq: 1, callId: 'c1', name: 'search', args: { q: 'x' }, reason: 'r' });
    expect(m.status).toBe('awaiting_confirm');
    m = applyFrame(m, { type: 'tool_status', uniqueId: 'u1', seq: 2, callId: 'c1', status: 'executing' });
    expect(m.status).toBe('tool_calling');
    m = applyFrame(m, { type: 'tool_status', uniqueId: 'u1', seq: 3, callId: 'c1', status: 'done', result: 'ok' });
    expect(m.status).toBe('streaming'); expect(m.tools[0].result).toBe('ok');
    m = applyFrame(m, { type: 'done', uniqueId: 'u1', seq: 4 });
    expect(m.status).toBe('complete');
  });
});
