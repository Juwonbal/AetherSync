/**
 * OmniDebug - Laptop Master Dashboard Controller
 * Handles WebSockets, WebRTC Video Mirroring, Live DOM/Canvas Fallback Mirror,
 * Bi-directional Touch/Scroll Controls, QR Code Pairing, and DevTools Tabs
 */

(function() {
  'use strict';

  const state = {
    ws: null,
    peerConnection: null,
    sessionId: '',
    pin: '',
    isPaired: false,
    selectedIp: '',
    interfaces: [],
    laserActive: false,
    mediaRecorder: null,
    recordedChunks: [],
    isRecording: false,
    storageData: { localStorage: {}, sessionStorage: {}, cookies: '' },
    activeStorageType: 'localStorage',
    mirrorMode: 'none' // 'webrtc' | 'dom' | 'canvas' | 'none'
  };

  // DOM References
  const mirrorVideo = document.getElementById('mirror-video');
  const mirrorIframe = document.getElementById('mirror-iframe');
  const mirrorCanvas = document.getElementById('mirror-canvas');
  const mirrorPlaceholder = document.getElementById('mirror-placeholder');
  const phoneScreen = document.getElementById('phone-screen');
  const phoneFrame = document.getElementById('phone-frame');
  const touchLayer = document.getElementById('phone-touch-layer');
  const statusBadge = document.getElementById('header-status-badge');
  const statusText = document.getElementById('header-status-text');
  const pingBadge = document.getElementById('header-ping-badge');
  const networkSelect = document.getElementById('network-interface-select');
  const qrModal = document.getElementById('qr-pairing-modal');
  const qrImage = document.getElementById('qr-image');
  const qrUrlText = document.getElementById('qr-url-text');
  const qrPinText = document.getElementById('qr-pin-text');

  // Initialize Network Info & QR Code
  async function loadNetworkInfo(ip, proto) {
    try {
      const protocol = proto || state.qrProtocol || 'https';
      state.qrProtocol = protocol;
      const ipParam = ip || state.selectedIp || '';
      const url = `/api/network-info?ip=${encodeURIComponent(ipParam)}&protocol=${protocol}&session=${state.sessionId || ''}`;
      const res = await fetch(url);
      const data = await res.json();

      state.sessionId = data.sessionId;
      state.pin = data.pin;
      state.selectedIp = data.selectedIp;
      state.interfaces = data.interfaces;

      // Populate IP select dropdown
      if (networkSelect) {
        networkSelect.innerHTML = '';
        data.interfaces.forEach(iface => {
          const opt = document.createElement('option');
          opt.value = iface.address;
          opt.textContent = `${iface.name} (${iface.address})${iface.isWifi ? ' 📶' : ''}`;
          if (iface.address === data.selectedIp) opt.selected = true;
          networkSelect.appendChild(opt);
        });
      }

      // Update QR Modal
      if (qrImage) qrImage.src = data.qrDataUrl;
      if (qrUrlText) qrUrlText.value = data.mobileUrl;
      if (qrPinText) qrPinText.textContent = data.pin;

      // Connect WebSocket if not connected
      if (!state.ws) {
        initWebSocket();
      }
    } catch (err) {
      console.error('Failed to load network info:', err);
    }
  }

  // WebSocket Connection
  function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    state.ws = new WebSocket(wsUrl);

    state.ws.onopen = () => {
      updateStatus('waiting', 'Waiting for Mobile Connection...');
      sendWS({
        type: 'join',
        role: 'laptop',
        sessionId: state.sessionId,
        pin: state.pin
      });

      // Initialize DevTools Modules
      if (window.ConsoleTab) window.ConsoleTab.init(sendWS);
      if (window.NetworkTab) window.NetworkTab.init(sendWS);
      if (window.DOMTab) window.DOMTab.init(sendWS);
      if (window.SensorsTab) window.SensorsTab.init(sendWS);

      startPingInterval();
    };

    state.ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleMessage(msg);
      } catch (err) {
        console.error('Error parsing WS message:', err);
      }
    };

    state.ws.onclose = () => {
      updateStatus('disconnected', 'Disconnected. Reconnecting...');
      state.isPaired = false;
      setTimeout(initWebSocket, 2000);
    };
  }

  function sendWS(data) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify(data));
    }
  }

  // Handle messages from Phone or Server
  async function handleMessage(msg) {
    switch (msg.type) {
      case 'joined': {
        if (msg.paired) {
          updateStatus('paired', 'Mobile Connected & Paired');
          state.isPaired = true;
          hideQRModal();
        }
        break;
      }

      case 'peer_connected': {
        updateStatus('paired', 'Mobile Connected & Paired');
        state.isPaired = true;
        hideQRModal();
        sendWS({ type: 'dom_request' });
        sendWS({ type: 'storage_request' });
        break;
      }

      case 'peer_disconnected': {
        updateStatus('waiting', 'Mobile Disconnected');
        state.isPaired = false;
        resetMirrorView();
        break;
      }

      case 'pong': {
        const latency = Math.round((Date.now() - msg.timestamp) / 2);
        if (pingBadge) {
          pingBadge.textContent = `${latency} ms`;
          pingBadge.className = `status-pill ${latency < 60 ? 'badge-green' : latency < 150 ? 'badge-yellow' : 'badge-red'}`;
        }
        break;
      }

      // WebRTC Video Mirroring Signaling
      case 'webrtc_offer': {
        await handleWebRTCOffer(msg.offer);
        break;
      }

      case 'webrtc_ice': {
        await handleWebRTCIce(msg.candidate);
        break;
      }

      case 'screen_share_stopped': {
        resetMirrorView();
        break;
      }

      // Live DOM & Canvas Mirror Updates (for iOS Safari & Fallback)
      case 'dom_mirror_update': {
        renderDOMMirrorSnapshot(msg);
        break;
      }

      case 'canvas_frame': {
        renderCanvasFrame(msg);
        break;
      }

      // Live Touch & Scroll Sync from Phone -> Laptop
      case 'phone_touch': {
        renderPhoneFingerTouch(msg);
        break;
      }

      case 'phone_scroll': {
        handlePhoneScrollSync(msg);
        break;
      }

      // DevTools Streams
      case 'console_log': {
        if (window.ConsoleTab) window.ConsoleTab.handleLogMessage(msg);
        break;
      }

      case 'eval_response': {
        if (window.ConsoleTab) window.ConsoleTab.handleEvalResponse(msg);
        break;
      }

      case 'network_req': {
        if (window.NetworkTab) window.NetworkTab.handleNetworkMessage(msg);
        break;
      }

      case 'dom_tree': {
        if (window.DOMTab) window.DOMTab.handleDOMTree(msg);
        break;
      }

      case 'telemetry': {
        if (msg.dimensions) applyDynamicCalibration(msg.dimensions);
        if (window.SensorsTab) window.SensorsTab.handleTelemetry(msg);
        break;
      }

      case 'gyro_data': {
        if (window.SensorsTab) window.SensorsTab.handleGyroData(msg);
        break;
      }

      case 'storage_data': {
        handleStorageData(msg);
        break;
      }
    }
  }

  // --- WebRTC Video Stream Receiver ---
  async function handleWebRTCOffer(offer) {
    const config = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };

    state.peerConnection = new RTCPeerConnection(config);

    state.peerConnection.ontrack = (event) => {
      if (mirrorVideo && event.streams[0]) {
        mirrorVideo.srcObject = event.streams[0];
        mirrorVideo.style.display = 'block';
        if (mirrorIframe) mirrorIframe.style.display = 'none';
        if (mirrorCanvas) mirrorCanvas.style.display = 'none';
        if (mirrorPlaceholder) mirrorPlaceholder.style.display = 'none';
        state.mirrorMode = 'webrtc';
        mirrorVideo.play().catch(e => console.warn('Video auto-play failed:', e));
      }
    };

    state.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        sendWS({
          type: 'webrtc_ice',
          candidate: event.candidate
        });
      }
    };

    await state.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await state.peerConnection.createAnswer();
    await state.peerConnection.setLocalDescription(answer);

    sendWS({
      type: 'webrtc_answer',
      answer: answer
    });
  }

  async function handleWebRTCIce(candidate) {
    if (state.peerConnection && candidate) {
      try {
        await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.error('ICE candidate error on laptop:', e);
      }
    }
  }

  // --- Dynamic Aspect Ratio Calibration ---
  function applyDynamicCalibration(dims) {
    if (!dims || !phoneFrame) return;
    const width = dims.innerWidth || dims.screenWidth;
    const height = dims.innerHeight || dims.screenHeight;
    if (width && height && width > 0 && height > 0) {
      state.phoneDimensions = dims;
      const ratio = width / height;
      const baseHeight = phoneFrame.classList.contains('landscape') ? 340 : 660;
      const computedWidth = Math.round(baseHeight * ratio);
      
      // Dynamically fit laptop frame to phone's exact physical aspect ratio
      phoneFrame.style.width = `${computedWidth}px`;
      phoneFrame.style.height = `${baseHeight}px`;

      const calibBadge = document.getElementById('calib-badge');
      if (calibBadge) {
        calibBadge.textContent = `${width}×${height} (Calibrated 1:1)`;
        calibBadge.className = 'badge badge-green';
      }
    }
  }

  // --- Live DOM / Sandbox Mirror Rendering ---
  let lastHtml = '';
  function renderDOMMirrorSnapshot(msg) {
    if (state.mirrorMode === 'webrtc') return; // WebRTC has priority if active

    if (mirrorIframe && msg.html) {
      if (lastHtml !== msg.html) {
        lastHtml = msg.html;
        mirrorIframe.srcdoc = msg.html;
      }
      
      mirrorIframe.style.display = 'block';
      if (mirrorPlaceholder) mirrorPlaceholder.style.display = 'none';
      if (mirrorVideo) mirrorVideo.style.display = 'none';
      state.mirrorMode = 'dom';

      // Sync scroll inside iframe after render
      setTimeout(() => {
        try {
          if (mirrorIframe.contentWindow) {
            mirrorIframe.contentWindow.scrollTo({ top: msg.scrollY, left: msg.scrollX, behavior: 'auto' });
          }
        } catch (e) {}
      }, 50);
    }
  }

  // --- Canvas Frame Snapshot Rendering ---
  function renderCanvasFrame(msg) {
    if (state.mirrorMode === 'webrtc') return;

    if (mirrorCanvas && msg.frame) {
      const img = new Image();
      img.onload = () => {
        mirrorCanvas.width = img.width;
        mirrorCanvas.height = img.height;
        const ctx = mirrorCanvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        mirrorCanvas.style.display = 'block';
        if (mirrorPlaceholder) mirrorPlaceholder.style.display = 'none';
      };
      img.src = msg.frame;
    }
  }

  function resetMirrorView() {
    if (mirrorVideo) {
      mirrorVideo.srcObject = null;
      mirrorVideo.style.display = 'none';
    }
    if (mirrorIframe) {
      mirrorIframe.srcdoc = '';
      mirrorIframe.style.display = 'none';
    }
    if (mirrorCanvas) {
      mirrorCanvas.style.display = 'none';
    }
    if (mirrorPlaceholder) {
      mirrorPlaceholder.style.display = 'flex';
    }
    if (state.peerConnection) {
      state.peerConnection.close();
      state.peerConnection = null;
    }
    state.mirrorMode = 'none';
  }

  // --- Bi-directional Remote Touch & Click Control (Laptop -> Phone) ---
  function setupDeviceFrameInteractions() {
    if (!phoneScreen) return;

    // 1. Mouse Click & Drag on Frame
    phoneScreen.addEventListener('click', (e) => {
      if (state.laserActive) return;

      const rect = phoneScreen.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      const normalizedX = Math.max(0, Math.min(1, clickX / rect.width));
      const normalizedY = Math.max(0, Math.min(1, clickY / rect.height));

      // Visual click ripple on laptop
      showLaptopClickDot(clickX, clickY);

      // Send to Phone
      sendWS({
        type: 'remote_click',
        x: normalizedX,
        y: normalizedY,
        clientX: clickX,
        clientY: clickY
      });
    });

    // 2. Mouse Wheel Scroll on Frame
    phoneScreen.addEventListener('wheel', (e) => {
      e.preventDefault();
      sendWS({
        type: 'remote_scroll',
        deltaY: e.deltaY,
        deltaX: e.deltaX
      });
    }, { passive: false });

    // 3. Laser Pointer Tool Movement
    phoneScreen.addEventListener('mousemove', (e) => {
      if (!state.laserActive) return;
      const rect = phoneScreen.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;

      sendWS({
        type: 'draw_event',
        action: 'move',
        x: Math.max(0, Math.min(1, x)),
        y: Math.max(0, Math.min(1, y))
      });
    });

    phoneScreen.addEventListener('mouseleave', () => {
      if (state.laserActive) {
        sendWS({ type: 'draw_event', action: 'hide' });
      }
    });
  }

  function showLaptopClickDot(x, y) {
    if (!touchLayer) return;
    const dot = document.createElement('div');
    dot.className = 'laptop-click-dot';
    dot.style.left = `${x}px`;
    dot.style.top = `${y}px`;
    touchLayer.appendChild(dot);
    setTimeout(() => {
      if (dot.parentNode) dot.parentNode.removeChild(dot);
    }, 400);
  }

  // --- Live Phone Touch Tracker (Phone -> Laptop) ---
  let activeFingerDot = null;
  function renderPhoneFingerTouch(msg) {
    if (!touchLayer || !phoneScreen) return;
    const rect = phoneScreen.getBoundingClientRect();

    if (msg.action === 'start' || msg.action === 'move') {
      if (!activeFingerDot) {
        activeFingerDot = document.createElement('div');
        activeFingerDot.className = 'phone-finger-dot';
        touchLayer.appendChild(activeFingerDot);
      }
      activeFingerDot.style.display = 'block';
      activeFingerDot.style.left = `${msg.x * rect.width}px`;
      activeFingerDot.style.top = `${msg.y * rect.height}px`;
    } else if (msg.action === 'end') {
      if (activeFingerDot) {
        activeFingerDot.style.display = 'none';
      }
    }
  }

  function handlePhoneScrollSync(msg) {
    if (mirrorIframe && mirrorIframe.contentWindow && state.mirrorMode === 'dom') {
      try {
        mirrorIframe.contentWindow.scrollTo({ top: msg.scrollY, left: msg.scrollX, behavior: 'auto' });
      } catch (e) {}
    }
  }

  // --- Screenshot & Screen Recording ---
  function setupCaptureTools() {
    const btnScreenshot = document.getElementById('btn-screenshot');
    const btnRecord = document.getElementById('btn-record');

    if (btnScreenshot) {
      btnScreenshot.addEventListener('click', captureScreenshot);
    }

    if (btnRecord) {
      btnRecord.addEventListener('click', toggleScreenRecording);
    }
  }

  function captureScreenshot() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (mirrorVideo && mirrorVideo.style.display !== 'none' && mirrorVideo.videoWidth > 0) {
      canvas.width = mirrorVideo.videoWidth;
      canvas.height = mirrorVideo.videoHeight;
      ctx.drawImage(mirrorVideo, 0, 0, canvas.width, canvas.height);
    } else {
      const rect = phoneScreen.getBoundingClientRect();
      canvas.width = rect.width * 2;
      canvas.height = rect.height * 2;
      ctx.fillStyle = '#090d16';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#38bdf8';
      ctx.font = '24px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('OmniDebug Snapshot', canvas.width / 2, canvas.height / 2);
    }

    const a = document.createElement('a');
    a.download = `omnidebug_snapshot_${Date.now()}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  }

  function toggleScreenRecording() {
    const btnRecord = document.getElementById('btn-record');
    if (!state.isRecording) {
      if (!mirrorVideo || !mirrorVideo.srcObject) {
        alert('Start WebRTC Screen Mirror on the phone first to record video!');
        return;
      }

      state.recordedChunks = [];
      const stream = mirrorVideo.srcObject;
      state.mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });

      state.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) state.recordedChunks.push(e.data);
      };

      state.mediaRecorder.onstop = () => {
        const blob = new Blob(state.recordedChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `omnidebug_recording_${Date.now()}.webm`;
        a.click();
      };

      state.mediaRecorder.start();
      state.isRecording = true;
      if (btnRecord) {
        btnRecord.classList.add('active');
        btnRecord.innerHTML = `<svg width="12" height="12" fill="#ef4444" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg> Recording...`;
      }
    } else {
      if (state.mediaRecorder) state.mediaRecorder.stop();
      state.isRecording = false;
      if (btnRecord) {
        btnRecord.classList.remove('active');
        btnRecord.innerHTML = `<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg> Record`;
      }
    }
  }

  // --- Device Controls ---
  function setupDeviceControls() {
    // Rotate
    const btnRotate = document.getElementById('btn-rotate-phone');
    if (btnRotate) {
      btnRotate.addEventListener('click', () => {
        if (phoneFrame) phoneFrame.classList.toggle('landscape');
      });
    }

    // Laser Pointer Toggle
    const btnLaser = document.getElementById('btn-laser-tool');
    if (btnLaser) {
      btnLaser.addEventListener('click', () => {
        state.laserActive = !state.laserActive;
        btnLaser.classList.toggle('active', state.laserActive);
        if (phoneScreen) {
          phoneScreen.style.cursor = state.laserActive ? 'crosshair' : 'default';
        }
        if (!state.laserActive) {
          sendWS({ type: 'draw_event', action: 'hide' });
        }
      });
    }

    // Reload Phone
    const btnReload = document.getElementById('btn-reload-phone');
    if (btnReload) {
      btnReload.addEventListener('click', () => {
        sendWS({ type: 'eval_request', id: 'reload', code: 'window.location.reload()' });
      });
    }

    // Quick Vibrate
    const btnVibrate = document.getElementById('btn-quick-vibrate');
    if (btnVibrate) {
      btnVibrate.addEventListener('click', () => {
        sendWS({ type: 'vibrate_cmd', pattern: [200, 100, 200] });
      });
    }

    // URL Navigation
    const urlInput = document.getElementById('device-url-input');
    const btnNavigate = document.getElementById('btn-navigate-url');
    const doNavigate = () => {
      const targetUrl = urlInput ? urlInput.value.trim() : '';
      if (targetUrl) {
        sendWS({ type: 'remote_navigate', url: targetUrl });
      }
    };
    if (btnNavigate) btnNavigate.addEventListener('click', doNavigate);
    if (urlInput) {
      urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doNavigate();
      });
    }
  }

  // --- Storage Tab Logic ---
  function handleStorageData(msg) {
    state.storageData = msg;
    renderStorageTable();
  }

  function renderStorageTable() {
    const tableBody = document.getElementById('storage-table-body');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    const currentData = state.storageData[state.activeStorageType] || {};

    if (state.activeStorageType === 'cookies') {
      const cookieStr = typeof currentData === 'string' ? currentData : '';
      const pairs = cookieStr.split(';').map(s => s.trim()).filter(Boolean);
      pairs.forEach(pair => {
        const [k, ...v] = pair.split('=');
        appendStorageRow(tableBody, k, v.join('='), false);
      });
    } else {
      for (const [k, v] of Object.entries(currentData)) {
        appendStorageRow(tableBody, k, v, true);
      }
    }
  }

  function appendStorageRow(tbody, key, val, editable) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="color:#fbbf24;font-family:var(--font-mono);font-size:12px;">${escapeHTML(key)}</td>
      <td style="color:#cbd5e1;font-family:var(--font-mono);font-size:12px;max-width:300px;word-break:break-all;">${escapeHTML(String(val))}</td>
      <td style="text-align:right;">
        ${editable ? `<button class="tool-btn btn-del" style="color:#f43f5e;" data-key="${escapeHTML(key)}">Delete</button>` : ''}
      </td>
    `;

    const delBtn = tr.querySelector('.btn-del');
    if (delBtn) {
      delBtn.addEventListener('click', () => {
        sendWS({
          type: 'storage_remove',
          storageType: state.activeStorageType,
          key: key
        });
      });
    }

    tbody.appendChild(tr);
  }

  function setupStorageTab() {
    const subtabs = document.querySelectorAll('.storage-subtab-btn');
    subtabs.forEach(btn => {
      btn.addEventListener('click', () => {
        subtabs.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.activeStorageType = btn.dataset.storageType;
        renderStorageTable();
      });
    });

    const btnAdd = document.getElementById('storage-btn-add');
    if (btnAdd) {
      btnAdd.addEventListener('click', () => {
        const key = prompt('Enter key name:');
        if (!key) return;
        const val = prompt('Enter value:');
        sendWS({
          type: 'storage_set',
          storageType: state.activeStorageType,
          key: key,
          value: val || ''
        });
      });
    }

    const btnClearAll = document.getElementById('storage-btn-clear-all');
    if (btnClearAll) {
      btnClearAll.addEventListener('click', () => {
        if (confirm(`Clear all ${state.activeStorageType}?`)) {
          sendWS({
            type: 'storage_clear',
            storageType: state.activeStorageType
          });
        }
      });
    }
  }

  // --- DevTools Main Tab Switching ---
  function setupTabNavigation() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');

    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.dataset.tab;
        tabBtns.forEach(b => b.classList.remove('active'));
        tabPanes.forEach(p => p.classList.remove('active'));

        btn.classList.add('active');
        const activePane = document.getElementById(`tab-${targetTab}`);
        if (activePane) activePane.classList.add('active');
      });
    });
  }

  // --- QR Code Modal Management ---
  function showQRModal() {
    if (qrModal) qrModal.classList.add('show');
  }

  function hideQRModal() {
    if (qrModal) qrModal.classList.remove('show');
  }

  function setupQRModal() {
    const btnOpen = document.getElementById('btn-show-qr');
    const btnClose = document.getElementById('modal-qr-close');
    const btnCopy = document.getElementById('btn-copy-url');

    if (btnOpen) btnOpen.addEventListener('click', showQRModal);
    if (btnClose) btnClose.addEventListener('click', hideQRModal);
    if (qrModal) {
      qrModal.addEventListener('click', (e) => {
        if (e.target === qrModal) hideQRModal();
      });
    }

    if (btnCopy && qrUrlText) {
      btnCopy.addEventListener('click', () => {
        qrUrlText.select();
        navigator.clipboard.writeText(qrUrlText.value);
        btnCopy.textContent = 'Copied!';
        setTimeout(() => { btnCopy.textContent = 'Copy'; }, 1800);
      });
    }

    const btnProtoHttps = document.getElementById('btn-qr-proto-https');
    const btnProtoHttp = document.getElementById('btn-qr-proto-http');

    if (btnProtoHttps) {
      btnProtoHttps.addEventListener('click', () => {
        btnProtoHttps.classList.add('active');
        if (btnProtoHttp) btnProtoHttp.classList.remove('active');
        loadNetworkInfo(null, 'https');
      });
    }

    if (btnProtoHttp) {
      btnProtoHttp.addEventListener('click', () => {
        btnProtoHttp.classList.add('active');
        if (btnProtoHttps) btnProtoHttps.classList.remove('active');
        loadNetworkInfo(null, 'http');
      });
    }

    if (networkSelect) {
      networkSelect.addEventListener('change', (e) => {
        loadNetworkInfo(e.target.value);
      });
    }
  }

  // --- Android Wireless ADB Controller Logic ---
  let adbPollInterval = null;

  async function refreshAdb() {
    try {
      const res = await fetch('/api/adb/status');
      const data = await res.json();
      
      const adbText = document.getElementById('adb-status-text');
      const adbDot = document.getElementById('adb-status-dot');
      const adbBadge = document.getElementById('adb-active-badge');
      const select = document.getElementById('adb-device-select');

      if (!data.available) {
        if (adbText) adbText.textContent = 'ADB: Not Available';
        if (adbDot) adbDot.style.background = '#f43f5e';
        if (adbBadge) {
          adbBadge.textContent = 'ADB Missing';
          adbBadge.className = 'badge badge-red';
        }
        return;
      }

      const devices = data.devices || [];
      if (select) {
        select.innerHTML = '';
        if (devices.length === 0) {
          select.innerHTML = '<option value="">(No devices connected)</option>';
        } else {
          devices.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.serial;
            opt.textContent = `${d.model} (${d.serial})${d.isWireless ? ' 📶' : ' 🔌'}`;
            if (d.serial === data.activeDevice) opt.selected = true;
            select.appendChild(opt);
          });
        }
      }

      if (data.activeDevice) {
        state.activeAdbDevice = data.activeDevice;
        if (data.resolution) {
          applyDynamicCalibration({ innerWidth: data.resolution.width, innerHeight: data.resolution.height });
        }
        if (adbText) adbText.textContent = `ADB: ${data.activeDevice}`;
        if (adbDot) adbDot.style.background = '#10b981';
        if (adbBadge) {
          adbBadge.textContent = `Connected: ${data.activeDevice}`;
          adbBadge.className = 'badge badge-green';
        }
      } else {
        state.activeAdbDevice = null;
        if (adbText) adbText.textContent = devices.length > 0 ? 'ADB: Select Device' : 'ADB: No Device';
        if (adbDot) adbDot.style.background = devices.length > 0 ? '#f59e0b' : '#64748b';
        if (adbBadge) {
          adbBadge.textContent = devices.length > 0 ? 'Device Available' : 'No Devices';
          adbBadge.className = 'badge badge-yellow';
        }
      }
    } catch (e) {
      console.warn('ADB status poll error:', e);
    }
  }

  function setupAdbController() {
    refreshAdb();
    adbPollInterval = setInterval(refreshAdb, 4000);

    // Click pill to open Whole Phone OS tab
    const pill = document.getElementById('adb-status-pill');
    if (pill) {
      pill.addEventListener('click', () => {
        const tabBtn = document.querySelector('.tab-btn[data-tab="os-mirror"]');
        if (tabBtn) tabBtn.click();
      });
    }

    // Refresh button
    const btnRefresh = document.getElementById('btn-adb-refresh');
    if (btnRefresh) btnRefresh.addEventListener('click', refreshAdb);

    // Device selector change
    const select = document.getElementById('adb-device-select');
    if (select) {
      select.addEventListener('change', async (e) => {
        if (!e.target.value) return;
        await fetch('/api/adb/select-device', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serial: e.target.value })
        });
        refreshAdb();
      });
    }

    // Connect button
    const btnConnect = document.getElementById('btn-adb-connect-submit');
    if (btnConnect) {
      btnConnect.addEventListener('click', async () => {
        const ip = (document.getElementById('adb-connect-ip') || {}).value;
        const port = (document.getElementById('adb-connect-port') || {}).value || '5555';
        if (!ip) return alert('Enter Android device IP address');
        btnConnect.textContent = 'Connecting...';
        try {
          const res = await fetch('/api/adb/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ip, port })
          });
          const d = await res.json();
          alert(d.result || 'Connected');
          refreshAdb();
        } catch (e) {
          alert('Connect failed: ' + e.message);
        } finally {
          btnConnect.textContent = 'Connect';
        }
      });
    }

    // Pair button
    const btnPair = document.getElementById('btn-adb-pair-submit');
    if (btnPair) {
      btnPair.addEventListener('click', async () => {
        const ip = (document.getElementById('adb-pair-ip') || {}).value;
        const port = (document.getElementById('adb-pair-port') || {}).value;
        const code = (document.getElementById('adb-pair-code') || {}).value;
        if (!ip || !port || !code) return alert('Enter IP, Port, and 6-digit PIN');
        btnPair.textContent = 'Pairing...';
        try {
          const res = await fetch('/api/adb/pair', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ip, port, code })
          });
          const d = await res.json();
          alert(d.result || 'Paired successfully!');
          refreshAdb();
        } catch (e) {
          alert('Pair failed: ' + e.message);
        } finally {
          btnPair.textContent = 'Pair';
        }
      });
    }

    // Switch USB to Wireless (tcpip 5555)
    const btnTcpip = document.getElementById('btn-adb-tcpip');
    if (btnTcpip) {
      btnTcpip.addEventListener('click', async () => {
        btnTcpip.textContent = 'Switching...';
        try {
          const res = await fetch('/api/adb/tcpip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ port: 5555 })
          });
          const d = await res.json();
          alert(d.result || 'Wireless mode enabled on port 5555! You can now unplug USB and connect to phone IP.');
          refreshAdb();
        } catch (e) {
          alert('Error: ' + e.message);
        } finally {
          btnTcpip.textContent = '⚡ Switch USB to Wireless (5555)';
        }
      });
    }

    // Disconnect
    const btnDisconnect = document.getElementById('btn-adb-disconnect');
    if (btnDisconnect) {
      btnDisconnect.addEventListener('click', async () => {
        await fetch('/api/adb/disconnect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target: state.activeAdbDevice })
        });
        refreshAdb();
      });
    }

    // Android Navigation Hardware Buttons
    const sendAdbKey = async (key) => {
      await fetch('/api/adb/key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key })
      });
    };

    const btnBack = document.getElementById('btn-adb-back');
    const btnHome = document.getElementById('btn-adb-home');
    const btnRecents = document.getElementById('btn-adb-recents');
    const btnPower = document.getElementById('btn-adb-power');

    if (btnBack) btnBack.addEventListener('click', () => sendAdbKey('back'));
    if (btnHome) btnHome.addEventListener('click', () => sendAdbKey('home'));
    if (btnRecents) btnRecents.addEventListener('click', () => sendAdbKey('recents'));
    if (btnPower) btnPower.addEventListener('click', () => sendAdbKey('power'));
  }

  function startPingInterval() {
    setInterval(() => {
      sendWS({ type: 'ping', timestamp: Date.now() });
    }, 2500);
  }

  function updateStatus(status, text) {
    if (statusBadge) {
      statusBadge.className = `status-pill status-${status}`;
    }
    if (statusText) {
      statusText.textContent = text;
    }
  }

  function escapeHTML(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // Master Initializer
  window.addEventListener('DOMContentLoaded', () => {
    loadNetworkInfo();
    setupDeviceFrameInteractions();
    setupCaptureTools();
    setupDeviceControls();
    setupTabNavigation();
    setupStorageTab();
    setupQRModal();
    setupAdbController();
  });

  window.OmniDashboard = {
    state,
    sendWS,
    showQRModal,
    hideQRModal
  };
})();
