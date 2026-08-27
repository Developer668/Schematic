import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@schematic/hardware-graph': path.resolve(__dirname, '../packages/hardware-graph/src'),
      '@schematic/validation': path.resolve(__dirname, '../packages/validation/src'),
      '@schematic/component-format': path.resolve(__dirname, '../packages/component-format/src'),
    },
  },
  server: {
    port: 3000,
    host: "0.0.0.0",
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
    },
  },
  assetsInclude: ['**/*.wasm'],
  optimizeDeps: {
    include: ['zustand', 'zod', '@xyflow/react'],
  },
  build: {
    chunkSizeWarningLimit: 8000,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'xyflow': ['@xyflow/react'],
          'monaco': ['monaco-editor', '@monaco-editor/react'],
        },
      },
    },
  },
});
