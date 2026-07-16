import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Schnell Fleet Analytics — React UI build.
//
// Dev:   `npm run dev` serves on :5173 and proxies /api and /matter to the
//        FastAPI backend on :8080 (start it with ../analytics-api/run-local.sh),
//        so the new UI runs against the SAME backend with zero backend changes.
// Build: `npm run build` emits static files to dist/. At cutover time, Firebase
//        Hosting will serve dist/ (public/matter/ is deployed separately and
//        unchanged — the Node/Thread tabs keep pointing at /matter).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
      '/matter': 'http://localhost:8080',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
