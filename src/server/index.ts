import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config';
import { registerRoutes } from './routes';
import { cleanupScratch, ensureDirs, killActiveProcesses } from './lib/util';
import { sweepAssets } from './lib/assets';
import { sweepJobs } from './lib/jobs';
import { sweepUploads } from './lib/uploads';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = fs.existsSync(path.join(here, '..', 'package.json')) ? path.join(here, '..') : path.join(here, '..', '..');
const dist = path.join(root, 'dist');

async function main() {
  await ensureDirs();
  await cleanupScratch();

  const app = Fastify({ logger: false, bodyLimit: 12 * 1024 * 1024, trustProxy: true });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // wasm + Vite inline runtime
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:', 'data:'],
        connectSrc: ["'self'", 'blob:', 'data:'],
        workerSrc: ["'self'", 'blob:', 'data:'],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
  });
  await app.register(cors, { origin: false });
  await registerRoutes(app);

  if (fs.existsSync(dist)) {
    await app.register(fastifyStatic, { root: dist, prefix: '/', wildcard: false, decorateReply: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Endpoint not found.', remedy: 'Check the API path.' } });
      return reply.type('text/html').send(fs.createReadStream(path.join(dist, 'index.html')));
    });
  }

  const sweep = setInterval(() => { void sweepAssets(); void sweepJobs(); void sweepUploads(); void cleanupScratch(); }, 5 * 60_000);
  sweep.unref();
  const shutdown = async () => {
    clearInterval(sweep);
    killActiveProcesses();
    await app.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ port: config.port, host: config.host });
  console.log(`SPLICE API listening on ${config.host}:${config.port} (scratch: ${config.scratch})`);
}

main().catch((e) => { console.error('Failed to start SPLICE:', e instanceof Error ? e.message : e); process.exit(1); });
