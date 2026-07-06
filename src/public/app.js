let selectedOrderId = null;
let totalLabelCount = 0;
let currentLabelIndex = 0;
let lastOrderData = null;
let allOrders = [];
let templateCatalog = new Map();
let previewDebounceTimer = null;

const orderFilter = document.getElementById('order-filter');
const orderSelect = document.getElementById('order-select');
const orderSection = document.getElementById('order-section');
const orderName = document.getElementById('order-name');
const orderMeta = document.getElementById('order-meta');
const totalLabels = document.getElementById('total-labels');
const summaryBody = document.getElementById('summary-body');
const templateSelect = document.getElementById('template-select');
const templateHint = document.getElementById('template-hint');
const htmlPreviewSection = document.getElementById('html-preview-section');
const htmlPreview = document.getElementById('html-preview');
const htmlPreviewLoading = document.getElementById('html-preview-loading');
const prevLabelBtn = document.getElementById('prev-label-btn');
const nextLabelBtn = document.getElementById('next-label-btn');
const labelIndexText = document.getElementById('label-index-text');
const viewAllLabels = document.getElementById('view-all-labels');
const generatePdfBtn = document.getElementById('generate-pdf-btn');
const downloadPdfBtn = document.getElementById('download-pdf-btn');
const loading = document.getElementById('loading');
const errorEl = document.getElementById('error');
const pdfPreviewSection = document.getElementById('pdf-preview-section');
const pdfPreview = document.getElementById('pdf-preview');

function showError(message) {
  errorEl.textContent = message;
  errorEl.classList.remove('hidden');
}

function hideError() {
  errorEl.classList.add('hidden');
}

function getSelectedTemplateCode() {
  const value = templateSelect.value.trim();
  return value || null;
}

function templateQueryParam() {
  const code = getSelectedTemplateCode();
  return code ? `&template=${encodeURIComponent(code)}` : '';
}

function getEffectiveTemplateLabel(code, fallbackName) {
  if (!code) return fallbackName;
  return templateCatalog.get(code) || code;
}

function updateTemplateHint() {
  const override = getSelectedTemplateCode();
  if (!override) {
    templateHint.textContent =
      'Cada producto usa su plantilla asignada en BD.';
    return;
  }
  const name = getEffectiveTemplateLabel(override, override);
  templateHint.textContent = `Vista previa e impresión con: ${name} (${override}).`;
}

function effectiveTemplateForItem(item) {
  const override = getSelectedTemplateCode();
  if (override) {
    return getEffectiveTemplateLabel(override, override);
  }
  return item.templateName || item.templateCode || '—';
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

  const autoOption = document.createElement('option');
  autoOption.value = '';
  autoOption.textContent = 'Por producto (asignada en BD)';
  templateSelect.appendChild(autoOption);

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
  const res = await fetch(`/api/orders/${id}`);
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

  const templateLabel = effectiveTemplateForItem(item);

  tr.innerHTML = `
    <td>${refCell}</td>
    <td>${item.productName}</td>
    <td><span class="template-badge">${templateLabel}</span></td>
    <td>${isChild ? '—' : item.orderQuantity}</td>
    <td>${isChild ? (item.componentQuantity ?? '—') : '—'}</td>
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
  const params = new URLSearchParams({ t: String(Date.now()) });
  const template = getSelectedTemplateCode();
  if (template) params.set('template', template);
  if (!viewAllLabels.checked && totalLabelCount > 0) {
    params.set('index', String(currentLabelIndex));
  }
  return `/api/orders/${selectedOrderId}/labels/html?${params.toString()}`;
}

function buildPdfUrl(download = false) {
  const params = new URLSearchParams({ t: String(Date.now()) });
  const template = getSelectedTemplateCode();
  if (template) params.set('template', template);
  if (download) params.set('download', '1');
  return `/api/orders/${selectedOrderId}/labels/pdf?${params.toString()}`;
}

function refreshHtmlPreview() {
  if (!selectedOrderId || totalLabelCount === 0) return;

  hideError();
  htmlPreviewLoading.classList.remove('hidden');
  htmlPreviewSection.classList.remove('hidden');
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
  totalLabelCount = preview.totalLabels;
  totalLabels.textContent = preview.totalLabels;
  currentLabelIndex = 0;

  renderOrderSummary(preview);
  updateTemplateHint();
  updateLabelNavigation();

  orderSection.classList.remove('hidden');
  pdfPreviewSection.classList.add('hidden');
  pdfPreview.src = '';

  if (totalLabelCount > 0) {
    refreshHtmlPreview();
  } else {
    htmlPreviewSection.classList.add('hidden');
    htmlPreview.src = '';
  }
}

async function selectOrder(id) {
  if (!id) {
    selectedOrderId = null;
    orderSection.classList.add('hidden');
    htmlPreviewSection.classList.add('hidden');
    pdfPreviewSection.classList.add('hidden');
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

function handleGeneratePdf() {
  if (!selectedOrderId) return;

  hideError();
  loading.classList.remove('hidden');
  generatePdfBtn.disabled = true;
  downloadPdfBtn.disabled = true;

  pdfPreview.onload = () => {
    loading.classList.add('hidden');
    generatePdfBtn.disabled = false;
    downloadPdfBtn.disabled = false;
    pdfPreviewSection.classList.remove('hidden');
    pdfPreviewSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  pdfPreview.onerror = () => {
    loading.classList.add('hidden');
    generatePdfBtn.disabled = false;
    downloadPdfBtn.disabled = false;
    showError('Error al cargar el PDF');
  };

  pdfPreview.src = buildPdfUrl(false);
}

async function handleDownloadPdf() {
  if (!selectedOrderId) return;

  hideError();
  loading.classList.remove('hidden');
  generatePdfBtn.disabled = true;
  downloadPdfBtn.disabled = true;

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
    loading.classList.add('hidden');
    generatePdfBtn.disabled = false;
    downloadPdfBtn.disabled = false;
  }
}

function handleTemplateChange() {
  updateTemplateHint();
  if (lastOrderData) {
    renderOrderSummary(lastOrderData.preview);
  }
  scheduleHtmlPreviewRefresh();
  pdfPreviewSection.classList.add('hidden');
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

orderFilter.addEventListener('input', handleOrderFilter);
orderSelect.addEventListener('change', handleOrderSelectChange);
templateSelect.addEventListener('change', handleTemplateChange);
prevLabelBtn.addEventListener('click', handlePrevLabel);
nextLabelBtn.addEventListener('click', handleNextLabel);
viewAllLabels.addEventListener('change', handleViewAllChange);
generatePdfBtn.addEventListener('click', handleGeneratePdf);
downloadPdfBtn.addEventListener('click', handleDownloadPdf);

Promise.all([loadTemplates(), loadOrders()])
  .then(() => {
    const defaultOrder = allOrders.find((order) => order.name === 'PLDOR/OPR/00564');
    if (defaultOrder) {
      orderSelect.value = String(defaultOrder.id);
      selectOrder(defaultOrder.id);
    }
  })
  .catch((err) => showError(err.message));
