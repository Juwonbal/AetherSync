const { exec, execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Locate adb executable: prefer local bin/platform-tools/adb.exe, fallback to system PATH
function getAdbPath() {
  const localAdb = path.join(__dirname, 'bin', 'platform-tools', 'adb.exe');
  if (fs.existsSync(localAdb)) {
    return localAdb;
  }
  return 'adb';
}

function runAdb(args, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const adbPath = getAdbPath();
    execFile(adbPath, args, { timeout }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(stderr.trim() || err.message));
      }
      resolve(stdout.trim());
    });
  });
}

const AdbBridge = {
  getAdbPath,

  async isAvailable() {
    try {
      const out = await runAdb(['version']);
      return { available: true, version: out.split('\n')[0] };
    } catch (e) {
      return { available: false, error: e.message };
    }
  },

  // List connected devices (USB or Wireless)
  async getDevices() {
    try {
      const output = await runAdb(['devices', '-l']);
      const lines = output.split('\n').map(l => l.trim()).filter(Boolean);
      const devices = [];

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const parts = line.split(/\s+/);
        if (parts.length >= 2) {
          const serial = parts[0];
          const state = parts[1];
          const isWireless = /:\d+$/.test(serial);
          
          let model = 'Android Device';
          const modelMatch = line.match(/model:(\S+)/);
          if (modelMatch) model = modelMatch[1].replace(/_/g, ' ');

          devices.push({
            serial,
            state,
            isWireless,
            model,
            raw: line
          });
        }
      }
      return devices;
    } catch (err) {
      return [];
    }
  },

  // Wireless Pairing (Android 11+ pairing code)
  async pair(ip, port, code) {
    if (!ip || !port || !code) throw new Error('Missing IP, port or pairing code');
    const target = `${ip}:${port}`;
    const output = await runAdb(['pair', target, String(code)], 15000);
    return output;
  },

  // Connect wirelessly to an Android device
  async connect(ip, port = 5555) {
    if (!ip) throw new Error('Missing device IP');
    const target = `${ip}:${port}`;
    const output = await runAdb(['connect', target], 15000);
    return output;
  },

  async disconnect(target) {
    const args = target ? ['disconnect', target] : ['disconnect'];
    return await runAdb(args);
  },

  // Switch a USB-connected phone to wireless port 5555
  async enableWirelessPort(port = 5555) {
    return await runAdb(['tcpip', String(port)]);
  },

  // Get physical screen resolution (e.g. 1080x2400)
  async getScreenResolution(deviceSerial) {
    try {
      const args = deviceSerial ? ['-s', deviceSerial, 'shell', 'wm', 'size'] : ['shell', 'wm', 'size'];
      const out = await runAdb(args);
      const match = out.match(/Physical size:\s*(\d+)x(\d+)/i) || out.match(/(\d+)x(\d+)/);
      if (match) {
        return {
          width: parseInt(match[1], 10),
          height: parseInt(match[2], 10)
        };
      }
    } catch (e) {}
    return { width: 1080, height: 2400 }; // fallback default
  },

  // Touch / Tap
  async tap(x, y, deviceSerial) {
    const args = deviceSerial ? ['-s', deviceSerial, 'shell', 'input', 'tap', String(Math.round(x)), String(Math.round(y))]
                              : ['shell', 'input', 'tap', String(Math.round(x)), String(Math.round(y))];
    return await runAdb(args, 3000);
  },

  // Swipe / Drag / Scroll
  async swipe(x1, y1, x2, y2, durationMs = 250, deviceSerial) {
    const args = deviceSerial 
      ? ['-s', deviceSerial, 'shell', 'input', 'swipe', String(Math.round(x1)), String(Math.round(y1)), String(Math.round(x2)), String(Math.round(y2)), String(durationMs)]
      : ['shell', 'input', 'swipe', String(Math.round(x1)), String(Math.round(y1)), String(Math.round(x2)), String(Math.round(y2)), String(durationMs)];
    return await runAdb(args, 4000);
  },

  // Key Event (Home = 3, Back = 4, AppSwitch = 187, Power = 26, VolUp = 24, VolDown = 25)
  async sendKeyEvent(keycode, deviceSerial) {
    const args = deviceSerial ? ['-s', deviceSerial, 'shell', 'input', 'keyevent', String(keycode)]
                              : ['shell', 'input', 'keyevent', String(keycode)];
    return await runAdb(args, 3000);
  },

  // Text input
  async sendText(text, deviceSerial) {
    // Escape shell characters
    const escaped = text.replace(/([ "()$&|;<>*?~`\\])/g, '\\$1');
    const args = deviceSerial ? ['-s', deviceSerial, 'shell', 'input', 'text', escaped]
                              : ['shell', 'input', 'text', escaped];
    return await runAdb(args, 4000);
  },

  // High-speed screen capture frame
  captureScreen(deviceSerial) {
    return new Promise((resolve, reject) => {
      const adbPath = getAdbPath();
      const args = deviceSerial ? ['-s', deviceSerial, 'exec-out', 'screencap', '-p'] : ['exec-out', 'screencap', '-p'];
      const proc = spawn(adbPath, args);
      const chunks = [];

      proc.stdout.on('data', chunk => chunks.push(chunk));
      proc.stderr.on('data', err => console.error('screencap stderr:', err.toString()));
      proc.on('close', code => {
        if (code === 0) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(new Error(`Screencap failed with exit code ${code}`));
        }
      });
      proc.on('error', reject);
    });
  }
};

module.exports = AdbBridge;
