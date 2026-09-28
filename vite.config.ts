import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

// Hostnames the development server answers besides localhost. Inside Discord, requests reach
// `npm run dev` through a tunnel, and Vite rejects unknown Host headers ("Blocked request. This
// host is not allowed."). Cloudflare quick tunnels are allowed by default; add others, such as an
// ngrok domain, with DEV_ALLOWED_HOSTS (comma-separated, a leading dot allows all subdomains).
const devAllowedHosts = [
  '.trycloudflare.com',
  ...(process.env.DEV_ALLOWED_HOSTS || '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean),
];

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@crossword/shared': path.resolve(import.meta.dirname, 'packages/shared/src/index.ts'),
      },
    },
    server: {
      allowedHosts: devAllowedHosts,
      // Set DISABLE_HMR=true to turn off hot reloading and file watching.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
