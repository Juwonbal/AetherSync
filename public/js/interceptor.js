/**
 * OmniDebug - Mobile Client Interceptor
 * Intercepts Console, Network, DOM, Errors, and Storage
 */

(function(window) {
  'use strict';

  const Interceptor = {
    wsSender: null,
    elementHighlightOverlay: null,

    init(sendFn) {
      this.wsSender = sendFn;
      this.hookConsole();
      this.hookErrors();
      this.hookNetwork();
      this.initElementHighlighter();
    },

    send(type, payload) {
      if (typeof this.wsSender === 'function') {
        this.wsSender({ type, ...payload, timestamp: Date.now() });
      }
    },

    // Safe serializer for objects / circular references
    serialize(arg, depth = 0) {
      if (depth > 4) return '[Nested Object]';
      if (arg === null) return { type: 'null', value: 'null' };
      if (arg === undefined) return { type: 'undefined', value: 'undefined' };
      
      const type = typeof arg;
      if (type === 'number' || type === 'boolean' || type === 'string') {
        return { type, value: arg };
      }
      
      if (arg instanceof Error) {
        return {
          type: 'error',
          value: arg.message,
          stack: arg.stack,
          name: arg.name
        };
      }

      if (arg instanceof HTMLElement) {
        return {
          type: 'html_element',
          value: `<${arg.tagName.toLowerCase()}${arg.id ? ` id="${arg.id}"` : ''}${arg.className ? ` class="${arg.className}"` : ''}>`
        };
      }

      if (Array.isArray(arg)) {
        return {
          type: 'array',
          value: arg.slice(0, 50).map(item => this.serialize(item, depth + 1)),
          length: arg.length
        };
      }

      if (type === 'object') {
        const obj = {};
        const keys = Object.keys(arg).slice(0, 50);
        for (const k of keys) {
          try {
            obj[k] = this.serialize(arg[k], depth + 1);
          } catch (e) {
            obj[k] = { type: 'unserializable', value: '[Error reading property]' };
          }
        }
        return { type: 'object', value: obj, constructorName: arg.constructor ? arg.constructor.name : 'Object' };
      }

      return { type: 'unknown', value: String(arg) };
    },

    // 1. Console Interception
    hookConsole() {
      const self = this;
      const methods = ['log', 'info', 'warn', 'error', 'debug', 'table'];

      methods.forEach(method => {
        const original = console[method];
        console[method] = function(...args) {
          try {
            const serializedArgs = args.map(arg => self.serialize(arg));
            self.send('console_log', {
              level: method,
              args: serializedArgs,
              rawTime: new Date().toLocaleTimeString()
            });
          } catch (e) {
            // fallback
          }
          if (original) {
            original.apply(console, args);
          }
        };
      });
    },

    // 2. Global Error Interception
    hookErrors() {
      const self = this;

      window.addEventListener('error', function(event) {
        self.send('console_log', {
          level: 'error',
          args: [{
            type: 'error',
            value: event.message || 'Uncaught Error',
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
            stack: event.error ? event.error.stack : null
          }],
          rawTime: new Date().toLocaleTimeString()
        });
      });

      window.addEventListener('unhandledrejection', function(event) {
        const reason = event.reason;
        self.send('console_log', {
          level: 'error',
          args: [{
            type: 'error',
            value: `Unhandled Promise Rejection: ${reason && reason.message ? reason.message : String(reason)}`,
            stack: reason && reason.stack ? reason.stack : null
          }],
          rawTime: new Date().toLocaleTimeString()
        });
      });
    },

    // 3. Network (Fetch & XMLHttpRequest) Interception
    hookNetwork() {
      const self = this;

      // Intercept fetch
      if (window.fetch) {
        const originalFetch = window.fetch;
        window.fetch = async function(...args) {
          const reqId = 'req_' + Math.random().toString(36).substr(2, 9);
          const startTime = performance.now();
          let url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : 'unknown');
          let method = 'GET';
          let reqHeaders = {};
          let reqBody = null;

          if (args[1]) {
            if (args[1].method) method = args[1].method.toUpperCase();
            if (args[1].headers) reqHeaders = args[1].headers;
            if (args[1].body) reqBody = typeof args[1].body === 'string' ? args[1].body : '[Binary/FormData]';
          }

          self.send('network_req', {
            id: reqId,
            stage: 'start',
            url,
            method,
            headers: reqHeaders,
            body: reqBody,
            startTime: Date.now()
          });

          try {
            const response = await originalFetch.apply(window, args);
            const duration = Math.round(performance.now() - startTime);
            const clone = response.clone();
            
            let responseBody = '';
            const contentType = response.headers.get('content-type') || '';
            
            try {
              if (contentType.includes('application/json') || contentType.includes('text/')) {
                responseBody = await clone.text();
              } else {
                responseBody = `[Binary Data: ${contentType}]`;
              }
            } catch (e) {
              responseBody = '[Unable to read body]';
            }

            const resHeaders = {};
            clone.headers.forEach((val, key) => { resHeaders[key] = val; });

            self.send('network_req', {
              id: reqId,
              stage: 'complete',
              status: response.status,
              statusText: response.statusText,
              duration,
              headers: resHeaders,
              responseBody: responseBody.slice(0, 10000), // cap to 10kb
              size: responseBody.length
            });

            return response;
          } catch (err) {
            const duration = Math.round(performance.now() - startTime);
            self.send('network_req', {
              id: reqId,
              stage: 'error',
              duration,
              error: err.message || 'Fetch failed'
            });
            throw err;
          }
        };
      }

      // Intercept XMLHttpRequest
      const originalXHR = window.XMLHttpRequest;
      function InterceptedXHR() {
        const xhr = new originalXHR();
        const reqId = 'xhr_' + Math.random().toString(36).substr(2, 9);
        let startTime = 0;
        let method = 'GET';
        let url = '';
        let reqBody = null;

        const origOpen = xhr.open;
        xhr.open = function(m, u) {
          method = (m || 'GET').toUpperCase();
          url = u;
          return origOpen.apply(xhr, arguments);
        };

        const origSend = xhr.send;
        xhr.send = function(body) {
          startTime = performance.now();
          reqBody = body ? String(body) : null;
          self.send('network_req', {
            id: reqId,
            stage: 'start',
            url,
            method,
            body: reqBody,
            startTime: Date.now()
          });

          xhr.addEventListener('loadend', () => {
            const duration = Math.round(performance.now() - startTime);
            self.send('network_req', {
              id: reqId,
              stage: 'complete',
              status: xhr.status,
              statusText: xhr.statusText,
              duration,
              responseBody: (xhr.responseText || '').slice(0, 10000),
              size: (xhr.responseText || '').length
            });
          });

          xhr.addEventListener('error', () => {
            const duration = Math.round(performance.now() - startTime);
            self.send('network_req', {
              id: reqId,
              stage: 'error',
              duration,
              error: 'XHR Network Error'
            });
          });

          return origSend.apply(xhr, arguments);
        };

        return xhr;
      }
      window.XMLHttpRequest = InterceptedXHR;
    },

    // 4. DOM Snapshot & Inspection
    captureDOMSnapshot() {
      let nodeIdCounter = 1;

      function serializeNode(node) {
        if (!node) return null;
        const id = nodeIdCounter++;
        node.__debug_node_id = id;

        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent.trim();
          if (!text) return null;
          return { id, type: 'text', text };
        }

        if (node.nodeType === Node.ELEMENT_NODE) {
          // Skip our own debug overlays
          if (node.id === 'omni-debug-highlighter' || node.classList.contains('omni-system-ui')) {
            return null;
          }

          const attributes = {};
          for (let i = 0; i < node.attributes.length; i++) {
            const attr = node.attributes[i];
            attributes[attr.name] = attr.value;
          }

          const children = [];
          for (let i = 0; i < node.childNodes.length; i++) {
            const childSerialized = serializeNode(node.childNodes[i]);
            if (childSerialized) children.push(childSerialized);
          }

          return {
            id,
            type: 'element',
            tagName: node.tagName.toLowerCase(),
            attributes,
            children
          };
        }

        return null;
      }

      return serializeNode(document.documentElement);
    },

    sendDOMUpdate() {
      const tree = this.captureDOMSnapshot();
      this.send('dom_tree', { tree });
    },

    // 5. Element Highlighter (for when Laptop hovers an element)
    initElementHighlighter() {
      let overlay = document.getElementById('omni-debug-highlighter');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'omni-debug-highlighter';
        overlay.style.position = 'fixed';
        overlay.style.pointerEvents = 'none';
        overlay.style.zIndex = '9999999';
        overlay.style.backgroundColor = 'rgba(59, 130, 246, 0.35)';
        overlay.style.border = '2px solid #3b82f6';
        overlay.style.borderRadius = '4px';
        overlay.style.transition = 'all 0.15s ease-out';
        overlay.style.display = 'none';
        
        const label = document.createElement('div');
        label.id = 'omni-debug-highlighter-label';
        label.style.position = 'absolute';
        label.style.top = '-24px';
        label.style.left = '0';
        label.style.backgroundColor = '#1e293b';
        label.style.color = '#38bdf8';
        label.style.padding = '2px 6px';
        label.style.fontSize = '11px';
        label.style.fontFamily = 'monospace';
        label.style.borderRadius = '3px';
        label.style.whiteSpace = 'nowrap';
        label.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
        overlay.appendChild(label);

        document.body.appendChild(overlay);
      }
      this.elementHighlightOverlay = overlay;
    },

    highlightElement(selector, nodeDebugId) {
      let target = null;
      if (nodeDebugId) {
        const findByDebugId = (node) => {
          if (node.__debug_node_id === nodeDebugId) return node;
          for (const child of node.children || []) {
            const found = findByDebugId(child);
            if (found) return found;
          }
          return null;
        };
        target = findByDebugId(document.documentElement);
      }
      
      if (!target && selector) {
        try {
          target = document.querySelector(selector);
        } catch (e) {}
      }

      if (target && target instanceof HTMLElement && target !== this.elementHighlightOverlay) {
        const rect = target.getBoundingClientRect();
        this.elementHighlightOverlay.style.display = 'block';
        this.elementHighlightOverlay.style.top = `${rect.top}px`;
        this.elementHighlightOverlay.style.left = `${rect.left}px`;
        this.elementHighlightOverlay.style.width = `${rect.width}px`;
        this.elementHighlightOverlay.style.height = `${rect.height}px`;
        
        const label = document.getElementById('omni-debug-highlighter-label');
        if (label) {
          const idStr = target.id ? `#${target.id}` : '';
          const classStr = target.className && typeof target.className === 'string' ? `.${target.className.split(' ').filter(Boolean).join('.')}` : '';
          label.textContent = `${target.tagName.toLowerCase()}${idStr}${classStr} [${Math.round(rect.width)}x${Math.round(rect.height)}]`;
        }
      } else {
        if (this.elementHighlightOverlay) {
          this.elementHighlightOverlay.style.display = 'none';
        }
      }
    },

    updateElementStyle(selector, styles) {
      if (!selector || !styles) return;
      try {
        const el = document.querySelector(selector);
        if (el) {
          Object.assign(el.style, styles);
          this.sendDOMUpdate();
        }
      } catch (e) {
        console.error('Style update error:', e);
      }
    },

    // 6. Storage Inspection
    getStorageData() {
      const local = {};
      const session = {};
      
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          local[k] = localStorage.getItem(k);
        }
      } catch (e) {}

      try {
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i);
          session[k] = sessionStorage.getItem(k);
        }
      } catch (e) {}

      return {
        localStorage: local,
        sessionStorage: session,
        cookies: document.cookie || ''
      };
    },

    sendStorageData() {
      this.send('storage_data', this.getStorageData());
    },

    setStorageItem(type, key, value) {
      try {
        if (type === 'localStorage') localStorage.setItem(key, value);
        else if (type === 'sessionStorage') sessionStorage.setItem(key, value);
        this.sendStorageData();
      } catch (e) {}
    },

    removeStorageItem(type, key) {
      try {
        if (type === 'localStorage') localStorage.removeItem(key);
        else if (type === 'sessionStorage') sessionStorage.removeItem(key);
        this.sendStorageData();
      } catch (e) {}
    },

    clearStorage(type) {
      try {
        if (type === 'localStorage') localStorage.clear();
        else if (type === 'sessionStorage') sessionStorage.clear();
        this.sendStorageData();
      } catch (e) {}
    }
  };

  window.OmniInterceptor = Interceptor;
})(window);
