import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const isProd = process.env.NODE_ENV === 'production'
const appVersion = JSON.stringify(process.env.npm_package_version ?? '0.0.0')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      __APP_VERSION__: appVersion,
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@main': resolve('src/main'),
      },
    },
    build: {
      sourcemap: !isProd,
      rollupOptions: {
        input: resolve('src/main/index.ts'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      sourcemap: !isProd,
      rollupOptions: {
        input: resolve('src/preload/index.ts'),
      },
    },
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react(), tailwindcss()],
    define: {
      __APP_VERSION__: appVersion,
    },
    resolve: {
      alias: {
        '@': resolve('src/renderer'),
        '@renderer': resolve('src/renderer'),
        '@shared': resolve('src/shared'),
      },
    },
    build: {
      sourcemap: !isProd,
      rollupOptions: {
        input: resolve('src/renderer/index.html'),
      },
    },
  },
})
