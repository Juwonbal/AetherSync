const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { WebSocketServer, WebSocket } = require('ws');
const QRCode = require('qrcode');
const cors = require('cors');
const selfsigned = require('selfsigned');
const AdbBridge = require('./adb-bridge');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const HTTP_PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;

// Certificate Generation / Storage
const certDir = path.join(__dirname, 'certs');
if (!fs.existsSync(certDir)) fs.mkdirSync(certDir, { recursive: true });

const certPath = path.join(certDir, 'cert.pem');
const keyPath = path.join(certDir, 'key.pem');

async function getSslOptions() {
  try {
    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      return {
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath)
      };
    }
    console.log('Generating SSL certificate for secure WebRTC and Android display sharing...');
    const attrs = [{ name: 'commonName', value: 'aethersync.local' }];
    const pems = await selfsigned.generate(attrs, { days: 365 });
    fs.writeFileSync(certPath, pems.cert);
    fs.writeFileSync(keyPath, pems.private);
    return {
      cert: pems.cert,
      key: pems.private
    };
  } catch (e) {
    console.warn('Could not generate self-signed certificate:', e.message);
    return null;
  }
}

// Helper to get local IPv4 addresses (Wi-Fi / Ethernet)
function getLocalNetworkAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push({
          name,
          address: iface.address,
          isWifi: /wi-?fi|wlan|wireless/i.test(name)
        });
      }
    }
  }
  
  addresses.sort((a, b) => (b.isWifi ? 1 : 0) - (a.isWifi ? 1 : 0));
  if (addresses.length === 0) {
    addresses.push({ name: 'localhost', address: '127.0.0.1', isWifi: false });
  }
  return addresses;
}

// Session store
const sessions = new Map();

function generateSessionId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function generatePin() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// Active ADB Device state
let activeAdbDevice = null;
let activeAdbResolution = { width: 1080, height: 2400 };

async function refreshAdbStatus() {
  const isAvail = await AdbBridge.isAvailable();
  if (isAvail.available) {
    const devices = await AdbBridge.getDevices();
    if (devices.length > 0 && (!activeAdbDevice || !devices.find(d => d.serial === activeAdbDevice))) {
      activeAdbDevice = devices[0].serial;
      activeAdbResolution = await AdbBridge.getScreenResolution(activeAdbDevice);
      console.log(`[ADB] Auto-selected device: ${activeAdbDevice} (${activeAdbResolution.width}x${activeAdbResolution.height})`);
    }
  }
}

// REST API for network info & QR code
app.get('/api/network-info', async (req, res) => {
  const ips = getLocalNetworkAddresses();
  const selectedIp = req.query.ip || ips[0].address;
  const protocol = req.query.protocol || 'https';
  const targetPort = protocol === 'https' ? HTTPS_PORT : HTTP_PORT;
  let sessionId = req.query.session;
  
  if (!sessionId || !sessions.has(sessionId)) {
    sessionId = generateSessionId();
    sessions.set(sessionId, {
      laptop: null,
      mobile: null,
      pin: generatePin(),
      created: Date.now()
    });
  }
  
  const session = sessions.get(sessionId);
  const mobileUrl = `${protocol}://${selectedIp}:${targetPort}/client.html?session=${sessionId}&pin=${session.pin}`;
  
  try {
    const qrDataUrl = await QRCode.toDataURL(mobileUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      scale: 8,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });
    
    res.json({
      port: HTTP_PORT,
      httpsPort: HTTPS_PORT,
      hasHttps: true,
      protocol,
      interfaces: ips,
      selectedIp,
      sessionId,
      pin: session.pin,
      mobileUrl,
      qrDataUrl
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code', details: err.message });
  }
});

// ADB REST APIs
app.get('/api/adb/status', async (req, res) => {
  const avail = await AdbBridge.isAvailable();
  const devices = avail.available ? await AdbBridge.getDevices() : [];
  res.json({
    ...avail,
    devices,
    activeDevice: activeAdbDevice,
    resolution: activeAdbResolution
  });
});

app.post('/api/adb/select-device', async (req, res) => {
  const { serial } = req.body;
  if (!serial) return res.status(400).json({ error: 'Missing serial' });
  activeAdbDevice = serial;
  activeAdbResolution = await AdbBridge.getScreenResolution(activeAdbDevice);
  res.json({ success: true, activeDevice: activeAdbDevice, resolution: activeAdbResolution });
});

app.post('/api/adb/pair', async (req, res) => {
  const { ip, port, code } = req.body;
  try {
    const result = await AdbBridge.pair(ip, port, code);
    await refreshAdbStatus();
    res.json({ success: true, result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/adb/connect', async (req, res) => {
  const { ip, port } = req.body;
  try {
    const result = await AdbBridge.connect(ip, port || 5555);
    await refreshAdbStatus();
    res.json({ success: true, result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/adb/disconnect', async (req, res) => {
  const { target } = req.body;
  try {
    const result = await AdbBridge.disconnect(target);
    if (activeAdbDevice === target) activeAdbDevice = null;
    res.json({ success: true, result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/adb/tcpip', async (req, res) => {
  const { port } = req.body;
  try {
    const result = await AdbBridge.enableWirelessPort(port || 5555);
    res.json({ success: true, result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/adb/key', async (req, res) => {
  const { key } = req.body;
  const keyMap = {
    back: 4,
    home: 3,
    recents: 187,
    appswitch: 187,
    power: 26,
    volup: 24,
    voldown: 25,
    enter: 66,
    del: 67
  };
  const code = keyMap[key] || parseInt(key, 10);
  if (!code) return res.status(400).json({ error: 'Unknown key' });
  try {
    await AdbBridge.sendKeyEvent(code, activeAdbDevice);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/adb/screencap', async (req, res) => {
  try {
    const buffer = await AdbBridge.captureScreen(activeAdbDevice);
    res.set('Content-Type', 'image/png');
    res.send(buffer);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// WebSocket Hub
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws, req) => {
  let clientSessionId = null;
  let clientRole = null; // 'laptop' | 'mobile'
  
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', async (messageRaw) => {
    try {
      const msg = JSON.parse(messageRaw.toString());
      
      switch (msg.type) {
        case 'join': {
          const { sessionId, role, pin } = msg;
          clientSessionId = sessionId;
          clientRole = role;
          
          if (!sessions.has(sessionId)) {
            sessions.set(sessionId, {
              laptop: null,
              mobile: null,
              pin: pin || generatePin(),
              created: Date.now()
            });
          }
          
          const session = sessions.get(sessionId);
          
          if (role === 'laptop') {
            session.laptop = ws;
            ws.send(JSON.stringify({
              type: 'joined',
              role: 'laptop',
              sessionId,
              pin: session.pin,
              paired: !!(session.mobile && session.mobile.readyState === WebSocket.OPEN),
              activeAdbDevice
            }));
            
            if (session.mobile && session.mobile.readyState === WebSocket.OPEN) {
              session.mobile.send(JSON.stringify({ type: 'peer_connected', role: 'laptop' }));
            }
          } else if (role === 'mobile') {
            session.mobile = ws;
            ws.send(JSON.stringify({
              type: 'joined',
              role: 'mobile',
              sessionId,
              paired: !!(session.laptop && session.laptop.readyState === WebSocket.OPEN)
            }));
            
            if (session.laptop && session.laptop.readyState === WebSocket.OPEN) {
              session.laptop.send(JSON.stringify({
                type: 'peer_connected',
                role: 'mobile',
                deviceInfo: msg.deviceInfo || {}
              }));
            }
          }
          break;
        }
        
        case 'ping': {
          ws.send(JSON.stringify({ type: 'pong', timestamp: msg.timestamp }));
          break;
        }

        // Forward and handle Touch / Click via ADB if device is active
        case 'remote_click': {
          if (activeAdbDevice && msg.x !== undefined && msg.y !== undefined) {
            const tapX = msg.x * activeAdbResolution.width;
            const tapY = msg.y * activeAdbResolution.height;
            AdbBridge.tap(tapX, tapY, activeAdbDevice).catch(e => console.warn('ADB tap error:', e.message));
          }
          forwardToPeer(clientSessionId, clientRole, messageRaw);
          break;
        }

        case 'remote_scroll': {
          if (activeAdbDevice) {
            const midX = activeAdbResolution.width / 2;
            const midY = activeAdbResolution.height / 2;
            const scrollDist = (msg.deltaY || 0) * 1.8;
            const endY = Math.max(100, Math.min(activeAdbResolution.height - 100, midY - scrollDist));
            AdbBridge.swipe(midX, midY, midX, endY, 200, activeAdbDevice).catch(e => {});
          }
          forwardToPeer(clientSessionId, clientRole, messageRaw);
          break;
        }

        case 'remote_input': {
          if (activeAdbDevice && msg.text) {
            AdbBridge.sendText(msg.text, activeAdbDevice).catch(e => {});
          } else if (activeAdbDevice && msg.key === 'Backspace') {
            AdbBridge.sendKeyEvent(67, activeAdbDevice).catch(e => {});
          }
          forwardToPeer(clientSessionId, clientRole, messageRaw);
          break;
        }

        case 'adb_key_event': {
          if (activeAdbDevice && msg.keycode) {
            AdbBridge.sendKeyEvent(msg.keycode, activeAdbDevice).catch(e => {});
          }
          break;
        }

        default: {
          forwardToPeer(clientSessionId, clientRole, messageRaw);
          break;
        }
      }
    } catch (err) {
      console.error('Error handling WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    if (clientSessionId && sessions.has(clientSessionId)) {
      const session = sessions.get(clientSessionId);
      const peer = clientRole === 'laptop' ? session.mobile : session.laptop;
      
      if (clientRole === 'laptop') {
        session.laptop = null;
      } else if (clientRole === 'mobile') {
        session.mobile = null;
      }
      
      if (peer && peer.readyState === WebSocket.OPEN) {
        peer.send(JSON.stringify({
          type: 'peer_disconnected',
          role: clientRole
        }));
      }
      
      if (!session.laptop && !session.mobile) {
        setTimeout(() => {
          if (sessions.has(clientSessionId)) {
            const s = sessions.get(clientSessionId);
            if (!s.laptop && !s.mobile) sessions.delete(clientSessionId);
          }
        }, 10 * 60 * 1000);
      }
    }
  });
});

function forwardToPeer(sessionId, role, rawData) {
  if (!sessionId || !sessions.has(sessionId)) return;
  const session = sessions.get(sessionId);
  const target = role === 'laptop' ? session.mobile : session.laptop;
  if (target && target.readyState === WebSocket.OPEN) {
    target.send(rawData.toString());
  }
}

// Periodic heartbeat
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// Bootstrap servers
async function start() {
  await refreshAdbStatus();

  const sslOpts = await getSslOptions();
  const httpServer = http.createServer(app);
  let httpsServer = null;

  function handleUpgrade(req, socket, head) {
    if (req.url && req.url.startsWith('/ws')) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
  }

  httpServer.on('upgrade', handleUpgrade);
  httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
    const addresses = getLocalNetworkAddresses();
    console.log(`\n======================================================`);
    console.log(`🚀 AetherSync - Android Remote Wireless Debugger & Controller`);
    console.log(`======================================================`);
    console.log(`💻 Laptop Dashboard: http://localhost:${HTTP_PORT}`);
    console.log(`📱 Connect Android Phone via Wi-Fi (HTTP):`);
    addresses.forEach(addr => {
      console.log(`   👉 http://${addr.address}:${HTTP_PORT} (${addr.name})`);
    });
  });

  if (sslOpts) {
    httpsServer = https.createServer(sslOpts, app);
    httpsServer.on('upgrade', handleUpgrade);
    httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
      const addresses = getLocalNetworkAddresses();
      console.log(`\n🔒 Secure HTTPS (Enables Full System Screen Share on Android Chrome):`);
      addresses.forEach(addr => {
        console.log(`   👉 https://${addr.address}:${HTTPS_PORT} (${addr.name})`);
      });
      console.log(`======================================================\n`);
    });
  }
}

start();
