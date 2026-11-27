import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  worker: {
    // Ensures Web Workers can use ES module imports (like `import * as XLSX from 'xlsx'`)
    format: 'es',
  },
  server: {
    port: 5173,
    proxy: {
      // Proxies /api requests to backend
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
