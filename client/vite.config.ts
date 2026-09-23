import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { execSync } from 'node:child_process';

function resolveGitShortHash(): string {
  try {
    const shortSha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    return shortSha || 'nogit';
  } catch {
    return 'nogit';
  }
}

function resolveGitCommitTitle(): string {
  try {
    const title = execSync('git log -1 --format=%s', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    return title || 'unknown commit';
  } catch {
    return 'unknown commit';
  }
}

function resolveBuildMeta() {
  const date = new Date().toISOString();
  const stamp = date.replace(/[^0-9]/g, '').slice(0, 14);
  const shortHash = resolveGitShortHash();
  const commitTitle = resolveGitCommitTitle();

  return {
    id: `${shortHash}-${stamp}`,
    shortHash,
    commitTitle,
    date,
  };
}

const buildMeta = resolveBuildMeta();

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(buildMeta.id),
    __BUILD_META__: JSON.stringify(buildMeta),
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@defcon/shared': path.resolve(__dirname, '../shared/src/index.ts'),
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // Keep react core together for stable long-term browser caching.
            if (
              id.includes('/react/') ||
              id.includes('\\react\\') ||
              id.includes('/react-dom/') ||
              id.includes('\\react-dom\\') ||
              id.includes('/react-router-dom/') ||
              id.includes('\\react-router-dom\\')
            ) {
              return 'react';
            }

            // Query client separate cache bucket.
            if (id.includes('/@tanstack/react-query/') || id.includes('\\@tanstack\\react-query\\')) {
              return 'query';
            }

            // Bubblemaps 3D stack is heavy and route-specific.
            if (
              id.includes('/react-force-graph-2d/') ||
              id.includes('\\react-force-graph-2d\\') ||
              id.includes('/three/') ||
              id.includes('\\three\\') ||
              id.includes('/3d-force-graph/') ||
              id.includes('\\3d-force-graph\\')
            ) {
              return 'forcegraph';
            }
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
