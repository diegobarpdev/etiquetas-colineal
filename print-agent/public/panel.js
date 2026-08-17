const aliveEl = document.getElementById('alive');
const statusKv = document.getElementById('status-kv');
const statusHint = document.getElementById('status-hint');
const devicesHint = document.getElementById('devices-hint');
const devicesBody = document.getElementById('devices-body');
const lastJobEl = document.getElementById('last-job');
const actionMsg = document.getElementById('action-msg');
const testPrinterSel = document.getElementById('test-printer');
const mapAdhesivo = document.getElementById('map-adhesivo');
const mapPapel = document.getElementById('map-papel');
const btnRefresh = document.getElementById('btn-refresh');
const btnRedetect = document.getElementById('btn-redetect');
const btnTest = document.getElementById('btn-test');
const btnSaveMap = document.getElementById('btn-save-map');

function kv(dl, rows) {
  dl.innerHTML = rows
    .map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v ?? '—'))}</dd>`)
    .join('');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showMsg(text, ok) {
  actionMsg.hidden = false;
  actionMsg.textContent = text;
  actionMsg.className = 'msg ' + (ok ? 'msg-ok' : 'msg-err');
}

function usbOnly(devices) {
  return (devices || []).filter((d) => String(d.connection || '').toLowerCase() === 'usb');
}

function fillUsbSelect(sel, devices, selectedUid, fallbackUid) {
  const list = usbOnly(devices);
  sel.innerHTML = list
    .map(
      (d) =>
        `<option value="${escapeHtml(d.uid)}">${escapeHtml(d.uid)}${d.name && d.name !== d.uid ? ' · ' + escapeHtml(d.name) : ''}</option>`,
    )
    .join('');
  if (!list.length) {
    sel.innerHTML = '<option value="">(no hay USB)</option>';
    return;
  }
  const pick = selectedUid || fallbackUid || '';
  if (pick && list.some((d) => d.uid === pick)) {
    sel.value = pick;
  }
}

function fillTestPrinterSelect(devices, preferUid) {
  const usb = usbOnly(devices);
  const drivers = (devices || []).filter((d) => String(d.connection || '').toLowerCase() !== 'usb');
  const list = [...usb, ...drivers];
  testPrinterSel.innerHTML = list
    .map((d) => {
      const tag = String(d.connection || '').toLowerCase() === 'usb' ? 'USB' : 'DRIVER⚠';
      return `<option value="${escapeHtml(d.uid)}">[${tag}] ${escapeHtml(d.uid)}</option>`;
    })
    .join('');
  if (!list.length) {
    testPrinterSel.innerHTML = '<option value="">(ningún device)</option>';
    return;
  }
  if (preferUid && list.some((d) => d.uid === preferUid)) {
    testPrinterSel.value = preferUid;
  } else if (usb.length) {
    testPrinterSel.value = usb[0].uid;
  }
}

async function loadStatus() {
  const res = await fetch('/api/status');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'No se pudo cargar estado');

  const bpOk = Boolean(data.browserPrint?.reachable);
  const devices = data.devices || [];
  const usb = usbOnly(devices);
  const map = data.usbRoleMap || data.browserPrint?.usbRoleMap || {};

  aliveEl.textContent = bpOk
    ? `Online · USB ${usb.length} / total ${devices.length}`
    : 'Online · Browser Print OFF';
  aliveEl.className = 'pill ' + (bpOk ? (usb.length ? 'pill-ok' : 'pill-warn') : 'pill-warn');

  kv(statusKv, [
    ['Motor', data.engine],
    ['USB devices', String(usb.length)],
    ['Driver devices', String(devices.length - usb.length)],
    ['Mapa ADHESIVO', map.ADHESIVO || '(sin configurar)'],
    ['Mapa PAPEL', map.PAPEL || '(sin configurar)'],
    ['Último job conn', data.lastJob?.send?.connection || '—'],
    ['Último job size', data.lastJob ? `${data.lastJob.widthMm}×${data.lastJob.heightMm} mm` : '—'],
    ['DPI', data.dpi],
  ]);

  if (!bpOk) {
    statusHint.textContent = data.browserPrint?.error || 'Browser Print offline.';
  } else if (usb.length < 2) {
    statusHint.textContent =
      'Se necesitan 2 devices USB. Si solo ves «driver», reinicia Browser Print con Designer cerrado.';
  } else if (!map.ADHESIVO || !map.PAPEL) {
    statusHint.textContent =
      'Configura el mapa USB abajo (ADHESIVO / PAPEL → serie 52…). Sin eso el tamaño falla o no imprime.';
  } else if (data.lastJob?.send?.connection === 'driver') {
    statusHint.textContent =
      '⚠ El último job usó DRIVER (ZDesigner). Eso recorta el tamaño. Usa solo USB.';
  } else {
    statusHint.textContent = 'OK: imprimir solo por USB. connection=driver = tamaño malo.';
  }

  devicesHint.textContent = 'Rojo conceptual: no uses filas «driver» para imprimir.';
  devicesBody.innerHTML = devices.length
    ? devices
        .map((d) => {
          const conn = String(d.connection || '');
          const bad = conn.toLowerCase() !== 'usb';
          return `<tr><td>${escapeHtml(d.role || '—')}</td><td>${escapeHtml(d.name)}</td><td>${escapeHtml(d.uid)}</td><td>${bad ? '<span class="tag tag-muted">driver⚠</span>' : '<span class="tag">usb</span>'}</td></tr>`;
        })
        .join('')
    : '<tr><td colspan="4">Ninguno</td></tr>';

  const otherUsb = (exceptUid) => (usb.find((d) => d.uid !== exceptUid) || {}).uid || '';
  fillUsbSelect(mapAdhesivo, devices, map.ADHESIVO, usb[0]?.uid || '');
  fillUsbSelect(
    mapPapel,
    devices,
    map.PAPEL,
    otherUsb(map.ADHESIVO || usb[0]?.uid) || usb[1]?.uid || '',
  );
  fillTestPrinterSelect(devices, map.ADHESIVO || (usb[0] && usb[0].uid));

  lastJobEl.textContent = data.lastJob
    ? JSON.stringify(data.lastJob, null, 2)
    : 'Sin trabajos aún';
}

async function saveMap() {
  actionMsg.hidden = true;
  btnSaveMap.disabled = true;
  try {
    const res = await fetch('/api/usb-map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ADHESIVO: mapAdhesivo.value || '',
        PAPEL: mapPapel.value || '',
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo guardar');
    showMsg(
      `Mapa OK · ADHESIVO=${data.usbRoleMap?.ADHESIVO || '—'} · PAPEL=${data.usbRoleMap?.PAPEL || '—'}`,
      true,
    );
    await loadStatus();
  } catch (e) {
    showMsg(e.message || String(e), false);
  } finally {
    btnSaveMap.disabled = false;
  }
}

async function redetect() {
  actionMsg.hidden = true;
  btnRedetect.disabled = true;
  try {
    const res = await fetch('/api/refresh', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al re-detectar');
    const usb = usbOnly(data.devices || []);
    showMsg(
      data.ok
        ? `Browser Print OK · USB: ${usb.map((d) => d.uid).join(', ') || 'ninguno'}`
        : data.browserPrint?.error || 'Offline',
      Boolean(data.ok && usb.length),
    );
    await loadStatus();
  } catch (e) {
    showMsg(e.message || String(e), false);
  } finally {
    btnRedetect.disabled = false;
  }
}

async function testPrint() {
  actionMsg.hidden = true;
  btnTest.disabled = true;
  try {
    const printerName = testPrinterSel.value || '';
    const res = await fetch('/api/test-print', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ widthMm: 100, heightMm: 150, printerName }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Fallo la prueba');
    const conn = data.print?.send?.connection || '';
    showMsg(
      `Prueba OK · uid=${data.print?.uid || printerName} · conn=${conn}${conn === 'driver' ? ' ⚠ DRIVER=tamaño malo' : ''}`,
      conn !== 'driver',
    );
    await loadStatus();
  } catch (e) {
    showMsg(e.message || String(e), false);
  } finally {
    btnTest.disabled = false;
  }
}

btnRefresh.addEventListener('click', () => {
  loadStatus().catch((e) => showMsg(e.message, false));
});
btnRedetect.addEventListener('click', redetect);
btnTest.addEventListener('click', testPrint);
btnSaveMap.addEventListener('click', saveMap);

loadStatus().catch((e) => {
  aliveEl.textContent = 'Error';
  aliveEl.className = 'pill pill-off';
  showMsg(e.message || String(e), false);
});

setInterval(() => {
  loadStatus().catch(() => {});
}, 15000);
