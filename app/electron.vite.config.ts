import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = resolve(__dirname, 'src/shared')

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias: { '@shared': shared, '@ui': resolve(__dirname, 'src/renderer/ui') } },
    plugins: [react(), tailwindcss()],
    build: {
      // El dashboard viaja por wifi a la tablet: que pese lo menos posible
      minify: true,
      rollupOptions: {
        input: {
          // App de escritorio
          index: resolve(__dirname, 'src/renderer/index.html'),
          // Dashboard para tablet/celular: lo sirve el servidor LAN
          dashboard: resolve(__dirname, 'src/renderer/dashboard.html'),
        },
      },
    },
  },
})
