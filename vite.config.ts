import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    base: './',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      manifest: 'asset-manifest.json',
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                name: 'translations-zh-CN',
                test: /[\\/]src[\\/]i18n[\\/]translations\.zh-CN\.ts$/,
                priority: 40,
              },
              {
                name: 'translations-en-US',
                test: /[\\/]src[\\/]i18n[\\/]translations\.en-US\.ts$/,
                priority: 40,
              },
              {
                name: 'react-vendor',
                test: /node_modules[\\/](?:react|react-dom|react-router|scheduler)(?:[\\/]|$)/,
                priority: 30,
              },
              {
                name: 'charts-vendor',
                test: /node_modules[\\/](?:recharts|d3-[^\\/]+|@reduxjs[\\/]toolkit|react-redux|redux|reselect|immer|decimal\.js-light)(?:[\\/]|$)/,
                priority: 20,
              },
              {
                name: 'motion-vendor',
                test: /node_modules[\\/](?:motion|framer-motion)(?:[\\/]|$)/,
                priority: 15,
              },
            ],
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // File watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
