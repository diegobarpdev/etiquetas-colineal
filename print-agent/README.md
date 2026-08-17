# Print agent — Zebra Browser Print

Carpeta del **instalador / agente USB** en el repo (`print-agent/`, raíz del proyecto).

Corre en la **PC donde están las Zebra por USB**.

```
Servidor etiquetas :3000  →  http://IP_PC:9120  →  Browser Print :9100  →  USB
```

## Instalación (cualquier PC)

1. Instala **Zebra Browser Print**.
2. Descarga y ejecuta (Admin):  
   `http://192.168.2.28:3000/api/print-agent/installer.exe`
3. Anota la IP y agrégala en el servidor.

Alternativa: copiar esta carpeta + `install.bat`. Detalle: [INSTALACION-NUEVA-PC.md](./INSTALACION-NUEVA-PC.md)

Generar/actualizar el EXE en el servidor: `npm run publish:print-agent` (también publica `package.zip`).

## Operación

| Acción | Comando |
|--------|---------|
| Reiniciar | `REINICIAR-AGENTE.bat` (debe mostrar `pm2 status` + health OK) |
| Actualizar desde servidor | **Automático** cada 15 min / al boot. Manual: `ACTUALIZAR-AGENTE.bat` |
| Estado | `pm2 status` |
| Logs | `pm2 logs etiquetas-print-agent` · `logs\auto-update.log` |
| Diagnóstico | `diagnostico.ps1` |

El proceso corre con PM2 (`windowsHide`: sin ventana de `node.exe`).

### Publicar actualización (servidor)

```bash
npm run publish:print-agent
# primera vez con rutas nuevas:
npm run build && pm2 restart etiquetas-colineal
```

Las PCs con `AUTO_UPDATE=1` y tarea `EtiquetasPrintAgentUpdate` se actualizan solas.

## Puertos

| Puerto | Quién |
|--------|--------|
| 9120 | Este agente |
| 9100 / 9101 | Solo Browser Print |

## Panel

- Local: http://127.0.0.1:9120/
- Health: http://127.0.0.1:9120/health
