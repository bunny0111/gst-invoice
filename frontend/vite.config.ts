import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Django serves the API on :8000. Each business lives on its own subdomain (sharma.localhost:5173),
// so the proxy must NOT rewrite the Host header (changeOrigin: false) - django-tenants picks the
// tenant from it.
const django = { target: 'http://127.0.0.1:8000', changeOrigin: false }

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    strictPort: true,
    allowedHosts: ['.localhost'],
    proxy: { '/api': django, '/media': django },
  },
  build: { chunkSizeWarningLimit: 900 },
})
