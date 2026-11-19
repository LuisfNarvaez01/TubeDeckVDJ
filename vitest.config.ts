import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    clearMocks: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/unit/shared/**/*.test.ts', 'tests/unit/main/**/*.test.ts']
        }
      },
      {
        extends: true,
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['tests/unit/renderer/**/*.test.{ts,tsx}']
        }
      }
    ]
  }
});
