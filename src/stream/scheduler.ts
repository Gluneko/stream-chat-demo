/**
 * 固定节奏冲刷:帧先进缓冲,按 rAF 以目标 fps 批量交给状态机。
 * 数据节奏和渲染节奏解耦——服务端每秒几十帧也只触发 30 次重渲染;缓冲不丢帧,只合并。
 */
export function createFlusher<T>(fps: number, onFlush: (items: T[]) => void) {
  let buf: T[] = []; let last = 0; let raf = 0; let stopped = false;
  const interval = 1000 / fps;
  const tick = (now: number) => {
    raf = 0;
    if (stopped) return;
    if (now - last >= interval && buf.length) { const items = buf; buf = []; last = now; onFlush(items); }
    if (buf.length) raf = requestAnimationFrame(tick);
  };
  return {
    push(item: T) { buf.push(item); if (!raf) raf = requestAnimationFrame(tick); },
    flushNow() { if (buf.length) { const items = buf; buf = []; onFlush(items); } },
    stop() { stopped = true; if (raf) cancelAnimationFrame(raf); },
  };
}
