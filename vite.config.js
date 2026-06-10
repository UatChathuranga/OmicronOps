import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read dynamic port from server/.port, defaulting to 3000 if not found
let targetPort = 3000;
try {
  const portFile = path.join(__dirname, 'server', '.port');
  if (fs.existsSync(portFile)) {
    targetPort = parseInt(fs.readFileSync(portFile, 'utf8').trim(), 10) || 3000;
  }
} catch (e) {
  console.warn('Vite config could not read dynamic server port, using default 3000:', e.message);
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://localhost:${targetPort}`,
        changeOrigin: true
      },
      '/ws': {
        target: `ws://localhost:${targetPort}`,
        ws: true
      }
    }
  }
});
