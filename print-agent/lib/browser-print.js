'use strict';

/**
 * Cliente HTTP para Zebra Browser Print (servicio local en bandeja).
 * IMPORTANTE: enviar SOLO a devices connection=usb.
 * connection=driver pasa por ZDesigner y fuerza tamaño «producto conforme».
 */

const fs = require('fs');
const path = require('path');
const { config } = require('./config');

const BP_BASE = (config.browserPrintUrl || 'http://127.0.0.1:9100').replace(/\/$/, '');
const USB_MAP_PATH = path.join(config.root, 'usb-role-map.json');

function networkErrorDetail(error) {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause && typeof error.cause === 'object' ? error.cause : null;
  const code = cause && 'code' in cause ? String(cause.code) : '';
  const msg = cause && 'message' in cause ? String(cause.message) : error.message;
  return [code, msg].filter(Boolean).join(' ').trim() || error.message;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function bpFetch(pathname, options = {}) {
  const url = `${BP_BASE}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
  const timeoutMs = options.timeoutMs || 12_000;
  const retries = Math.max(0, Number(options.retries ?? 2));
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = {
        Connection: 'close',
        ...(options.headers || {}),
      };
      const res = await fetch(url, {
        method: options.method || 'GET',
        headers,
        body: options.body,
        signal: controller.signal,
      });
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { raw: text };
      }
      if (!res.ok) {
        const err = new Error(
          `Browser Print HTTP ${res.status}: ${typeof json?.error === 'string' ? json.error : text.slice(0, 200)}`,
        );
        err.status = res.status;
        err.payload = json;
        throw err;
      }
      return json;
    } catch (error) {
      lastError = error;
      const retryable =
        (error instanceof Error && error.name === 'AbortError') ||
        error instanceof TypeError ||
        (error && typeof error === 'object' && Number(error.status) >= 500);
      if (!retryable || attempt >= retries) break;
      console.warn(
        `[bp] reintento ${attempt + 1}/${retries} ${pathname}: ${networkErrorDetail(error)}`,
      );
      await sleep(400 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }

  const error = lastError;
  if (error instanceof Error && error.name === 'AbortError') {
    throw new Error(
      `Browser Print no responde en ${BP_BASE}. ¿Está instalado y el icono Zebra en la bandeja? (${networkErrorDetail(error)})`,
    );
  }
  if (error instanceof TypeError) {
    throw new Error(
      `No se pudo contactar Browser Print en ${BP_BASE}. Instálalo y libéralo en puertos 9100/9101. (${networkErrorDetail(error)})`,
    );
  }
  throw error;
}

function normalizeDeviceList(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.printer)) return payload.printer;
  if (Array.isArray(payload.deviceList)) return payload.deviceList;
  if (typeof payload === 'object') {
    const vals = Object.values(payload).filter(
      (v) => v && typeof v === 'object' && (v.uid || v.name),
    );
    if (vals.length) return vals;
  }
  return [];
}

function deviceRole(device) {
  const n = String(device?.name || device?.uid || '').toUpperCase();
  if (/PAPEL/.test(n)) return 'PAPEL';
  if (/ADHESIVO|TELA/.test(n)) return 'ADHESIVO';
  if (/ZDESIGNER|ZT230|ZEBRA|ZTC/.test(n)) return 'ADHESIVO';
  return '';
}

function roleFromHint(name) {
  const n = String(name || '').toUpperCase();
  if (/PAPEL/.test(n)) return 'PAPEL';
  if (/ADHESIVO|TELA/.test(n)) return 'ADHESIVO';
  if (/ZDESIGNER|ZT230|ZEBRA|ZTC/.test(n)) return 'ADHESIVO';
  return '';
}

function isUsbDevice(device) {
  return String(device?.connection || '').toLowerCase() === 'usb';
}

function loadUsbRoleMap() {
  const fromEnv = {
    ADHESIVO: config.bpUsbAdhesivo || '',
    PAPEL: config.bpUsbPapel || '',
  };
  try {
    if (fs.existsSync(USB_MAP_PATH)) {
      const file = JSON.parse(fs.readFileSync(USB_MAP_PATH, 'utf8'));
      if (file && typeof file === 'object') {
        if (!fromEnv.ADHESIVO && file.ADHESIVO) fromEnv.ADHESIVO = String(file.ADHESIVO);
        if (!fromEnv.PAPEL && file.PAPEL) fromEnv.PAPEL = String(file.PAPEL);
      }
    }
  } catch {
    /* ignore */
  }
  return fromEnv;
}

function saveUsbRoleMap(partial) {
  const cur = loadUsbRoleMap();
  const next = {
    ADHESIVO: partial.ADHESIVO || cur.ADHESIVO || '',
    PAPEL: partial.PAPEL || cur.PAPEL || '',
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(USB_MAP_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

async function listDevices() {
  const payload = await bpFetch('/available');
  return normalizeDeviceList(payload).map((d) => ({
    name: String(d.name || ''),
    uid: String(d.uid || d.name || ''),
    connection: String(d.connection || ''),
    deviceType: String(d.deviceType || 'printer'),
    provider: d.provider,
    manufacturer: d.manufacturer,
    version: d.version,
    role: deviceRole(d),
    raw: d,
  }));
}

async function getDefaultDevice() {
  try {
    const payload = await bpFetch('/default?type=printer');
    if (payload && (payload.uid || payload.name)) {
      return {
        name: String(payload.name || ''),
        uid: String(payload.uid || payload.name || ''),
        connection: String(payload.connection || ''),
        role: deviceRole(payload),
        raw: payload,
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function findByUid(devices, uid) {
  const u = String(uid || '').trim();
  if (!u) return null;
  return devices.find((d) => d.uid === u || d.name === u) || null;
}

/**
 * Elige el device USB correcto. Nunca usa connection=driver si hay USB:
 * el driver ZDesigner fuerza el formulario «producto conforme».
 */
async function resolveDevice(preferredName = '') {
  const devices = await listDevices();
  if (!devices.length) {
    throw new Error(
      'Browser Print no ve impresoras. Conecta USB, Settings → Driver Search, reinicia Browser Print.',
    );
  }

  const preferred = String(preferredName || config.printerName || '').trim();
  const role = roleFromHint(preferred);
  const map = loadUsbRoleMap();
  const usbDevices = devices.filter(isUsbDevice);

  // 1) Mapa explícito ADHESIVO/PAPEL → UID USB
  if (role && map[role]) {
    const mapped = findByUid(devices, map[role]);
    if (mapped) {
      if (!isUsbDevice(mapped) && usbDevices.length) {
        console.warn(
          `[bp] mapa ${role}=${map[role]} no es USB; preferimos USB para no usar ZDesigner`,
        );
      } else {
        return { ...mapped, role: role || mapped.role };
      }
    }
  }

  // 2) preferredName es ya un UID USB
  const preferredHit = findByUid(devices, preferred);
  if (preferredHit && isUsbDevice(preferredHit)) {
    return { ...preferredHit, role: role || preferredHit.role };
  }

  // 3) Solo USB
  if (usbDevices.length === 1) {
    return { ...usbDevices[0], role: role || usbDevices[0].role || 'ADHESIVO' };
  }

  if (usbDevices.length >= 2) {
    const ids = usbDevices.map((d) => d.uid).join(', ');
    throw new Error(
      `Hay ${usbDevices.length} Zebra USB (${ids}). ` +
        `Configura en .env BP_USB_ADHESIVO y BP_USB_PAPEL con esos UID, ` +
        `o en el panel → mapear roles. (No usar ZDesigner/driver: recorta el tamaño.)`,
    );
  }

  // 4) Sin USB: último recurso driver (romperá tamaño en jobs grandes)
  console.warn('[bp] AVISO: no hay device USB; se usará connection=driver (riesgo tamaño conforme)');
  if (preferredHit) return preferredHit;
  const byRole = role ? devices.find((d) => d.role === role) : null;
  if (byRole) return byRole;
  const def = await getDefaultDevice();
  if (def) return devices.find((d) => d.uid === def.uid) || def;
  return devices[0];
}

async function writeZpl(device, zpl) {
  if (!device?.uid && !device?.name) {
    throw new Error('Device Browser Print inválido (sin uid/name)');
  }
  if (!isUsbDevice(device)) {
    console.warn(
      `[bp] WARNING print via connection=${device.connection} uid=${device.uid} — puede forzar tamaño conforme`,
    );
  } else {
    console.log(`[bp] print USB uid=${device.uid} name=${device.name}`);
  }

  const deviceBody =
    device.raw && typeof device.raw === 'object'
      ? {
          name: device.raw.name || device.name,
          uid: device.raw.uid || device.uid,
          connection: isUsbDevice(device) ? 'usb' : device.raw.connection || device.connection,
          deviceType: device.raw.deviceType || 'printer',
          version: device.raw.version ?? 2,
          provider:
            device.raw.provider ||
            'com.zebra.ds.webdriver.desktop.provider.DefaultDeviceProvider',
          manufacturer: device.raw.manufacturer || 'Zebra Technologies',
        }
      : {
          name: device.name,
          uid: device.uid,
          connection: device.connection || 'usb',
          deviceType: 'printer',
          version: 2,
          provider: 'com.zebra.ds.webdriver.desktop.provider.DefaultDeviceProvider',
          manufacturer: 'Zebra Technologies',
        };

  await bpFetch('/write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device: deviceBody, data: zpl }),
    // Lotes ZPL grandes: hasta ~3 min por chunk
    timeoutMs: Math.max(60_000, Math.min(180_000, 40_000 + String(zpl || '').length / 40)),
  });

  return {
    ok: true,
    method: 'browser-print',
    device: device.name,
    uid: device.uid,
    role: device.role || deviceRole(device),
    connection: deviceBody.connection,
  };
}

async function sendZplString(zpl, preferredPrinterName = '') {
  const device = await resolveDevice(preferredPrinterName);
  return writeZpl(device, zpl);
}

async function getBrowserPrintHealth() {
  try {
    const devices = await listDevices();
    const def = await getDefaultDevice();
    const map = loadUsbRoleMap();
    return {
      ok: true,
      reachable: true,
      url: BP_BASE,
      deviceCount: devices.length,
      devices,
      defaultDevice: def,
      usbRoleMap: map,
      usbCount: devices.filter(isUsbDevice).length,
      driverCount: devices.filter((d) => !isUsbDevice(d)).length,
    };
  } catch (error) {
    return {
      ok: false,
      reachable: false,
      url: BP_BASE,
      deviceCount: 0,
      devices: [],
      usbRoleMap: loadUsbRoleMap(),
      usbCount: 0,
      driverCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

module.exports = {
  listDevices,
  getDefaultDevice,
  resolveDevice,
  writeZpl,
  sendZplString,
  getBrowserPrintHealth,
  roleFromHint,
  deviceRole,
  loadUsbRoleMap,
  saveUsbRoleMap,
  isUsbDevice,
};
