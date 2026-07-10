import 'dotenv/config';
import express from 'express';
import { existsSync } from 'fs';
import { join } from 'path';
import apiRouter from './routes/api';
import { closeBrowser } from './services/pdf-generator.service';
import { getLanIpv4Addresses, getPublicUrls } from './lib/network';

function resolvePublicDir(): string {
  const candidates = [
    join(__dirname, 'public'),
    join(process.cwd(), 'src', 'public'),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'index.html'))) return dir;
  }
  return join(process.cwd(), 'src', 'public');
}

const app = express();
const HOST = process.env.HOST || '0.0.0.0';
const PORT = parseInt(process.env.PORT || '3000', 10);

function getLocalIpv4Addresses(): string[] {
  return getLanIpv4Addresses();
}

app.use(express.json());
app.use(express.static(resolvePublicDir()));
app.use('/api', apiRouter);

app.get('/health', (_req, res) => {
  const urls = getPublicUrls(PORT);

  res.json({
    status: 'ok',
    host: HOST,
    port: PORT,
    urls,
    networkUrl: urls.find((url) => !url.includes('localhost')) ?? urls[0],
  });
});

const server = app.listen(PORT, HOST, () => {
  const ips = getLocalIpv4Addresses();

  console.log('');
  console.log('=== Etiquetas Colineal ===');
  console.log(`Local:  http://localhost:${PORT}`);

  if (ips.length > 0) {
    console.log('Red (usa esta URL desde otra PC en la misma red):');
    for (const ip of ips) {
      console.log(`  → http://${ip}:${PORT}`);
    }
  } else {
    console.log('No se detectó IP de red local (Wi‑Fi/Ethernet).');
  }

  console.log(`Escuchando en ${HOST}:${PORT}`);
  console.log('');
});

process.on('SIGINT', async () => {
  await closeBrowser();
  server.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeBrowser();
  server.close();
  process.exit(0);
});

export default app;
