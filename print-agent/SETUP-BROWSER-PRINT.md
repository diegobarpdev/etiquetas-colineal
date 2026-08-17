# Zebra Browser Print — checklist rápido

1. Instala Browser Print (sitio Zebra) y déjalo en la bandeja.
2. Confirma `http://127.0.0.1:9100/available`.
3. En esta carpeta: `install.bat` como Admin (crea `.env` y PM2 en segundo plano).
4. Verifica `http://127.0.0.1:9120/health` → `browserPrint.reachable: true`.
5. En el servidor de etiquetas agrega: `http://IP_DE_ESTA_PC:9120`.

## Notas

- Usa devices USB (`connection=usb`), no colas ZDesigner/driver.
- No ejecutes `node index.js` a mano.
- Reinicio: `REINICIAR-AGENTE.bat` (mismo usuario que instaló).
- Si falla PM2 con `EPERM ... rpc.sock`, estás con otro usuario: reinstala/reinicia con el correcto.
