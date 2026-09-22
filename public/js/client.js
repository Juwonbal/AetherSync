/**
 * OmniDebug - Mobile Client Core
 * Handles WebSocket Connection, WebRTC Screen Sharing, Canvas/DOM Mirror Fallback,
 * Bi-directional Touch/Scroll Sync, REPL & Telemetry
 */

(function() {
  'use strict';

  // Extract Session ID & PIN from URL
  const urlParams = new URLSearchParams(window.location.search);
  const sessionId = urlParams.get('session');
  const sessionPin = urlParams.get('pin');

  const state = {
    ws: null,
    peerConnection: null,
    localStream: null,
    isPaired: false,
    screenSharingActive: false,
    mirrorMode: 'none', // 'webrtc' | 'dom_canvas' | 'none'
    sessionId: sessionId || 'DEMO',
    pin: sessionPin || '',
    canvasStreamingInterval: null,
    mutationObserver: null
  };

  // DOM Elements
  const statusBadge = document.getElementById('status-badge');
  const statusText = document.getElementById('status-text');
  const pingBadge = document.getElementById('ping-badge');
  const btnShareScreen = document.getElementById('btn-share-screen');
  const btnStopShare = document.getElementById('btn-stop-share');
  const touchRippleContainer = document.getElementById('touch-ripple-container');
  const toastElement = document.getElementById('toast-element');

  function showToast(msg) {
    if (!toastElement) return;
    toastElement.textContent = msg;
    toastElement.classList.add('show');
    setTimeout(() => {
      toastElement.classList.remove('show');
    }, 2500);
  }

  // WebSocket Connection
  function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    state.ws = new WebSocket(wsUrl);

    state.ws.onopen = () => {
      updateStatus('connected', 'Connecting to Laptop...');
      sendWS({
        type: 'join',
        role: 'mobile',
        sessionId: state.sessionId,
        pin: state.pin,
        deviceInfo: getDeviceInfo()
      });
      
      // Initialize Interceptor
      if (window.OmniInterceptor) {
        window.OmniInterceptor.init(sendWS);
        setTimeout(() => {
          window.OmniInterceptor.sendDOMUpdate();
          window.OmniInterceptor.sendStorageData();
        }, 500);
      }

      startPingInterval();
      startTelemetryBroadcaster();
      initDOMMirrorObserver();
    };

    state.ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleMessage(msg);
      } catch (err) {
        console.error('Error parsing message:', err);
      }
    };

    state.ws.onclose = () => {
      updateStatus('disconnected', 'Disconnected. Reconnecting...');
      state.isPaired = false;
      setTimeout(initWebSocket, 2000);
    };

    state.ws.onerror = (err) => {
      console.error('WebSocket Error:', err);
    };
  }

  function sendWS(data) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify(data));
    }
  }

  // Handle messages received from Laptop
  async function handleMessage(msg) {
    switch (msg.type) {
      case 'joined': {
        if (msg.paired) {
          updateStatus('paired', 'Paired with Laptop');
          state.isPaired = true;
          sendTelemetry();
          sendLiveDOMSnapshot();
        } else {
          updateStatus('waiting', 'Waiting for Laptop...');
        }
        break;
      }

      case 'peer_connected': {
        updateStatus('paired', 'Paired with Laptop');
        state.isPaired = true;
        sendTelemetry();
        sendLiveDOMSnapshot();
        if (window.OmniInterceptor) {
          window.OmniInterceptor.sendDOMUpdate();
          window.OmniInterceptor.sendStorageData();
        }
        break;
      }

      case 'peer_disconnected': {
        updateStatus('waiting', 'Laptop Disconnected');
        state.isPaired = false;
        break;
      }

      case 'pong': {
        const latency = Math.round((Date.now() - msg.timestamp) / 2);
        if (pingBadge) {
          pingBadge.textContent = `${latency} ms`;
          pingBadge.className = `badge ${latency < 60 ? 'badge-green' : latency < 150 ? 'badge-yellow' : 'badge-red'}`;
        }
        break;
      }

      // WebRTC Signaling
      case 'webrtc_offer': {
        await handleWebRTCOffer(msg.offer);
        break;
      }

      case 'webrtc_answer': {
        await handleWebRTCAnswer(msg.answer);
        break;
      }

      case 'webrtc_ice': {
        await handleWebRTCIce(msg.candidate);
        break;
      }

      // Bi-directional Remote Controls from Laptop -> Phone
      case 'remote_click': {
        executeRemoteClick(msg.x, msg.y, msg.clientX, msg.clientY);
        break;
      }

      case 'remote_scroll': {
        executeRemoteScroll(msg.scrollX, msg.scrollY, msg.deltaX, msg.deltaY);
        break;
      }

      case 'remote_input': {
        executeRemoteInput(msg.text, msg.key);
        break;
      }

      case 'remote_navigate': {
        if (msg.url) {
          window.location.href = msg.url;
        }
        break;
      }

      // DevTools Commands
      case 'eval_request': {
        executeEval(msg.id, msg.code);
        break;
      }

      case 'dom_request': {
        if (window.OmniInterceptor) {
          window.OmniInterceptor.sendDOMUpdate();
        }
        sendLiveDOMSnapshot();
        break;
      }

      case 'dom_highlight': {
        if (window.OmniInterceptor) {
          window.OmniInterceptor.highlightElement(msg.selector, msg.nodeDebugId);
        }
        break;
      }

      case 'dom_update_style': {
        if (window.OmniInterceptor) {
          window.OmniInterceptor.updateElementStyle(msg.selector, msg.styles);
        }
        break;
      }

      case 'storage_request': {
        if (window.OmniInterceptor) {
          window.OmniInterceptor.sendStorageData();
        }
        break;
      }

      case 'storage_set': {
        if (window.OmniInterceptor) {
          window.OmniInterceptor.setStorageItem(msg.storageType, msg.key, msg.value);
        }
        break;
      }

      case 'storage_remove': {
        if (window.OmniInterceptor) {
          window.OmniInterceptor.removeStorageItem(msg.storageType, msg.key);
        }
        break;
      }

      case 'storage_clear': {
        if (window.OmniInterceptor) {
          window.OmniInterceptor.clearStorage(msg.storageType);
        }
        break;
      }

      case 'vibrate_cmd': {
        if (navigator.vibrate) {
          navigator.vibrate(msg.pattern || [200, 100, 200]);
        }
        break;
      }

      case 'draw_event': {
        renderDrawLaser(msg);
        break;
      }
    }
  }

  // --- Remote Execution / REPL ---
  function executeEval(reqId, code) {
    try {
      const result = window.eval(code);
      const serialized = window.OmniInterceptor ? window.OmniInterceptor.serialize(result) : { type: typeof result, value: String(result) };
      sendWS({
        type: 'eval_response',
        id: reqId,
        success: true,
        result: serialized
      });
      // Sync DOM state if changed
      setTimeout(sendLiveDOMSnapshot, 100);
    } catch (err) {
      sendWS({
        type: 'eval_response',
        id: reqId,
        success: false,
        error: {
          name: err.name,
          message: err.message,
          stack: err.stack
        }
      });
    }
  }

  // --- Remote Touch / Click Execution ---
  function executeRemoteClick(normalizedX, normalizedY) {
    const pxX = normalizedX * window.innerWidth;
    const pxY = normalizedY * window.innerHeight;

    // Show visual touch ripple on mobile
    showTouchRipple(pxX, pxY);

    // Find target element and dispatch events
    const target = document.elementFromPoint(pxX, pxY);
    if (target) {
      const clickOpts = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: pxX,
        clientY: pxY,
        screenX: pxX,
        screenY: pxY
      };

      target.dispatchEvent(new MouseEvent('mousedown', clickOpts));
      target.dispatchEvent(new MouseEvent('mouseup', clickOpts));
      target.dispatchEvent(new MouseEvent('click', clickOpts));

      // Handle Form input focus
      if (typeof target.focus === 'function') {
        target.focus();
      }

      // Sync updated DOM state after click
      setTimeout(sendLiveDOMSnapshot, 80);
    }
  }

  function executeRemoteScroll(scrollXRatio, scrollYRatio, deltaX, deltaY) {
    if (deltaY !== undefined) {
      window.scrollBy({ top: deltaY, left: deltaX || 0, behavior: 'auto' });
    } else if (scrollYRatio !== undefined) {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const targetY = scrollYRatio * maxScroll;
      window.scrollTo({ top: targetY, behavior: 'auto' });
    }
  }

  function executeRemoteInput(text, key) {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
      if (key === 'Backspace') {
        if (activeEl.isContentEditable) {
          document.execCommand('delete');
        } else {
          activeEl.value = activeEl.value.slice(0, -1);
        }
      } else if (text) {
        if (activeEl.isContentEditable) {
          document.execCommand('insertText', false, text);
        } else {
          activeEl.value += text;
        }
      }
      activeEl.dispatchEvent(new Event('input', { bubbles: true }));
      activeEl.dispatchEvent(new Event('change', { bubbles: true }));
      setTimeout(sendLiveDOMSnapshot, 80);
    }
  }

  function showTouchRipple(x, y) {
    if (!touchRippleContainer) return;
    const ripple = document.createElement('div');
    ripple.className = 'touch-ripple';
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    touchRippleContainer.appendChild(ripple);
    setTimeout(() => {
      if (ripple.parentNode) ripple.parentNode.removeChild(ripple);
    }, 600);
  }

  // --- Phone -> Laptop Event Listeners ---
  // 1. Scroll listener (throttle to ~30fps)
  let lastScrollTime = 0;
  window.addEventListener('scroll', () => {
    const now = Date.now();
    if (now - lastScrollTime > 30) {
      lastScrollTime = now;
      const maxScrollY = document.documentElement.scrollHeight - window.innerHeight;
      const maxScrollX = document.documentElement.scrollWidth - window.innerWidth;
      
      sendWS({
        type: 'phone_scroll',
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        scrollRatioX: maxScrollX > 0 ? window.scrollX / maxScrollX : 0,
        scrollRatioY: maxScrollY > 0 ? window.scrollY / maxScrollY : 0,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        documentHeight: document.documentElement.scrollHeight
      });
    }
  }, { passive: true });

  // 2. Touch pointer listener (render live finger tracker on laptop)
  window.addEventListener('touchstart', (e) => {
    if (e.touches.length > 0) {
      const touch = e.touches[0];
      sendWS({
        type: 'phone_touch',
        action: 'start',
        x: touch.clientX / window.innerWidth,
        y: touch.clientY / window.innerHeight,
        clientX: touch.clientX,
        clientY: touch.clientY
      });
    }
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (e.touches.length > 0) {
      const touch = e.touches[0];
      sendWS({
        type: 'phone_touch',
        action: 'move',
        x: touch.clientX / window.innerWidth,
        y: touch.clientY / window.innerHeight,
        clientX: touch.clientX,
        clientY: touch.clientY
      });
    }
  }, { passive: true });

  window.addEventListener('touchend', () => {
    sendWS({
      type: 'phone_touch',
      action: 'end'
    });
    setTimeout(sendLiveDOMSnapshot, 100);
  }, { passive: true });

  // --- Live DOM & Canvas Mirroring Streamer ---
  function sendLiveDOMSnapshot() {
    try {
      const clone = document.documentElement.cloneNode(true);
      
      // 1. Remove all scripts so they do NOT re-execute inside laptop iframe
      clone.querySelectorAll('script').forEach(s => s.remove());

      // 2. Remove system overlays from clone
      const high = clone.querySelector('#omni-debug-highlighter');
      if (high) high.remove();
      const ripples = clone.querySelector('#touch-ripple-container');
      if (ripples) ripples.innerHTML = '';

      // 3. Inject <base> tag into <head> so stylesheets and relative resources load correctly
      let head = clone.querySelector('head');
      if (!head) {
        head = document.createElement('head');
        clone.insertBefore(head, clone.firstChild);
      }
      const base = document.createElement('base');
      base.href = window.location.origin + '/';
      head.insertBefore(base, head.firstChild);

      // 4. Inject iframe styling to remove scrollbars and guarantee clean fit
      const style = document.createElement('style');
      style.textContent = `
        body {
          overflow-x: hidden !important;
          user-select: none !important;
          -webkit-user-select: none !important;
        }
        ::-webkit-scrollbar { display: none !important; }
      `;
      head.appendChild(style);

      // 5. Sync input values & checked states into HTML attributes
      const originalInputs = document.querySelectorAll('input, textarea, select');
      const clonedInputs = clone.querySelectorAll('input, textarea, select');
      originalInputs.forEach((origEl, idx) => {
        if (clonedInputs[idx]) {
          if (origEl.type === 'checkbox' || origEl.type === 'radio') {
            if (origEl.checked) clonedInputs[idx].setAttribute('checked', 'checked');
            else clonedInputs[idx].removeAttribute('checked');
          } else {
            clonedInputs[idx].setAttribute('value', origEl.value || '');
          }
        }
      });

      sendWS({
        type: 'dom_mirror_update',
        html: clone.outerHTML,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight
      });
    } catch (e) {
      console.warn('DOM snapshot failed:', e);
    }
  }

  function initDOMMirrorObserver() {
    state.mutationObserver = new MutationObserver(() => {
      sendLiveDOMSnapshot();
    });

    state.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });
  }

  // Canvas Frame Snapshot Stream (using html2canvas)
  let isCapturingFrame = false;
  async function captureAndSendCanvasFrame() {
    if (!window.html2canvas || isCapturingFrame) return;
    isCapturingFrame = true;
    try {
      const canvas = await window.html2canvas(document.body, {
        scale: 0.6,
        useCORS: true,
        logging: false,
        backgroundColor: '#090d16',
        ignoreElements: (el) => el.id === 'omni-debug-highlighter' || el.id === 'touch-ripple-container'
      });
      const dataUrl = canvas.toDataURL('image/jpeg', 0.5);
      sendWS({
        type: 'canvas_frame',
        frame: dataUrl,
        scrollY: window.scrollY,
        scrollX: window.scrollX
      });
    } catch (e) {
      // fallback
    } finally {
      isCapturingFrame = false;
    }
  }

  function startCanvasStream() {
    state.mirrorMode = 'dom_canvas';
    state.screenSharingActive = true;
    if (btnShareScreen) btnShareScreen.style.display = 'none';
    if (btnStopShare) btnStopShare.style.display = 'inline-flex';

    sendWS({
      type: 'screen_mirror_started',
      mode: 'dom_canvas'
    });

    sendLiveDOMSnapshot();
    showToast('⚡ Live Interactive Mirror Active!');

    if (window.html2canvas) {
      captureAndSendCanvasFrame();
      state.canvasStreamingInterval = setInterval(captureAndSendCanvasFrame, 350);
    }
  }

  function stopCanvasStream() {
    if (state.canvasStreamingInterval) {
      clearInterval(state.canvasStreamingInterval);
      state.canvasStreamingInterval = null;
    }
    state.mirrorMode = 'none';
    state.screenSharingActive = false;
    if (btnShareScreen) btnShareScreen.style.display = 'inline-flex';
    if (btnStopShare) btnStopShare.style.display = 'none';
    sendWS({ type: 'screen_share_stopped' });
  }

  // --- WebRTC Screen Sharing (with Automatic Fallback) ---
  async function startScreenShare() {
    // Check if getDisplayMedia is supported
    if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
      try {
        state.localStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            displaySurface: 'browser',
            frameRate: { ideal: 30, max: 60 }
          },
          audio: false
        });

        state.screenSharingActive = true;
        state.mirrorMode = 'webrtc';
        if (btnShareScreen) btnShareScreen.style.display = 'none';
        if (btnStopShare) btnStopShare.style.display = 'inline-flex';

        await initWebRTC();
        showToast('🎥 High-FPS WebRTC Video Mirror Active');

        state.localStream.getVideoTracks()[0].onended = () => {
          stopScreenShare();
        };
        return;
      } catch (err) {
        console.warn('Native getDisplayMedia unavailable or denied. Falling back to Live DOM & Canvas stream:', err);
      }
    }

    // Seamless fallback to Live DOM & Canvas mirror (ideal for iOS Safari)
    startCanvasStream();
  }

  function stopScreenShare() {
    if (state.localStream) {
      state.localStream.getTracks().forEach(track => track.stop());
      state.localStream = null;
    }
    if (state.peerConnection) {
      state.peerConnection.close();
      state.peerConnection = null;
    }
    stopCanvasStream();
  }

  async function initWebRTC() {
    const config = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };

    state.peerConnection = new RTCPeerConnection(config);

    if (state.localStream) {
      state.localStream.getTracks().forEach(track => {
        state.peerConnection.addTrack(track, state.localStream);
      });
    }

    state.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        sendWS({
          type: 'webrtc_ice',
          candidate: event.candidate
        });
      }
    };

    const offer = await state.peerConnection.createOffer();
    await state.peerConnection.setLocalDescription(offer);

    sendWS({
      type: 'webrtc_offer',
      offer: offer
    });
  }

  async function handleWebRTCOffer(offer) {
    if (!state.peerConnection) {
      const config = {
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      };
      state.peerConnection = new RTCPeerConnection(config);
      state.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          sendWS({ type: 'webrtc_ice', candidate: event.candidate });
        }
      };
    }
    await state.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await state.peerConnection.createAnswer();
    await state.peerConnection.setLocalDescription(answer);
    sendWS({ type: 'webrtc_answer', answer: answer });
  }

  async function handleWebRTCAnswer(answer) {
    if (state.peerConnection) {
      await state.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    }
  }

  async function handleWebRTCIce(candidate) {
    if (state.peerConnection && candidate) {
      try {
        await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.error('ICE candidate error:', e);
      }
    }
  }

  // --- Laser / Drawing Overlay ---
  function renderDrawLaser(msg) {
    const laser = document.getElementById('laser-pointer-dot');
    if (!laser) {
      const dot = document.createElement('div');
      dot.id = 'laser-pointer-dot';
      dot.style.position = 'fixed';
      dot.style.width = '16px';
      dot.style.height = '16px';
      dot.style.borderRadius = '50%';
      dot.style.backgroundColor = '#ef4444';
      dot.style.boxShadow = '0 0 12px #ef4444, 0 0 24px #f87171';
      dot.style.pointerEvents = 'none';
      dot.style.zIndex = '99999999';
      dot.style.transition = 'transform 0.05s linear';
      document.body.appendChild(dot);
    }
    const dot = document.getElementById('laser-pointer-dot');
    if (msg.action === 'hide') {
      dot.style.display = 'none';
    } else {
      dot.style.display = 'block';
      dot.style.transform = `translate(${msg.x * window.innerWidth - 8}px, ${msg.y * window.innerHeight - 8}px)`;
    }
  }

  // --- Telemetry & Diagnostics ---
  function getDeviceInfo() {
    return {
      userAgent: navigator.userAgent,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      pixelRatio: window.devicePixelRatio || 1,
      platform: navigator.platform,
      language: navigator.language,
      isTouch: 'ontouchstart' in window || navigator.maxTouchPoints > 0
    };
  }

  async function sendTelemetry() {
    let batteryInfo = null;
    if (navigator.getBattery) {
      try {
        const b = await navigator.getBattery();
        batteryInfo = {
          level: Math.round(b.level * 100),
          charging: b.charging
        };
      } catch (e) {}
    }

    sendWS({
      type: 'telemetry',
      battery: batteryInfo,
      dimensions: {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
        pixelRatio: window.devicePixelRatio || 1,
        orientation: window.screen.orientation ? window.screen.orientation.type : (window.orientation === 90 || window.orientation === -90 ? 'landscape' : 'portrait')
      },
      memory: window.performance && window.performance.memory ? {
        jsHeapSizeLimit: Math.round(window.performance.memory.jsHeapSizeLimit / (1024 * 1024)),
        totalJSHeapSize: Math.round(window.performance.memory.totalJSHeapSize / (1024 * 1024)),
        usedJSHeapSize: Math.round(window.performance.memory.usedJSHeapSize / (1024 * 1024))
      } : null
    });
  }

  function startTelemetryBroadcaster() {
    sendTelemetry();
    setInterval(sendTelemetry, 4000);

    // Orientation change listener
    window.addEventListener('resize', () => {
      setTimeout(sendTelemetry, 100);
      setTimeout(sendLiveDOMSnapshot, 100);
      if (window.OmniInterceptor) {
        window.OmniInterceptor.sendDOMUpdate();
      }
    });

    // Gyroscope / Motion listener
    if (window.DeviceOrientationEvent) {
      let lastGyroTime = 0;
      window.addEventListener('deviceorientation', (e) => {
        const now = Date.now();
        if (now - lastGyroTime > 100) { // 10Hz
          lastGyroTime = now;
          sendWS({
            type: 'gyro_data',
            alpha: Math.round(e.alpha || 0),
            beta: Math.round(e.beta || 0),
            gamma: Math.round(e.gamma || 0)
          });
        }
      });
    }
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

  // Setup Button Listeners
  if (btnShareScreen) btnShareScreen.addEventListener('click', startScreenShare);
  if (btnStopShare) btnStopShare.addEventListener('click', stopScreenShare);

  // Initialize
  initWebSocket();

  // Expose helper to demo page
  window.OmniClient = {
    state,
    sendWS,
    sendTelemetry,
    sendLiveDOMSnapshot
  };
})();
