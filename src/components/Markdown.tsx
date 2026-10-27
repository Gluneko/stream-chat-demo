import { memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import python from 'highlight.js/lib/languages/python';
// 只打包常用语言,避免 lowlight 的 common 集把包体撑到 500KB+
const LANGS = { javascript, js: javascript, typescript, ts: typescript, json, bash, sh: bash, python, py: python };

/**
 * 流式 Markdown:内容每帧变化,整段重新解析(react-markdown 内部按 AST diff,成本可接受);
 * 代码块带语言标签和复制;引用角标 [n] 渲染成可点击的上标。memo 避免父组件无关更新触发重解析。
 */
export const Markdown = memo(function Markdown({ content, onCite }: { content: string; onCite?: (n: number) => void }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false, languages: LANGS }]]}
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          p: ({ children }) => <p>{citeify(children, onCite)}</p>,
          li: ({ children }) => <li>{citeify(children, onCite)}</li>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

function CodeBlock({ children }: { children: any }) {
  const [copied, setCopied] = useState(false);
  const code = children?.props?.children; const lang = (children?.props?.className || '').replace('hljs language-', '').replace('language-', '');
  const text = typeof code === 'string' ? code : Array.isArray(code) ? code.join('') : '';
  return (
    <div className="code">
      <div className="code-head"><span>{lang || 'text'}</span><button onClick={() => { navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>{copied ? '已复制' : '复制'}</button></div>
      <pre>{children}</pre>
    </div>
  );
}

/** 把文本里的 [n] 换成角标 */
function citeify(children: any, onCite?: (n: number) => void): any {
  const walk = (node: any): any => {
    if (typeof node === 'string') {
      const parts = node.split(/(\[\d+\])/g);
      if (parts.length === 1) return node;
      return parts.map((p, i) => { const m = /^\[(\d+)\]$/.exec(p); return m ? <sup key={i} className="cite" onClick={() => onCite?.(Number(m[1]))}>[{m[1]}]</sup> : p; });
    }
    if (Array.isArray(node)) return node.map(walk);
    return node;
  };
  return walk(children);
}
