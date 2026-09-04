import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'node:fs';
import { brightDataPartsDevPlugin } from './brightdata-parts-dev';

const componentMetadataId = 'virtual:schematic-component-metadata';
const resolvedComponentMetadataId = `\0${componentMetadataId}`;

export default defineConfig({
  plugins: [
    {
      name: 'schematic-component-metadata',
      enforce: 'pre',
      resolveId(source) {
        return source === componentMetadataId ? resolvedComponentMetadataId : null;
      },
      load(id) {
        if (id !== resolvedComponentMetadataId) return null;
        const metadataPath = path.resolve(__dirname, 'public/components-metadata.json');
        const metadata = fs.readFileSync(metadataPath, 'utf8');
        return `export default ${metadata};`;
      },
    },
    brightDataPartsDevPlugin(__dirname),
    react(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@schematic/hardware-graph': path.resolve(__dirname, '../packages/hardware-graph/src'),
      '@schematic/behavior/canonicalize': path.resolve(__dirname, '../packages/behavior/src/canonicalize.ts'),
      '@schematic/behavior': path.resolve(__dirname, '../packages/behavior/src/index.ts'),
      '@schematic/validation': path.resolve(__dirname, '../packages/validation/src'),
      '@schematic/component-format': path.resolve(__dirname, '../packages/component-format/src'),
      '@schematic/firmware-harness': path.resolve(__dirname, '../packages/firmware-harness/src/index.ts'),
      '@schematic/project-storage': path.resolve(__dirname, '../packages/project-storage/src'),
    },
  },
  server: {
    port: 3000,
    host: "0.0.0.0",
    headers: {
      'Origin-Agent-Cluster': '?1',
      'Permissions-Policy': 'tools=(self)',
    },
    fs: {
      allow: [path.resolve(__dirname, '..')],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
    },
  },
  assetsInclude: ['**/*.wasm', '**/*.glb'],
  optimizeDeps: {
    include: ['zustand', 'zod', '@xyflow/react', 'lucide-react'],
    esbuildOptions: { target: 'esnext' },
  },
  esbuild: { target: 'esnext', legalComments: 'none' },
  build: {
    target: 'esnext',
    assetsInlineLimit: 0,
    cssCodeSplit: true,
    sourcemap: false,
    cssMinify: true,
    minify: 'esbuild',
    chunkSizeWarningLimit: 1000,
    reportCompressedSize: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'xyflow': ['@xyflow/react'],
          'monaco': ['monaco-editor', '@monaco-editor/react'],
          'zustand': ['zustand'],
        },
        compact: true,
      },
    },
  },
  preview: {
    port: 4173,
    host: "0.0.0.0",
    headers: {
      'Origin-Agent-Cluster': '?1',
      'Permissions-Policy': 'tools=(self)',
    },
  },
});
