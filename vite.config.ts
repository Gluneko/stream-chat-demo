import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// 部署在 gluneko.github.io/Gluneko/me/chat/;dev 与 preview 也用同一个 base,避免资源路径不一致
export default defineConfig({
  plugins: [react()],
  base: '/Gluneko/me/chat/',
  test: { globals: true, include: ['src/**/*.test.ts'] },
});
