import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// /wh/{item|spell}/{id} is proxied to Wowhead's Forever tooltip endpoint.
// Production uses the same path via a rewrite in vercel.json.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/wh': {
        target: 'https://nether.wowhead.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/wh/, '/forever/tooltip'),
      },
    },
  },
  test: {
    environment: 'node',
  },
});
