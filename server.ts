import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { runMigrations } from './packages/server/src/db/migrations.js';
import { asyncHandler } from './packages/server/src/api/middleware.js';
import { apiRouter } from './packages/server/src/api/routes.js';
import { handleDiscordInteractions } from './packages/server/src/discord/interactions.js';
import { defaultBotClient } from './packages/server/src/discord/bot.js';
import { dailyScheduler } from './packages/server/src/scheduler/cron.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  await runMigrations();

  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);
  const isProd = process.env.NODE_ENV === 'production';

  // Discord HTTP Interaction endpoint (needs raw body for ed25519 signature verification)
  app.post(
    '/api/interactions',
    express.raw({ type: 'application/json' }),
    asyncHandler(handleDiscordInteractions)
  );

  // Standard JSON body parsing for all other /api routes
  app.use(express.json());

  // Mount API router
  app.use('/api', apiRouter);

  // Errors from async handlers end up here instead of crashing the process.
  app.use('/api', (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[Server] Unhandled API error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Bot commands registration (async in background)
  defaultBotClient.registerCommands().catch((err) => {
    console.warn('[Server] Bot commands registration note:', err);
  });

  // Start cron scheduler for daily puzzle release and leaderboard posts
  dailyScheduler.start();

  if (!isProd) {
    // Vite dev server middleware
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    console.log('[Server] Mounted Vite dev middleware.');
  } else {
    // Serve production static build
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = http.createServer(app);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Daily Crossword Activity server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[Server] Fatal startup error:', err);
  process.exit(1);
});
