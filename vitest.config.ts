import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'jsdom', include: ['tests/components/**/*.test.tsx'], css: { include: /ui-tokens\.css/ } }, esbuild: { jsx: 'automatic' } });
