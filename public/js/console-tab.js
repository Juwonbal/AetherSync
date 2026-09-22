/**
 * OmniDebug - Laptop Dashboard: Console Tab & REPL Engine
 */

window.ConsoleTab = (function() {
  'use strict';

  let sendWS = null;
  let logContainer = null;
  let replInput = null;
  let filterLevel = 'all';
  let filterQuery = '';
  const entries = [];
  const replHistory = [];
  let historyIdx = -1;

  function init(wsSender) {
    sendWS = wsSender;
    logContainer = document.getElementById('console-logs');
    replInput = document.getElementById('console-repl-input');

    // Filter controls
    const levelSelect = document.getElementById('console-level-filter');
    const searchInput = document.getElementById('console-search-input');
    const btnClear = document.getElementById('console-btn-clear');

    if (levelSelect) {
      levelSelect.addEventListener('change', (e) => {
        filterLevel = e.target.value;
        renderEntries();
      });
    }

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        filterQuery = e.target.value.toLowerCase();
        renderEntries();
      });
    }

    if (btnClear) {
      btnClear.addEventListener('click', () => {
        entries.length = 0;
        renderEntries();
      });
    }

    // REPL input handlers
    if (replInput) {
      replInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const code = replInput.value.trim();
          if (code) {
            runREPL(code);
            replHistory.push(code);
            historyIdx = replHistory.length;
            replInput.value = '';
          }
        } else if (e.key === 'ArrowUp') {
          if (historyIdx > 0) {
            historyIdx--;
            replInput.value = replHistory[historyIdx] || '';
          }
        } else if (e.key === 'ArrowDown') {
          if (historyIdx < replHistory.length - 1) {
            historyIdx++;
            replInput.value = replHistory[historyIdx] || '';
          } else {
            historyIdx = replHistory.length;
            replInput.value = '';
          }
        }
      });
    }
  }

  function handleLogMessage(msg) {
    entries.push(msg);
    if (entries.length > 500) entries.shift();
    appendSingleEntry(msg);
  }

  function handleEvalResponse(msg) {
    if (msg.success) {
      appendEntryToDOM({
        level: 'repl-out',
        args: [msg.result],
        rawTime: new Date().toLocaleTimeString()
      });
    } else {
      appendEntryToDOM({
        level: 'error',
        args: [{ type: 'error', value: `${msg.error.name}: ${msg.error.message}`, stack: msg.error.stack }],
        rawTime: new Date().toLocaleTimeString()
      });
    }
  }

  function runREPL(code) {
    // Append REPL prompt echo
    appendEntryToDOM({
      level: 'repl-in',
      args: [{ type: 'string', value: code }],
      rawTime: new Date().toLocaleTimeString()
    });

    // Send eval request to mobile
    const reqId = 'eval_' + Math.random().toString(36).substr(2, 9);
    sendWS({
      type: 'eval_request',
      id: reqId,
      code: code
    });
  }

  function renderEntries() {
    if (!logContainer) return;
    logContainer.innerHTML = '';
    entries.forEach(entry => {
      if (matchesFilter(entry)) {
        appendEntryToDOM(entry);
      }
    });
  }

  function matchesFilter(entry) {
    if (filterLevel !== 'all' && entry.level !== filterLevel) {
      return false;
    }
    if (filterQuery) {
      const serialized = JSON.stringify(entry.args || '').toLowerCase();
      if (!serialized.includes(filterQuery)) return false;
    }
    return true;
  }

  function appendSingleEntry(entry) {
    if (matchesFilter(entry)) {
      appendEntryToDOM(entry);
    }
  }

  function appendEntryToDOM(entry) {
    if (!logContainer) return;

    const row = document.createElement('div');
    row.className = `console-entry entry-${entry.level}`;

    const timeSpan = document.createElement('span');
    timeSpan.className = 'console-time';
    timeSpan.textContent = entry.rawTime || new Date().toLocaleTimeString();
    row.appendChild(timeSpan);

    const contentDiv = document.createElement('div');
    contentDiv.className = 'console-content';
    contentDiv.style.flex = '1';

    if (entry.level === 'repl-in') {
      contentDiv.innerHTML = `<span style="color:#38bdf8;font-weight:bold;">&gt; </span><span style="color:#e2e8f0;">${escapeHTML(entry.args[0].value)}</span>`;
    } else if (entry.level === 'repl-out') {
      contentDiv.innerHTML = `<span style="color:#a855f7;font-weight:bold;">&lt; </span>`;
      contentDiv.appendChild(renderSerializedArg(entry.args[0]));
    } else if (entry.level === 'table' && entry.args[0] && entry.args[0].type === 'array') {
      contentDiv.appendChild(renderTableArg(entry.args[0]));
    } else {
      (entry.args || []).forEach((arg, i) => {
        if (i > 0) {
          const space = document.createTextNode(' ');
          contentDiv.appendChild(space);
        }
        contentDiv.appendChild(renderSerializedArg(arg));
      });
    }

    row.appendChild(contentDiv);
    logContainer.appendChild(row);
    logContainer.scrollTop = logContainer.scrollHeight;
  }

  function renderSerializedArg(arg) {
    const span = document.createElement('span');
    if (!arg) {
      span.textContent = 'undefined';
      span.style.color = '#64748b';
      return span;
    }

    switch (arg.type) {
      case 'string':
        span.textContent = arg.value;
        span.style.color = '#a5f3fc';
        break;
      case 'number':
        span.textContent = arg.value;
        span.style.color = '#fde047';
        break;
      case 'boolean':
        span.textContent = String(arg.value);
        span.style.color = '#f472b6';
        break;
      case 'null':
      case 'undefined':
        span.textContent = arg.type;
        span.style.color = '#94a3b8';
        break;
      case 'error':
        span.textContent = arg.value + (arg.stack ? `\n${arg.stack}` : '');
        span.style.color = '#fb7185';
        span.style.whiteSpace = 'pre-wrap';
        break;
      case 'html_element':
        span.textContent = arg.value;
        span.style.color = '#38bdf8';
        break;
      case 'array':
        span.appendChild(renderExpandableArray(arg));
        break;
      case 'object':
        span.appendChild(renderExpandableObject(arg));
        break;
      default:
        span.textContent = String(arg.value !== undefined ? arg.value : arg);
    }
    return span;
  }

  function renderExpandableObject(arg) {
    const details = document.createElement('details');
    details.style.display = 'inline-block';
    const summary = document.createElement('summary');
    summary.style.cursor = 'pointer';
    summary.style.color = '#93c5fd';
    summary.textContent = `${arg.constructorName || 'Object'} { ... }`;
    details.appendChild(summary);

    const body = document.createElement('div');
    body.style.paddingLeft = '16px';
    body.style.borderLeft = '1px solid #334155';
    body.style.margin = '4px 0';

    if (arg.value && typeof arg.value === 'object') {
      for (const k in arg.value) {
        const item = document.createElement('div');
        item.innerHTML = `<span style="color:#fbbf24;">${escapeHTML(k)}</span>: `;
        item.appendChild(renderSerializedArg(arg.value[k]));
        body.appendChild(item);
      }
    }
    details.appendChild(body);
    return details;
  }

  function renderExpandableArray(arg) {
    const details = document.createElement('details');
    details.style.display = 'inline-block';
    const summary = document.createElement('summary');
    summary.style.cursor = 'pointer';
    summary.style.color = '#93c5fd';
    summary.textContent = `Array(${arg.length || (arg.value && arg.value.length) || 0}) [ ... ]`;
    details.appendChild(summary);

    const body = document.createElement('div');
    body.style.paddingLeft = '16px';
    body.style.borderLeft = '1px solid #334155';
    body.style.margin = '4px 0';

    if (Array.isArray(arg.value)) {
      arg.value.forEach((val, idx) => {
        const item = document.createElement('div');
        item.innerHTML = `<span style="color:#94a3b8;">${idx}</span>: `;
        item.appendChild(renderSerializedArg(val));
        body.appendChild(item);
      });
    }
    details.appendChild(body);
    return details;
  }

  function renderTableArg(arg) {
    const table = document.createElement('table');
    table.style.borderCollapse = 'collapse';
    table.style.margin = '6px 0';
    table.style.fontSize = '11px';
    table.style.background = '#0f172a';
    table.style.border = '1px solid #334155';

    if (Array.isArray(arg.value) && arg.value.length > 0) {
      const first = arg.value[0];
      const keys = first.type === 'object' && first.value ? Object.keys(first.value) : ['(index)', 'Value'];

      const thead = document.createElement('thead');
      const trH = document.createElement('tr');
      trH.innerHTML = `<th style="border:1px solid #334155;padding:4px 8px;background:#1e293b;color:#94a3b8;">(index)</th>` +
        keys.map(k => `<th style="border:1px solid #334155;padding:4px 8px;background:#1e293b;color:#38bdf8;">${escapeHTML(k)}</th>`).join('');
      thead.appendChild(trH);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      arg.value.forEach((rowObj, idx) => {
        const tr = document.createElement('tr');
        let cols = `<td style="border:1px solid #334155;padding:4px 8px;color:#94a3b8;">${idx}</td>`;
        if (rowObj.type === 'object' && rowObj.value) {
          keys.forEach(k => {
            const v = rowObj.value[k];
            cols += `<td style="border:1px solid #334155;padding:4px 8px;color:#cbd5e1;">${v ? escapeHTML(String(v.value)) : ''}</td>`;
          });
        }
        tr.innerHTML = cols;
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
    }
    return table;
  }

  function escapeHTML(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  return {
    init,
    handleLogMessage,
    handleEvalResponse
  };
})();
