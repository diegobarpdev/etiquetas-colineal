#Requires -Version 5.1
<#
  Watchdog DESACTIVADO.

  No debe ejecutarse ninguna tarea que abra node.exe.
  El agente corre solo con PM2 (ecosystem.config.cjs -> windowsHide: true).

  install.ps1 deja este archivo en exit 0 y elimina tareas legacy.
#>
exit 0
