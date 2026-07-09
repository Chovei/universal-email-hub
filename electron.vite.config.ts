import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

import { config as loadDotenv } from 'dotenv'
loadDotenv()

const isProd = process.env.NODE_ENV === 'production'
const appVersion = JSON.stringify(process.env.npm_package_version ?? '0.0.0')

const oauthDefines = {
  'process.env.GMAIL_CLIENT_ID': JSON.stringify(process.env.GMAIL_CLIENT_ID ?? ''),
  'process.env.GMAIL_CLIENT_SECRET': JSON.stringify(process.env.GMAIL_CLIENT_SECRET ?? ''),
  'process.env.GRAPH_CLIENT_ID': JSON.stringify(process.env.GRAPH_CLIENT_ID ?? ''),
  'process.env.GRAPH_CLIENT_SECRET': JSON.stringify(process.env.GRAPH_CLIENT_SECRET ?? ''),
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      __APP_VERSION__: appVersion,
      ...oauthDefines,
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
