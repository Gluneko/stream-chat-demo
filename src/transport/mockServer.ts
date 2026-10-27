/**
 * 页内 mock 服务端:把"服务端该做的事"真做一遍,只是跑在同一个页面里。
 *  - 每次生成有 uniqueId;帧带单调 seq;帧计划在创建时确定(同一个 prompt 可复现)
 *  - 生产者按 latency 节奏推进,遇到 tool_call 暂停等确认;stop 后不再推进
 *  - 订阅:先补发 (lastSeq, produced] 之间的帧(这就是断线续传),再实时推送
 *  - 生成状态持久化到 localStorage:刷新页面后"服务端"还在,客户端带 lastSeq 回来就能续上
 *  - 网络模拟:offline 时订阅立刻被关闭;dropRate 让连接随机断掉(触发客户端退避重连)
 */
import type { Frame } from '../protocol/types';
import { uid } from '../protocol/types';
import type { ChatTurn, CloseReason, NetworkConfig, Transport } from './types';
import { planFrames, type Planned } from './mockContent';

type Run = {
  uniqueId: string;
  prompt: string;
  plan: Planned[];                            // 完整帧计划(不含 seq)
  cursor: number;                             // 下一条要生产的计划索引
  produced: Frame[];                          // 已生产(已分配 seq)的帧
  stopped: boolean;
  waitingTool?: string;                       // 暂停等待确认的 callId
  finished: boolean;
};
type Sub = { lastSeq: number; onFrame: (f: Frame) => void; onClose: (r: CloseReason, d?: string) => void; deliveredSinceOpen: number; dropAt: number };

const LS_KEY = 'chat-demo:mock-runs';

export class MockServer implements Transport {
  readonly name = 'mock';
  readonly supportsResume = true;
  network: NetworkConfig = { offline: false, latencyMs: 60, dropRate: 0 };
  private runs = new Map<string, Run>();
  private subs = new Map<string, Set<Sub>>();
  private timers = new Map<string, number>();
  private persistTimer: number | null = null;

  constructor() { this.restore(); }

  create(prompt: string, _history: ChatTurn[]): string {
    const uniqueId = uid('run_');
    const run: Run = { uniqueId, prompt, plan: planFrames(prompt), cursor: 0, produced: [], stopped: false, finished: false };
    this.runs.set(uniqueId, run);
    this.schedule(uniqueId);
    this.persist();
    return uniqueId;
  }

  subscribe(req: { uniqueId: string; lastSeq: number }, onFrame: (f: Frame) => void, onClose: (r: CloseReason, d?: string) => void): () => void {
    const run = this.runs.get(req.uniqueId);
    if (!run) { queueMicrotask(() => onClose('error', '服务端没有这次生成的记录(uniqueId 过期)')); return () => {}; }
    if (this.network.offline) { queueMicrotask(() => onClose('offline', '网络不可用')); return () => {}; }
    const sub: Sub = { lastSeq: req.lastSeq, onFrame, onClose, deliveredSinceOpen: 0, dropAt: this.network.dropRate > 0 ? 3 + Math.floor(Math.random() * (12 / this.network.dropRate)) : Infinity };
    if (!this.subs.has(run.uniqueId)) this.subs.set(run.uniqueId, new Set());
    this.subs.get(run.uniqueId)!.add(sub);
    // 续传:补发客户端没拿到的帧。故意多补一帧(如果有)来演示客户端的去重
    queueMicrotask(() => {
      const from = Math.max(0, req.lastSeq - 1);
      for (const f of run.produced) if (f.seq > from) this.deliver(run, sub, f);
      if (run.finished || run.stopped) this.close(run.uniqueId, sub, 'end');
      else this.schedule(run.uniqueId);
    });
    return () => { this.subs.get(run.uniqueId)?.delete(sub); };
  }

  stop(uniqueId: string) {
    const run = this.runs.get(uniqueId); if (!run || run.finished) return;
    run.stopped = true; this.clearTimer(uniqueId);
    this.persist();
    for (const s of this.subs.get(uniqueId) ?? []) this.close(uniqueId, s, 'end');
  }

  confirmTool(uniqueId: string, callId: string, decision: 'run' | 'skip', args?: Record<string, unknown>) {
    const run = this.runs.get(uniqueId); if (!run || run.waitingTool !== callId) return;
    run.waitingTool = undefined;
    const idx = run.plan.findIndex(p => p.type === 'tool_status' && (p as any).callId === callId);
    if (decision === 'skip') {
      // 把计划里这个工具的 executing/done 换成 skipped,后续文本照常
      run.plan = run.plan.filter(p => !(p.type === 'tool_status' && (p as any).callId === callId));
      run.plan.splice(run.cursor, 0, { type: 'tool_status', callId, status: 'skipped' } as any);
    } else if (args && idx >= 0) {
      const done = run.plan.find(p => p.type === 'tool_status' && (p as any).callId === callId && (p as any).status === 'done') as any;
      if (done) done.result = `${done.result}(参数:${JSON.stringify(args)})`;
    }
    this.schedule(uniqueId);
  }

  // ---------- 生产者 ----------
  private schedule(uniqueId: string) {
    const run = this.runs.get(uniqueId);
    if (!run || run.finished || run.stopped || run.waitingTool || this.timers.has(uniqueId)) return;
    const t = window.setTimeout(() => { this.timers.delete(uniqueId); this.produceOne(uniqueId); }, this.network.latencyMs);
    this.timers.set(uniqueId, t);
  }
  private clearTimer(uniqueId: string) { const t = this.timers.get(uniqueId); if (t) { clearTimeout(t); this.timers.delete(uniqueId); } }
  private produceOne(uniqueId: string) {
    const run = this.runs.get(uniqueId); if (!run || run.stopped || run.finished) return;
    const planned = run.plan[run.cursor];
    if (!planned) { run.finished = true; this.persist(); return; }
    run.cursor++;
    const frame = { ...planned, uniqueId, seq: run.produced.length + 1 } as Frame;
    run.produced.push(frame);
    if (frame.type === 'tool_call') run.waitingTool = frame.callId;       // 暂停,等人确认
    if (frame.type === 'done' || frame.type === 'error') run.finished = true;
    for (const s of [...(this.subs.get(uniqueId) ?? [])]) this.deliver(run, s, frame);
    if (run.finished) for (const s of [...(this.subs.get(uniqueId) ?? [])]) this.close(uniqueId, s, 'end');
    this.persistSoon();
    this.schedule(uniqueId);
  }
  private deliver(run: Run, sub: Sub, f: Frame) {
    if (!this.subs.get(run.uniqueId)?.has(sub)) return;
    if (this.network.offline) { this.close(run.uniqueId, sub, 'offline', '网络不可用'); return; }
    sub.deliveredSinceOpen++;
    if (sub.deliveredSinceOpen >= sub.dropAt && !run.finished) { this.close(run.uniqueId, sub, 'drop', '连接被随机掐断(模拟)'); return; }
    sub.lastSeq = f.seq; sub.onFrame(f);
  }
  private close(uniqueId: string, sub: Sub, reason: CloseReason, detail?: string) {
    if (!this.subs.get(uniqueId)?.delete(sub)) return;
    sub.onClose(reason, detail);
  }

  // ---------- 持久化(模拟服务端的 Redis) ----------
  private persistSoon() { if (this.persistTimer) return; this.persistTimer = window.setTimeout(() => { this.persistTimer = null; this.persist(); }, 200); }
  private persist() {
    try { localStorage.setItem(LS_KEY, JSON.stringify([...this.runs.values()].slice(-20))); } catch { /* 存储不可用时忽略 */ }
  }
  private restore() {
    try {
      const runs: Run[] = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
      for (const r of runs) { this.runs.set(r.uniqueId, r); if (!r.finished && !r.stopped && !r.waitingTool) this.schedule(r.uniqueId); }
    } catch { /* ignore */ }
  }
  /** 调试面板用 */
  inspect(uniqueId: string) { const r = this.runs.get(uniqueId); return r ? { produced: r.produced.length, cursor: r.cursor, total: r.plan.length, finished: r.finished, stopped: r.stopped, waitingTool: r.waitingTool } : null; }
}
