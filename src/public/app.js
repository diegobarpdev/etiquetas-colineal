let selectedOrderId = null;
let totalLabelCount = 0;
let totalLabelCountAll = 0;
let currentLabelIndex = 0;
let lastOrderData = null;
let allOrders = [];
let templateCatalog = new Map();
let previewDebounceTimer = null;
let selectionGroups = [];
let selectedGroupIds = new Set();

const orderFilter = document.getElementById('order-filter');
const orderSelect = document.getElementById('order-select');
const orderSection = document.getElementById('order-section');
const orderName = document.getElementById('order-name');
const orderMeta = document.getElementById('order-meta');
const totalLabels = document.getElementById('total-labels');
const summaryBody = document.getElementById('summary-body');
const templateSelect = document.getElementById('template-select');
const templateHint = document.getElementById('template-hint');
const htmlPreview = document.getElementById('html-preview');
const htmlPreviewLoading = document.getElementById('html-preview-loading');
const htmlPreviewControls = document.getElementById('html-preview-controls');
const prevLabelBtn = document.getElementById('prev-label-btn');
const nextLabelBtn = document.getElementById('next-label-btn');
const labelIndexText = document.getElementById('label-index-text');
const viewAllLabels = document.getElementById('view-all-labels');
const generatePdfBtn = document.getElementById('generate-pdf-btn');
const downloadPdfBtn = document.getElementById('download-pdf-btn');
const printLabelsBtn = document.getElementById('print-labels-btn');
const statusBanner = document.getElementById('status-banner');
const errorEl = document.getElementById('error');
const previewPanel = document.getElementById('preview-panel');
const pdfPreview = document.getElementById('pdf-preview');
const previewPlaceholder = document.getElementById('preview-placeholder');
const tabHtml = document.getElementById('tab-html');
const tabPdf = document.getElementById('tab-pdf');

const printerSettings = document.getElementById('printer-settings');
const printerCopies = document.getElementById('printer-copies');
const systemPrinterName = document.getElementById('system-printer-name');
const systemPrinterRow = document.getElementById('system-printer-row');
const zebraPrinterRow = document.getElementById('zebra-printer-row');
const zebraPrinterSelect = document.getElementById('zebra-printer-select');
const refreshPrintersBtn = document.getElementById('refresh-printers-btn');
const zebraStatus = document.getElementById('zebra-status');
const printerSaveStatus = document.getElementById('printer-save-status');
const togglePrinterSettings = document.getElementById('toggle-printer-settings');
const networkUrlBanner = document.getElementById('network-url-banner');

const printerMode = document.getElementById('printer-mode');

const selectionDetails = document.getElementById('selection-details');
const selectionGroupsEl = document.getElementById('selection-groups');
const selectionSummaryHint = document.getElementById('selection-summary-hint');
const selectAllGroupsBtn = document.getElementById('select-all-groups-btn');
const clearAllGroupsBtn = document.getElementById('clear-all-groups-btn');
const rangeFromInput = document.getElementById('range-from');
const rangeToInput = document.getElementById('range-to');

function showError(message) {
  errorEl.textContent = message;
  errorEl.classList.remove('hidden');
}

function hideError() {
  errorEl.classList.add('hidden');
}

function showStatus(message) {
  statusBanner.textContent = message;
  statusBanner.classList.remove('hidden');
}

function hideStatus() {
  statusBanner.classList.add('hidden');
  statusBanner.textContent = '';
}

function switchPreviewTab(tab) {
  const isHtml = tab === 'html';
  tabHtml.classList.toggle('active', isHtml);
  tabPdf.classList.toggle('active', !isHtml);
  tabHtml.setAttribute('aria-selected', String(isHtml));
  tabPdf.setAttribute('aria-selected', String(!isHtml));
  htmlPreview.classList.toggle('hidden', !isHtml);
  pdfPreview.classList.toggle('hidden', isHtml);
  htmlPreviewControls.classList.toggle('hidden', !isHtml);
  previewPlaceholder.classList.add('hidden');
}

function getSelectedTemplateCode() {
  const value = templateSelect.value.trim();
  return value || null;
}

function isAllGroupsSelected() {
  if (!selectionGroups.length) return true;
  return selectionGroups.every((group) => selectedGroupIds.has(group.id));
}

function appendSelectionParams(params) {
  if (!isAllGroupsSelected() && selectedGroupIds.size > 0) {
    params.set('groups', Array.from(selectedGroupIds).join(','));
  }

  const fromVal = rangeFromInput.value.trim();
  const toVal = rangeToInput.value.trim();
  if (fromVal) params.set('from', fromVal);
  if (toVal) params.set('to', toVal);
}

function buildApiQueryParams() {
  const params = new URLSearchParams();
  const template = getSelectedTemplateCode();
  if (template) params.set('template', template);
  appendSelectionParams(params);
  return params;
}

function resetSelection(groups) {
  selectionGroups = groups || [];
  selectedGroupIds = new Set(selectionGroups.map((group) => group.id));
  rangeFromInput.value = '';
  rangeToInput.value = '';
  renderSelectionGroups();
  updateSelectionSummaryHint();
}

function renderSelectionGroups() {
  selectionGroupsEl.innerHTML = '';

  if (!selectionGroups.length) {
    selectionDetails.classList.add('hidden');
    return;
  }

  selectionDetails.classList.remove('hidden');

  selectionGroups.forEach((group) => {
    const label = document.createElement('label');
    label.className = `selection-group-item${group.parentId ? ' is-child' : ''}`;
    label.dataset.groupId = group.id;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedGroupIds.has(group.id);
    checkbox.dataset.groupId = group.id;

    const text = document.createElement('span');
    text.textContent = group.label;

    const meta = document.createElement('span');
    meta.className = 'selection-group-meta';
    meta.textContent = `${group.labelCount} etiq.`;

    label.appendChild(checkbox);
    label.appendChild(text);
    label.appendChild(meta);
    selectionGroupsEl.appendChild(label);
  });
}

function updateSelectionSummaryHint() {
  if (!selectionGroups.length) {
    selectionSummaryHint.textContent = '';
    return;
  }

  const selectedCount = selectedGroupIds.size;
  const parts = [`${selectedCount}/${selectionGroups.length} grupos`];

  const fromVal = rangeFromInput.value.trim();
  const toVal = rangeToInput.value.trim();
  if (fromVal || toVal) {
    parts.push(`rango ${fromVal || '1'}–${toVal || '…'}`);
  }

  selectionSummaryHint.textContent = parts.join(' · ');
}

function updateLabelCountDisplay(preview) {
  const selected = preview.totalLabels;
  const total = preview.totalLabelsAll ?? selected;
  totalLabelCount = selected;
  totalLabelCountAll = total;

  if (selected === total) {
    totalLabels.textContent = String(selected);
    totalLabels.title = 'Total de etiquetas';
  } else {
    totalLabels.textContent = `${selected}/${total}`;
    totalLabels.title = `${selected} seleccionadas de ${total}`;
  }
}

function handleGroupCheckboxChange(groupId, checked) {
  const group = selectionGroups.find((entry) => entry.id === groupId);
  if (!group) return;

  if (checked) {
    selectedGroupIds.add(groupId);
    if (group.isKitParent) {
      selectionGroups
        .filter((entry) => entry.parentId === groupId)
        .forEach((child) => selectedGroupIds.add(child.id));
    }
  } else {
    selectedGroupIds.delete(groupId);
    if (group.isKitParent) {
      selectionGroups
        .filter((entry) => entry.parentId === groupId)
        .forEach((child) => selectedGroupIds.delete(child.id));
    } else if (group.parentId) {
      selectedGroupIds.delete(group.parentId);
    }
  }

  renderSelectionGroups();
  scheduleSelectionRefresh();
}

function handleSelectAllGroups() {
  selectedGroupIds = new Set(selectionGroups.map((group) => group.id));
  renderSelectionGroups();
  scheduleSelectionRefresh();
}

function handleClearAllGroups() {
  selectedGroupIds.clear();
  renderSelectionGroups();
  scheduleSelectionRefresh();
}

async function refreshOrderPreview() {
  if (!selectedOrderId) return;

  const params = buildApiQueryParams();
  const qs = params.toString();
  const res = await fetch(`/api/orders/${selectedOrderId}${qs ? `?${qs}` : ''}`);
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error || 'Error al actualizar la selección');
  }

  const data = await res.json();
  lastOrderData = data;
  updateLabelCountDisplay(data.preview);
  updateSelectionSummaryHint();

  if (currentLabelIndex >= totalLabelCount) {
    currentLabelIndex = Math.max(0, totalLabelCount - 1);
  }

  updateLabelNavigation();

  if (totalLabelCount > 0) {
    previewPanel.classList.remove('hidden');
    refreshHtmlPreview();
  } else {
    previewPanel.classList.add('hidden');
    htmlPreview.src = '';
    showError('No hay etiquetas que coincidan con la selección');
  }
}

function scheduleSelectionRefresh() {
  clearTimeout(previewDebounceTimer);
  previewDebounceTimer = setTimeout(() => {
    refreshOrderPreview().catch((err) => showError(err.message));
  }, 300);
}

function getEffectiveTemplateLabel(code, fallbackName) {
  if (!code) return fallbackName;
  return templateCatalog.get(code) || code;
}

function updateTemplateHint() {
  const code = getSelectedTemplateCode();
  if (!code) return;
  const name = getEffectiveTemplateLabel(code, code);
  templateHint.textContent = `${name}`;
}

function formatOrderOption(order) {
  return `${order.name} — Lote: ${order.lotNumber} (${order.state})`;
}

function filterOrders(orders, query) {
  const q = query.trim().toLowerCase();
  if (!q) return orders;
  return orders.filter(
    (order) =>
      order.name.toLowerCase().includes(q) ||
      order.lotNumber.toLowerCase().includes(q),
  );
}

function renderOrderSelect(orders, preferredId = null) {
  const previous = preferredId ?? (orderSelect.value ? Number(orderSelect.value) : null);

  orderSelect.innerHTML = '<option value="">Selecciona una orden…</option>';

  orders.forEach((order) => {
    const option = document.createElement('option');
    option.value = String(order.id);
    option.textContent = formatOrderOption(order);
    orderSelect.appendChild(option);
  });

  if (previous && orders.some((order) => order.id === previous)) {
    orderSelect.value = String(previous);
  }
}

async function loadTemplates() {
  const res = await fetch('/api/templates');
  if (!res.ok) throw new Error('Error al cargar plantillas');
  const templates = await res.json();

  templateCatalog = new Map(
    templates.map((template) => [template.code, template.name]),
  );

  const active = templates.filter((t) => t.isActive);
  const defaultCode = 'bulto-estandar';

  templateSelect.innerHTML = '';

  active
    .sort((a, b) => {
      if (a.code === defaultCode) return -1;
      if (b.code === defaultCode) return 1;
      return a.name.localeCompare(b.name, 'es');
    })
    .forEach((template) => {
      const option = document.createElement('option');
      option.value = template.code;
      option.textContent = `${template.name} (${template.code})`;
      templateSelect.appendChild(option);
    });

  if (active.some((t) => t.code === defaultCode)) {
    templateSelect.value = defaultCode;
  }

  updateTemplateHint();
}

async function loadOrders() {
  hideError();
  const res = await fetch('/api/orders');
  if (!res.ok) throw new Error('Error al cargar órdenes');
  allOrders = await res.json();
  renderOrderSelect(filterOrders(allOrders, orderFilter.value));
}

async function loadOrder(id) {
  hideError();
  const params = buildApiQueryParams();
  const qs = params.toString();
  const res = await fetch(`/api/orders/${id}${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error('Error al cargar la orden');
  return res.json();
}

function renderSummaryRow(item, isChild = false) {
  const tr = document.createElement('tr');
  if (isChild) tr.classList.add('child-row');
  if (item.isKit && !isChild) tr.classList.add('parent-row');

  const refCell = isChild
    ? `↳ ${item.internalRef}`
    : item.isKit
      ? `${item.internalRef} <span class="kit-badge">Kit</span>`
      : item.internalRef;

  tr.innerHTML = `
    <td>${refCell}</td>
    <td>${item.productName}</td>
    <td>${item.bultoDisplay}</td>
    <td>${item.totalLabels}</td>
  `;
  return tr;
}

function renderOrderSummary(preview) {
  summaryBody.innerHTML = '';
  preview.summary.forEach((item) => {
    summaryBody.appendChild(renderSummaryRow(item));

    if (item.children) {
      item.children.forEach((child) => {
        summaryBody.appendChild(renderSummaryRow(child, true));
      });
    }
  });
}

function updateLabelNavigation() {
  const viewAll = viewAllLabels.checked;
  const hasMultiple = totalLabelCount > 1;

  prevLabelBtn.disabled = viewAll || currentLabelIndex <= 0;
  nextLabelBtn.disabled = viewAll || currentLabelIndex >= totalLabelCount - 1;

  if (viewAll) {
    labelIndexText.textContent = `${totalLabelCount} etiquetas`;
  } else {
    labelIndexText.textContent = `${currentLabelIndex + 1} / ${totalLabelCount}`;
  }

  prevLabelBtn.classList.toggle('hidden', viewAll || !hasMultiple);
  nextLabelBtn.classList.toggle('hidden', viewAll || !hasMultiple);
  labelIndexText.classList.toggle('hidden', !hasMultiple);
}

function buildHtmlPreviewUrl() {
  const params = buildApiQueryParams();
  params.set('t', String(Date.now()));
  if (!viewAllLabels.checked && totalLabelCount > 0) {
    params.set('index', String(currentLabelIndex));
  }
  return `/api/orders/${selectedOrderId}/labels/html?${params.toString()}`;
}

function buildPdfUrl(download = false) {
  const params = buildApiQueryParams();
  params.set('t', String(Date.now()));
  if (!viewAllLabels.checked && totalLabelCount > 0) {
    params.set('index', String(currentLabelIndex));
  }
  if (download) params.set('download', '1');
  return `/api/orders/${selectedOrderId}/labels/pdf?${params.toString()}`;
}

function readPrinterSettingsFromUi() {
  const selectedOption = zebraPrinterSelect.selectedOptions[0];
  return {
    mode: printerMode.value,
    printerName:
      printerMode.value === 'zebra'
        ? selectedOption?.dataset.name || ''
        : systemPrinterName.value.trim(),
    printerUid: printerMode.value === 'zebra' ? zebraPrinterSelect.value : '',
    copies: Math.max(1, Number(printerCopies.value) || 1),
  };
}

function applyPrinterSettingsToUi(settings) {
  printerMode.value = settings.mode || 'system';
  printerCopies.value = String(settings.copies || 1);
  systemPrinterName.value = settings.printerName || '';
  updatePrinterModeUi();

  if (settings.printerUid) {
    zebraPrinterSelect.value = settings.printerUid;
  }
}

function showPrinterSaveStatus(message) {
  printerSaveStatus.textContent = message;
  printerSaveStatus.classList.remove('hidden');
  clearTimeout(showPrinterSaveStatus._timer);
  showPrinterSaveStatus._timer = setTimeout(() => {
    printerSaveStatus.classList.add('hidden');
  }, 2000);
}

function persistPrinterSettings() {
  const settings = readPrinterSettingsFromUi();
  PrinterConfig.saveSettings(settings);
  showPrinterSaveStatus('Configuración de impresora guardada.');
}

function updatePrinterModeUi() {
  const isZebra = printerMode.value === 'zebra';
  systemPrinterRow.classList.toggle('hidden', isZebra);
  zebraPrinterRow.classList.toggle('hidden', !isZebra);
}

function renderZebraPrinterOptions(devices, selectedUid = '') {
  zebraPrinterSelect.innerHTML = '';

  if (!devices.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No se encontraron impresoras Zebra';
    zebraPrinterSelect.appendChild(option);
    return;
  }

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Selecciona una impresora…';
  zebraPrinterSelect.appendChild(placeholder);

  devices.forEach((device) => {
    const option = document.createElement('option');
    option.value = device.uid;
    option.dataset.name = device.name;
    option.textContent = device.name;
    zebraPrinterSelect.appendChild(option);
  });

  if (selectedUid) {
    zebraPrinterSelect.value = selectedUid;
  }
}

async function refreshZebraPrinters() {
  hideError();
  zebraStatus.textContent = 'Buscando impresoras Zebra…';
  refreshPrintersBtn.disabled = true;

  try {
    const devices = await PrinterConfig.initZebraBrowserPrint();
    const settings = PrinterConfig.loadSettings();
    renderZebraPrinterOptions(devices, settings.printerUid);
    zebraStatus.textContent =
      devices.length > 0
        ? `${devices.length} impresora(s) encontrada(s).`
        : 'No se encontraron impresoras. Verifica que estén encendidas y conectadas.';
  } catch (err) {
    zebraStatus.textContent = err.message;
    renderZebraPrinterOptions([]);
  } finally {
    refreshPrintersBtn.disabled = false;
  }
}

function initNetworkBanner() {
  fetch('/health')
    .then((res) => res.json())
    .then((data) => {
      const networkUrl = data.networkUrl || data.urls?.find((url) => !url.includes('localhost'));
      if (!networkUrl || networkUrl.includes('localhost')) return;

      networkUrlBanner.innerHTML = `Desde otra PC en la red: <a href="${networkUrl}" target="_blank" rel="noopener">${networkUrl}</a>`;
      networkUrlBanner.classList.remove('hidden');
    })
    .catch(() => {});
}

function initPrinterSettings() {
  const settings = PrinterConfig.loadSettings();
  applyPrinterSettingsToUi(settings);
  printerSettings.classList.add('hidden');
  togglePrinterSettings.setAttribute('aria-expanded', 'false');

  if (settings.mode === 'zebra') {
    refreshZebraPrinters().catch(() => {});
  }
}

function refreshHtmlPreview() {
  if (!selectedOrderId || totalLabelCount === 0) return;

  hideError();
  switchPreviewTab('html');
  previewPanel.classList.remove('hidden');
  htmlPreviewLoading.classList.remove('hidden');
  updateLabelNavigation();

  htmlPreview.onload = () => {
    htmlPreviewLoading.classList.add('hidden');
  };

  htmlPreview.onerror = () => {
    htmlPreviewLoading.classList.add('hidden');
    showError('Error al cargar la vista previa');
  };

  htmlPreview.src = buildHtmlPreviewUrl();
}

function scheduleHtmlPreviewRefresh() {
  clearTimeout(previewDebounceTimer);
  previewDebounceTimer = setTimeout(() => {
    refreshHtmlPreview();
  }, 250);
}

function renderOrder(data) {
  const { order, preview } = data;
  lastOrderData = data;

  orderName.textContent = order.name;
  orderMeta.textContent = [
    `Lote: ${order.lotNumber}`,
    `Fecha: ${order.productionDate.slice(0, 10)}`,
    `Estado: ${order.state}`,
    order.inspectorName ? `Inspector: ${order.inspectorName}` : null,
  ]
    .filter(Boolean)
    .join(' | ');

  resetSelection(preview.groups || []);
  updateLabelCountDisplay(preview);
  currentLabelIndex = 0;

  renderOrderSummary(preview);
  updateTemplateHint();
  updateLabelNavigation();

  orderSection.classList.remove('hidden');
  pdfPreview.src = '';
  switchPreviewTab('html');

  if (totalLabelCount > 0) {
    previewPanel.classList.remove('hidden');
    refreshHtmlPreview();
  } else {
    previewPanel.classList.add('hidden');
    htmlPreview.src = '';
  }
}

async function selectOrder(id) {
  if (!id) {
    selectedOrderId = null;
    orderSection.classList.add('hidden');
    previewPanel.classList.add('hidden');
    htmlPreview.src = '';
    pdfPreview.src = '';
    return;
  }

  selectedOrderId = id;

  try {
    const data = await loadOrder(id);
    renderOrder(data);
  } catch (err) {
    showError(err.message);
  }
}

function handleOrderFilter() {
  renderOrderSelect(filterOrders(allOrders, orderFilter.value), selectedOrderId);
}

function handleOrderSelectChange() {
  const id = orderSelect.value ? Number(orderSelect.value) : null;
  selectOrder(id);
}

function setActionButtonsDisabled(disabled) {
  generatePdfBtn.disabled = disabled;
  downloadPdfBtn.disabled = disabled;
  printLabelsBtn.disabled = disabled;
}

function handleGeneratePdf() {
  if (!selectedOrderId) return;

  hideError();
  showStatus('Generando PDF…');
  setActionButtonsDisabled(true);

  pdfPreview.onload = () => {
    hideStatus();
    setActionButtonsDisabled(false);
    switchPreviewTab('pdf');
  };

  pdfPreview.onerror = () => {
    hideStatus();
    setActionButtonsDisabled(false);
    showError('Error al cargar el PDF');
  };

  pdfPreview.src = buildPdfUrl(false);
}

async function handlePrintLabels() {
  if (!selectedOrderId) return;

  hideError();
  showStatus('Enviando a impresora…');
  setActionButtonsDisabled(true);

  const settings = readPrinterSettingsFromUi();
  PrinterConfig.saveSettings(settings);

  try {
    const res = await fetch(buildPdfUrl(false));
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload.error || 'Error al generar el PDF para imprimir');
    }

    const blob = await res.blob();
    const pdfUrl = URL.createObjectURL(blob);

    try {
      const result = await PrinterConfig.printPdf(pdfUrl, settings);
      if (result.mode === 'system' && settings.printerName) {
        showPrinterSaveStatus(
          `En el diálogo, selecciona: ${settings.printerName}`,
        );
      } else if (result.mode === 'zebra') {
        showPrinterSaveStatus(`Enviado a ${result.device}`);
      } else {
        showPrinterSaveStatus('Impresión enviada.');
      }
    } finally {
      URL.revokeObjectURL(pdfUrl);
    }
  } catch (err) {
    showError(err.message);
  } finally {
    hideStatus();
    setActionButtonsDisabled(false);
  }
}

async function handleDownloadPdf() {
  if (!selectedOrderId) return;

  hideError();
  showStatus('Descargando PDF…');
  setActionButtonsDisabled(true);

  try {
    const res = await fetch(buildPdfUrl(true));
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload.error || 'Error al descargar el PDF');
    }

    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match?.[1] || `etiquetas-orden-${selectedOrderId}.pdf`;

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    showError(err.message);
  } finally {
    hideStatus();
    setActionButtonsDisabled(false);
  }
}

function handlePrinterModeChange() {
  updatePrinterModeUi();
  persistPrinterSettings();
  if (printerMode.value === 'zebra') {
    refreshZebraPrinters().catch(() => {});
  }
}

function handleTogglePrinterSettings() {
  const isHidden = printerSettings.classList.toggle('hidden');
  togglePrinterSettings.setAttribute('aria-expanded', String(!isHidden));
  togglePrinterSettings.classList.toggle('active', !isHidden);
}

function handleTemplateChange() {
  updateTemplateHint();
  if (lastOrderData) {
    renderOrderSummary(lastOrderData.preview);
  }
  if (selectedOrderId) {
    refreshOrderPreview().catch((err) => showError(err.message));
  } else {
    scheduleHtmlPreviewRefresh();
  }
  pdfPreview.src = '';
}

function handlePrevLabel() {
  if (currentLabelIndex > 0) {
    currentLabelIndex -= 1;
    refreshHtmlPreview();
  }
}

function handleNextLabel() {
  if (currentLabelIndex < totalLabelCount - 1) {
    currentLabelIndex += 1;
    refreshHtmlPreview();
  }
}

function handleViewAllChange() {
  refreshHtmlPreview();
}

selectionGroupsEl.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') return;
  const groupId = target.dataset.groupId;
  if (!groupId) return;
  handleGroupCheckboxChange(groupId, target.checked);
});

selectAllGroupsBtn.addEventListener('click', handleSelectAllGroups);
clearAllGroupsBtn.addEventListener('click', handleClearAllGroups);
rangeFromInput.addEventListener('change', scheduleSelectionRefresh);
rangeToInput.addEventListener('change', scheduleSelectionRefresh);

orderFilter.addEventListener('input', handleOrderFilter);
orderSelect.addEventListener('change', handleOrderSelectChange);
templateSelect.addEventListener('change', handleTemplateChange);
prevLabelBtn.addEventListener('click', handlePrevLabel);
nextLabelBtn.addEventListener('click', handleNextLabel);
viewAllLabels.addEventListener('change', handleViewAllChange);
generatePdfBtn.addEventListener('click', handleGeneratePdf);
downloadPdfBtn.addEventListener('click', handleDownloadPdf);
printLabelsBtn.addEventListener('click', handlePrintLabels);
printerMode.addEventListener('change', handlePrinterModeChange);
printerCopies.addEventListener('change', persistPrinterSettings);
systemPrinterName.addEventListener('change', persistPrinterSettings);
zebraPrinterSelect.addEventListener('change', persistPrinterSettings);
refreshPrintersBtn.addEventListener('click', refreshZebraPrinters);
togglePrinterSettings.addEventListener('click', handleTogglePrinterSettings);
tabHtml.addEventListener('click', () => switchPreviewTab('html'));
tabPdf.addEventListener('click', () => {
  if (pdfPreview.src) switchPreviewTab('pdf');
});

initPrinterSettings();
initNetworkBanner();

Promise.all([loadTemplates(), loadOrders()])
  .then(() => {
    const defaultOrder = allOrders.find((order) => order.name === 'PLDOR/OPR/00564');
    if (defaultOrder) {
      orderSelect.value = String(defaultOrder.id);
      selectOrder(defaultOrder.id);
    }
  })
  .catch((err) => showError(err.message));
