import { createReadStream, existsSync, readFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Router, Request, Response } from 'express';

const router = Router();
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

function resolveDistDir(): string {
  const candidates = [
    join(process.cwd(), 'data', 'print-agent-dist'),
    join(repoRoot, 'data', 'print-agent-dist'),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'version.json'))) return dir;
  }
  return candidates[0];
}

function resolveAgentScript(name: string): string | null {
  const candidates = [
    join(process.cwd(), 'print-agent', name),
    join(repoRoot, 'print-agent', name),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

router.get('/print-agent/bootstrap.ps1', (_req: Request, res: Response) => {
  const scriptPath = resolveAgentScript('bootstrap-from-server.ps1');
  if (!scriptPath) {
    res.status(404).type('text/plain').send('# bootstrap no encontrado en el servidor\n');
    return;
  }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  createReadStream(scriptPath).pipe(res);
});

router.get('/print-agent/fix-pm2.ps1', (_req: Request, res: Response) => {
  const scriptPath = resolveAgentScript('fix-pm2.ps1');
  if (!scriptPath) {
    res.status(404).type('text/plain').send('# fix-pm2 no encontrado. Corre npm run publish:print-agent\n');
    return;
  }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  createReadStream(scriptPath).pipe(res);
});

router.get('/print-agent/installer.exe', (_req: Request, res: Response) => {
  const dist = resolveDistDir();
  const exePath = join(dist, 'Instalar-Agente-Etiquetas.exe');
  if (!existsSync(exePath)) {
    res.status(404).type('text/plain').send(
      'No hay instalador EXE. En el servidor: npm run publish:print-agent\n',
    );
    return;
  }
  try {
    const stat = statSync(exePath);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="Instalar-Agente-Etiquetas.exe"',
    );
    res.setHeader('Cache-Control', 'no-store');
    createReadStream(exePath).pipe(res);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!res.headersSent) {
      res.status(500).json({ error: message });
    }
  }
});

router.get('/print-agent/version', (_req: Request, res: Response) => {
  const dist = resolveDistDir();
  const versionPath = join(dist, 'version.json');
  if (!existsSync(versionPath)) {
    res.status(404).json({
      error:
        'No hay paquete publicado. En el servidor: npm run publish:print-agent',
    });
    return;
  }
  try {
    const raw = readFileSync(versionPath, 'utf8').replace(/^\uFEFF/, '');
    res.type('json').send(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

router.get('/print-agent/package.zip', (req: Request, res: Response) => {
  const dist = resolveDistDir();
  const zipPath = join(dist, 'package.zip');
  const versionPath = join(dist, 'version.json');
  if (!existsSync(zipPath)) {
    res.status(404).json({
      error:
        'No hay package.zip. En el servidor: npm run publish:print-agent',
    });
    return;
  }

  try {
    const stat = statSync(zipPath);
    let expectedSha = '';
    if (existsSync(versionPath)) {
      const meta = JSON.parse(
        readFileSync(versionPath, 'utf8').replace(/^\uFEFF/, ''),
      ) as {
        sha256?: string;
      };
      expectedSha = String(meta.sha256 || '').toLowerCase();
    }

    const want =
      typeof req.query.sha256 === 'string' ? req.query.sha256.toLowerCase() : '';
    if (want && expectedSha && want !== expectedSha) {
      res.status(409).json({
        error: 'SHA256 no coincide con la versión publicada',
        expected: expectedSha,
      });
      return;
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="print-agent-package.zip"',
    );
    if (expectedSha) {
      res.setHeader('X-Package-Sha256', expectedSha);
    }
    createReadStream(zipPath).pipe(res);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!res.headersSent) {
      res.status(500).json({ error: message });
    }
  }
});

export default router;
