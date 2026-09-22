/**
 * OmniDebug - Laptop Dashboard: Sensors, 3D Gyroscope & Telemetry
 */

window.SensorsTab = (function() {
  'use strict';

  let sendWS = null;
  let phone3D = null;
  let gyroValues = null;

  function init(wsSender) {
    sendWS = wsSender;
    phone3D = document.getElementById('phone-3d-model');
    gyroValues = document.getElementById('gyro-values-display');

    // Setup vibration buttons
    const btnVibPulse = document.getElementById('btn-vib-pulse');
    const btnVibDouble = document.getElementById('btn-vib-double');
    const btnVibSos = document.getElementById('btn-vib-sos');
    const btnVibHeart = document.getElementById('btn-vib-heart');

    if (btnVibPulse) {
      btnVibPulse.addEventListener('click', () => triggerVibration([200]));
    }
    if (btnVibDouble) {
      btnVibDouble.addEventListener('click', () => triggerVibration([120, 80, 120]));
    }
    if (btnVibSos) {
      btnVibSos.addEventListener('click', () => triggerVibration([100, 50, 100, 50, 100, 200, 300, 100, 300, 100, 300, 200, 100, 50, 100, 50, 100]));
    }
    if (btnVibHeart) {
      btnVibHeart.addEventListener('click', () => triggerVibration([100, 150, 250, 500, 100, 150, 250]));
    }
  }

  function triggerVibration(pattern) {
    sendWS({
      type: 'vibrate_cmd',
      pattern: pattern
    });
  }

  function handleGyroData(msg) {
    const { alpha, beta, gamma } = msg;

    if (phone3D) {
      // In CSS 3D transform: rotateX is beta, rotateY is gamma, rotateZ is alpha
      phone3D.style.transform = `rotateX(${beta}deg) rotateY(${gamma}deg) rotateZ(${alpha * 0.5}deg)`;
    }

    if (gyroValues) {
      gyroValues.textContent = `α: ${alpha}° | β: ${beta}° | γ: ${gamma}°`;
    }
  }

  function handleTelemetry(msg) {
    // Battery
    if (msg.battery) {
      const batteryEl = document.getElementById('telemetry-battery-val');
      const batteryStatus = document.getElementById('telemetry-battery-status');
      if (batteryEl) {
        batteryEl.textContent = `${msg.battery.level}%`;
      }
      if (batteryStatus) {
        batteryStatus.textContent = msg.battery.charging ? '⚡ Charging' : '🔋 On Battery';
        batteryStatus.className = `badge ${msg.battery.charging ? 'badge-green' : msg.battery.level > 20 ? 'badge-yellow' : 'badge-red'}`;
      }
    }

    // Screen Dimensions
    if (msg.dimensions) {
      const resEl = document.getElementById('telemetry-res-val');
      const orientEl = document.getElementById('telemetry-orient-val');
      const dprEl = document.getElementById('telemetry-dpr-val');

      if (resEl) resEl.textContent = `${msg.dimensions.innerWidth} × ${msg.dimensions.innerHeight} px`;
      if (orientEl) orientEl.textContent = msg.dimensions.orientation;
      if (dprEl) dprEl.textContent = `@${msg.dimensions.pixelRatio}x`;
    }

    // Memory
    if (msg.memory) {
      const memEl = document.getElementById('telemetry-memory-val');
      if (memEl) {
        memEl.textContent = `${msg.memory.usedJSHeapSize} MB / ${msg.memory.totalJSHeapSize} MB`;
      }
    }
  }

  return {
    init,
    handleGyroData,
    handleTelemetry
  };
})();
