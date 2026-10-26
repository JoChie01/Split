import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // In development, send API calls to the API server on your computer,
  // so the browser sees one site and the login cookie works.
  server: {
    proxy: {
      "/auth": "http://127.0.0.1:3000",
      "/me": "http://127.0.0.1:3000",
      "/groups": "http://127.0.0.1:3000",
      "/join": "http://127.0.0.1:3000",
    },
  },
})
