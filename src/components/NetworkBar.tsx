import type { NetworkConfig } from '../transport/types';
import type { OpenAIConfig } from '../transport/openaiCompat';

type Props = {
  mode: 'mock' | 'openai'; onMode(m: 'mock' | 'openai'): void;
  network: NetworkConfig; onNetwork(n: NetworkConfig): void;
  openai: OpenAIConfig; onOpenai(c: OpenAIConfig): void;
};

/** 顶栏:传输选择、网络模拟开关、BYOK 配置 */
export function NetworkBar({ mode, onMode, network, onNetwork, openai, onOpenai }: Props) {
  return (
    <div className="bar">
      <strong>Stream Chat</strong>
      <label>传输
        <select value={mode} onChange={e => onMode(e.target.value as any)}>
          <option value="mock">页内 mock 服务端(支持续传 / 工具调用)</option>
          <option value="openai">OpenAI 兼容接口(BYOK,真实流式)</option>
        </select>
      </label>
      {mode === 'mock' ? (
        <>
          <button className={network.offline ? 'danger' : ''} onClick={() => onNetwork({ ...network, offline: !network.offline })}>{network.offline ? '恢复网络' : '模拟断网'}</button>
          <label>延迟 <input type="range" min={10} max={400} step={10} value={network.latencyMs} onChange={e => onNetwork({ ...network, latencyMs: Number(e.target.value) })} /> {network.latencyMs}ms/帧</label>
          <label>随机断流 <input type="range" min={0} max={1} step={0.1} value={network.dropRate} onChange={e => onNetwork({ ...network, dropRate: Number(e.target.value) })} /> {network.dropRate ? `${Math.round(network.dropRate * 100)}%` : '关'}</label>
        </>
      ) : (
        <>
          <input placeholder="baseURL,如 https://api.openai.com/v1" value={openai.baseURL} onChange={e => onOpenai({ ...openai, baseURL: e.target.value })} style={{ width: 220 }} />
          <input placeholder="API Key(只存本机)" type="password" value={openai.apiKey} onChange={e => onOpenai({ ...openai, apiKey: e.target.value })} style={{ width: 160 }} />
          <input placeholder="model" value={openai.model} onChange={e => onOpenai({ ...openai, model: e.target.value })} style={{ width: 140 }} />
        </>
      )}
      <a className="muted" href="https://gluneko.github.io/Gluneko/me/" style={{ marginLeft: 'auto' }}>← 主页</a>
      <a className="muted" href="https://gluneko.github.io/Gluneko/me/chat-vue/">Vue 3 版</a>
    </div>
  );
}
