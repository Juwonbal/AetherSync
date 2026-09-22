# 🚀 AetherSync - Android Remote Wireless Debugger & Full OS Controller

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Render-46E3B7?style=for-the-badge&logo=render&logoColor=white)](https://aethersync-hllr.onrender.com/)
[![GitHub Repo](https://img.shields.io/badge/GitHub-Juwonbal%2FAetherSync-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/Juwonbal/AetherSync)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

> 🌐 **Live Cloud Demo:** [https://aethersync-hllr.onrender.com/](https://aethersync-hllr.onrender.com/)  
> Open on your laptop or phone to try instant wireless pairing, 30–60 FPS display mirroring, and DevTools anywhere in the world with zero installation!

---

## 🌟 Two Modes of Operation for Android

### Mode 1: Zero-Install Full Screen WebRTC Streaming (Cloud or Local)
- **Zero App/APK Installation**: Open Chrome on Android and scan the QR Code on [https://aethersync-hllr.onrender.com/](https://aethersync-hllr.onrender.com/).
- **Whole Screen Mirroring**: Tap **"Mirror Screen"**. Android natively prompts: *"Start recording or casting with Chrome? [Start now]"*.
- **Everything Streams Live at 30-60 FPS**: Minimize Chrome, swipe to your Home Screen, open TikTok, Instagram, WhatsApp, camera, or game apps—your entire phone display broadcasts live to your laptop!

### Mode 2: Full System-Wide Wireless Control via ADB (Local Host)
- Built-in official Google Android `platform-tools` (`adb.exe`).
- **Android 11+ Wireless Pairing**: Pair with your phone wirelessly in seconds (Developer Options $\to$ Wireless Debugging $\to$ Pair with 6-digit Code).
- **Control the Entire Android OS from Laptop**:
  - **Left Click on Laptop Frame**: Taps on the real Android screen with pixel-perfect resolution mapping.
  - **Mouse Scroll / Drag**: Swipes up, down, left, right across any app.
  - **Laptop Keyboard**: Types directly into active Android text inputs.
  - **Hardware Buttons on Dashboard**: ◀ Back, ⭕ Home, ▢ Recent Apps, 🔒 Power.

---

## 🌐 Try the Live Cloud Demo

1. Open **[https://aethersync-hllr.onrender.com/](https://aethersync-hllr.onrender.com/)** on your laptop.
2. Click **"Pair Device (QR)"**.
3. Scan the QR code with your Android phone's camera or Chrome.
4. Tap **"Mirror Screen"** $\to$ tap **"Start now"** on the Android system prompt.
5. Minimize Chrome and switch to any app on your phone—it streams live to your laptop dashboard in real time!

---

## 💻 Running Locally (For Full Wireless ADB Mouse & Keyboard Control)

### 1. Start Server
```bash
cd c:\Users\juwon\Downloads\RWD
npm start
```

The local server listens on both:
- **Laptop Master Dashboard**: `http://localhost:3000`
- **Android Phone HTTPS URL**: `https://<YOUR_WIFI_IP>:3443`

### 2. Connect Your Android Phone via Wireless ADB
1. On your Android phone, enable **Developer Options $\to$ Wireless Debugging**.
2. Tap **"Pair device with pairing code"** to view your Wi-Fi IP, Port, and 6-digit PIN.
3. In the Laptop Dashboard (`http://localhost:3000`), open the **"Whole Phone OS"** tab:
   - Enter IP, Port, and 6-digit PIN, then click **"Pair"**.
4. Now your mouse clicks and drags on the laptop frame interact directly with your real Android phone!
5. (Shortcut): If plugged in via USB once, click **"⚡ Switch USB to Wireless (5555)"**, then unplug the cable and stay connected wirelessly!

---

## 🏗️ Architecture

```
AetherSync/
├── bin/platform-tools/        # Official Google Android ADB binaries
├── certs/                     # Auto-generated SSL certificates for local WebRTC
├── adb-bridge.js              # Node.js ADB Controller (Taps, Swipes, Keys, Screencap)
├── server.js                  # Dual HTTP/HTTPS Express + WebSocket Server
├── test_e2e.js                # Protocol Verification Suite
└── public/
    ├── index.html             # Laptop Master Dashboard with Android controls
    ├── client.html            # Mobile Client Web App
    ├── css/
    │   ├── dashboard.css      # Dark glassmorphism styling
    │   └── client.css         # Mobile styling
    └── js/
        ├── dashboard.js       # WebRTC receiver, ADB coordinator, gesture mapper
        ├── client.js          # Mobile agent, WebRTC screen streamer
        ├── console-tab.js     # Live console & REPL engine
        ├── network-tab.js     # Network request analyzer
        ├── dom-tab.js         # Interactive DOM tree viewer
        └── sensors.js         # 3D Gyroscope & telemetry visualizer
```

---

## 🧪 Verification Test

Run the automated test suite anytime:
```bash
node test_e2e.js
```
