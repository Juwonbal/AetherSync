/**
 * OmniDebug - Laptop Dashboard: Network Tab
 */

window.NetworkTab = (function() {
  'use strict';

  let sendWS = null;
  let tableBody = null;
  let detailPane = null;
  let filterInput = null;
  let btnClear = null;
  
  const requests = new Map(); // id -> req object
  let filterQuery = '';
  let selectedReqId = null;

  function init(wsSender) {
    sendWS = wsSender;
    tableBody = document.getElementById('network-table-body');
    detailPane = document.getElementById('network-detail-pane');
    filterInput = document.getElementById('network-filter-input');
    btnClear = document.getElementById('network-btn-clear');

    if (filterInput) {
      filterInput.addEventListener('input', (e) => {
        filterQuery = e.target.value.toLowerCase();
        renderTable();
      });
    }

    if (btnClear) {
      btnClear.addEventListener('click', () => {
        requests.clear();
        selectedReqId = null;
        renderTable();
        closeDetail();
      });
    }

    const closeBtn = document.getElementById('network-detail-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', closeDetail);
    }
  }

  function handleNetworkMessage(msg) {
    if (msg.stage === 'start') {
      requests.set(msg.id, {
        id: msg.id,
        url: msg.url,
        method: msg.method,
        status: '(pending)',
        statusText: '',
        duration: '--',
        size: '--',
        headers: msg.headers || {},
        body: msg.body,
        responseBody: '',
        startTime: msg.startTime || Date.now(),
        stage: 'pending'
      });
    } else if (msg.stage === 'complete') {
      const existing = requests.get(msg.id) || { id: msg.id, url: '', method: '' };
      Object.assign(existing, {
        status: msg.status,
        statusText: msg.statusText,
        duration: `${msg.duration}ms`,
        size: formatBytes(msg.size || 0),
        responseHeaders: msg.headers || {},
        responseBody: msg.responseBody,
        stage: 'complete'
      });
      requests.set(msg.id, existing);
    } else if (msg.stage === 'error') {
      const existing = requests.get(msg.id) || { id: msg.id, url: '', method: '' };
      Object.assign(existing, {
        status: 'Failed',
        duration: `${msg.duration}ms`,
        error: msg.error,
        stage: 'error'
      });
      requests.set(msg.id, existing);
    }

    renderTable();
    if (selectedReqId === msg.id) {
      renderDetail(requests.get(msg.id));
    }
  }

  function renderTable() {
    if (!tableBody) return;
    tableBody.innerHTML = '';

    requests.forEach(req => {
      if (filterQuery && !req.url.toLowerCase().includes(filterQuery)) return;

      const tr = document.createElement('tr');
      tr.className = `network-row ${selectedReqId === req.id ? 'selected' : ''}`;
      tr.onclick = () => selectRequest(req.id);

      const statusBadgeClass = req.status === 200 || req.status === 201 || req.status === 304
        ? 'badge-green'
        : req.status === '(pending)'
        ? 'badge-yellow'
        : 'badge-red';

      const urlObj = tryParseUrl(req.url);
      const pathname = urlObj ? (urlObj.pathname + urlObj.search) : req.url;

      tr.innerHTML = `
        <td><span class="badge ${statusBadgeClass}">${req.status}</span></td>
        <td style="color:#38bdf8;font-weight:600;">${req.method}</td>
        <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHTML(req.url)}">${escapeHTML(pathname)}</td>
        <td style="color:#94a3b8;">${req.duration}</td>
        <td style="color:#94a3b8;">${req.size}</td>
      `;

      tableBody.appendChild(tr);
    });
  }

  function selectRequest(id) {
    selectedReqId = id;
    renderTable();
    const req = requests.get(id);
    if (req) {
      renderDetail(req);
    }
  }

  function renderDetail(req) {
    if (!detailPane) return;
    detailPane.style.display = 'flex';

    document.getElementById('detail-url').textContent = `${req.method} ${req.url}`;
    document.getElementById('detail-status').textContent = `Status: ${req.status} ${req.statusText || ''} | Duration: ${req.duration}`;

    // Request Headers
    const reqHeadersEl = document.getElementById('detail-req-headers');
    if (reqHeadersEl) {
      reqHeadersEl.textContent = JSON.stringify(req.headers || {}, null, 2);
    }

    // Response Headers
    const resHeadersEl = document.getElementById('detail-res-headers');
    if (resHeadersEl) {
      resHeadersEl.textContent = JSON.stringify(req.responseHeaders || {}, null, 2);
    }

    // Request Body
    const reqBodyEl = document.getElementById('detail-req-body');
    if (reqBodyEl) {
      reqBodyEl.textContent = req.body || '(empty)';
    }

    // Response Preview
    const resBodyEl = document.getElementById('detail-res-body');
    if (resBodyEl) {
      let formatted = req.responseBody || '(empty)';
      try {
        const parsed = JSON.parse(req.responseBody);
        formatted = JSON.stringify(parsed, null, 2);
      } catch (e) {}
      resBodyEl.textContent = formatted;
    }
  }

  function closeDetail() {
    if (detailPane) detailPane.style.display = 'none';
    selectedReqId = null;
    renderTable();
  }

  function tryParseUrl(str) {
    try {
      return new URL(str);
    } catch (e) {
      return null;
    }
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === '--') return '--';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function escapeHTML(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  return {
    init,
    handleNetworkMessage
  };
})();
