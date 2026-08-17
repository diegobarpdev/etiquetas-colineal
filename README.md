# Etiquetas Colineal

Front React + API Express + agente de impresión Zebra.

| Puerto | Proceso | Carpeta |
|--------|---------|---------|
| **3000** | Front (estático + proxy `/api` → API) | `web/` + `server/web.ts` |
| **3010** | API (órdenes Odoo, PDF, impresión, instalador agente) | `server/` |
| **9120** | Print-agent (PC con Zebra USB) | `print-agent/` |

El puerto **3001 ya no se usa**.

## Arranque

```bash
npm install
npm run build
npm start          # API :3010 + front :3000
# o con PM2:
pm2 start ecosystem.config.cjs
pm2 save
```

Desarrollo:

```bash
npm run dev        # Vite :3000 + API :3010
```

## Estructura

```
web/           UI React (Vite)
server/        API + servidor estático de producción
print-agent/   Instalador / agente USB
data/          printers-config.json, print-agent-dist/
assets/        Logos
```

Instalador del agente: `http://<servidor>:3000/api/print-agent/installer.exe` (proxy → `:3010`).
