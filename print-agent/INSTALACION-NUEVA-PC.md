# Instalación — PC con impresora Zebra (print-agent)

Guía para **cualquier PC** con Zebra USB. Sin rutas ni usuarios fijos.

```
App etiquetas :3000  →  print-agent :9120  →  Browser Print :9100  →  Zebra USB
```

---

## Instalación recomendada (EXE)

En la PC USB (con red hacia `192.168.2.28`):

1. Instala **Zebra Browser Print** y deja la Zebra USB lista ([descarga](https://www.zebra.com/us/en/support-downloads/software/printer-software/browser-print.html)).
2. Descarga el instalador:
   - [http://192.168.2.28:3000/api/print-agent/installer.exe](http://192.168.2.28:3000/api/print-agent/installer.exe)
3. Doble clic → acepta UAC (Administrador).
4. Instala en `C:\Etiquetas\print-agent`, baja el paquete del servidor, ejecuta `install.ps1` (Node, firewall, PM2, auto-update).

Opciones:

```text
Instalar-Agente-Etiquetas.exe /SERVER=http://192.168.2.28:3000 /DIR=C:\Etiquetas\print-agent
Instalar-Agente-Etiquetas.exe /S
```

Al final anota la **IP LAN** que muestra `install.ps1` para el servidor.

---

## Alternativa: copiar carpeta

Copia **solo** `print-agent/` (sin `.env` de otra PC) y ejecuta `install.bat` como Administrador.

| No copies | Por qué |
|-----------|---------|
| `.env` | UID USB / impresora de otra máquina |
| `logs\` | Basura local |
| `node_modules\` | `install.bat` hace `npm install` |

---

## Requisitos en la PC

1. Windows 10/11 + **Administrador**
2. Zebra USB instalada (ZDesigner visible)
3. **Zebra Browser Print** instalado y en bandeja (el EXE **no** lo incluye)
4. Red LAN hacia el servidor de la app

---

## Verificar

```powershell
cd <tu-carpeta-print-agent>
powershell -NoProfile -ExecutionPolicy Bypass -File .\diagnostico.ps1
```

O abre: `http://127.0.0.1:9120/health`

---

## En el servidor de etiquetas

En **Configuración → Impresoras** agrega el agente:

`http://IP_DE_LA_PC_IMPRESORA:9120`

Marca Visible + tipos de etiqueta. Guarda.

---

## Operación diaria

| Acción | Cómo |
|--------|------|
| Reiniciar | Doble clic `REINICIAR-AGENTE.bat` (o acceso en Escritorio) |
| **Actualizar código** | **Automático**: cada ~15 min y al iniciar sesión (tarea `EtiquetasPrintAgentUpdate` + `boot-agent`). En el servidor solo: `npm run publish:print-agent`. Manual opcional: `ACTUALIZAR-AGENTE.bat`. Desactivar: `AUTO_UPDATE=0` en `.env`. |
| Estado | `pm2 status` |
| Logs | `pm2 logs etiquetas-print-agent` · update: `logs\auto-update.log` |
| Arranque al boot | Tareas `EtiquetasPrintAgentLogon` + `Watch` + `Update`. Verificar: `powershell -File .\verificar-arranque.ps1` |

**No** ejecutes `node index.js` a mano: abre ventana y pelea con PM2.

### Publicar una nueva versión (en el servidor 2.28)

1. Cambia el código en `print-agent/` del repo.
2. En el servidor: `npm run publish:print-agent`
3. Si acabas de agregar rutas API nuevas: `npm run build` + `pm2 restart etiquetas-colineal`
4. **Las PCs se actualizan solas** (máx. ~15 min, o al próximo login). No hace falta ir a cada máquina.

Comprueba: `http://192.168.2.28:3000/api/print-agent/version`  
Instalador EXE: `http://192.168.2.28:3000/api/print-agent/installer.exe`

**Primera vez en una PC vieja:** una vez `ACTUALIZAR-AGENTE.bat` o `install.bat` (para crear la tarea Update). Después ya no hace falta.

---

## Problemas frecuentes

| Síntoma | Qué hacer |
|---------|-----------|
| Ventana `node.exe` cada minuto | Ya lo evita el instalador. Si queda: `schtasks /Delete /TN EtiquetasPrintAgentWatch /F` y `REINICIAR-AGENTE.bat` |
| PM2 `EPERM ... rpc.sock` | Choque Admin vs usuario. Usa PM2_HOME local (`.pm2` en la carpeta). Reinicia **sin** “como administrador”. |
| Install falla Node msiexec 1603 | El instalador ahora cae a **Node portable** en `runtime\node` (sin MSI). Copia `install.ps1` nuevo y vuelve a correr `install.bat` como Admin (necesita internet la primera vez). |
| Dice usuario soportectin | Solo es quien ejecutó el instalador. Las tareas quedan para **cualquier usuario** al iniciar sesión (grupo Users). |
| No imprime / BP unreachable | Abre Browser Print en bandeja; puertos 9100/9101 libres |
| Tamaño raro | En panel `:9120` usa devices `connection=usb` (no driver ZDesigner) |
| `.env` de otra PC | Bórralo y vuelve a correr `install.bat` |

---

## Checklist multi-PC

- [ ] Carpeta copiada **sin** `.env` ajeno
- [ ] Browser Print instalado y en bandeja
- [ ] `install.bat` como Admin
- [ ] `/health` OK
- [ ] Agente agregado en el servidor con la IP de **esa** PC
- [ ] Prueba de 1 etiqueta y luego varias (lote sin pausas)
