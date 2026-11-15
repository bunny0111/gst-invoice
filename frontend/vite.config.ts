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
    proxy: { '/api': django, '/media': django, '/share': django },
  },
  build: {
    rollupOptions: {
      output: {
        // Pages load on demand (React.lazy in App.tsx). Libraries go into a few long-lived, cacheable files instead
        // of dozens of tiny shared chunks (one per icon) - each request costs more than its bytes on a phone.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (/[\/](react|react-dom|react-router|react-router-dom|scheduler)[\/]/.test(id)) return 'react'
          if (id.includes('lucide-react')) return 'icons'
          if (id.includes('framer-motion') || id.includes('motion-')) return 'motion'
          return 'vendor'
        },
      },
    },
  },
})
