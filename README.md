# 🚀 AetherSync - Android Remote Wireless Debugger & Full OS Controller

A complete, high-performance **Android Remote Wireless Debugger, Full Screen Mirror & Bi-directional Controller** that lets you connect your Android phone to your laptop wirelessly via QR code or Wireless Debugging (ADB).

---

## 🌟 Two Modes of Operation for Android

### Mode 1: Zero-Install Full Screen WebRTC Streaming (Chrome for Android)
- **Zero App/APK Installation**: Open Chrome on Android and scan the **Secure HTTPS QR Code**.
- **Whole Screen Mirroring**: Tap **"Mirror Screen"**. Android natively prompts: *"Start recording or casting with Chrome? [Start now]"*.
- **Everything Streams Live at 30-60 FPS**: Minimize Chrome, swipe to your Home Screen, open TikTok, Instagram, WhatsApp, camera, or game apps—your entire phone display broadcasts live to your laptop!

### Mode 2: Full System-Wide Wireless Control via ADB
- Built-in official Google Android `platform-tools` (`adb.exe`).
- **Android 11+ Wireless Pairing**: Pair with your phone wirelessly in seconds (Developer Options $\to$ Wireless Debugging $\to$ Pair with 6-digit Code).
- **Control the Entire Android OS from Laptop**:
  - **Left Click on Laptop Frame**: Taps on the real Android screen with pixel-perfect resolution mapping.
  - **Mouse Scroll / Drag**: Swipes up, down, left, right across any app.
  - **Laptop Keyboard**: Types directly into active Android text inputs.
  - **Hardware Buttons on Dashboard**: ◀ Back, ⭕ Home, ▢ Recent Apps, 🔒 Power.

---

## 🚀 Quick Start

### 1. Start Server
```bash
cd c:\Users\juwon\Downloads\RWD
npm start
```

The server listens on both ports:
- **Laptop Master Dashboard**: `http://localhost:3000`
- **Android Phone HTTPS URL**: `https://<YOUR_WIFI_IP>:3443`
- **Android Phone HTTP URL**: `http://<YOUR_WIFI_IP>:3000`

### 2. Connect Your Android Phone

#### Option A (Instant Web Mirror):
1. Open `http://localhost:3000` on your laptop.
2. Scan the **Secure HTTPS QR Code** using Chrome on Android.
3. If prompted about self-signed certificate, tap **Advanced $\to$ Proceed**.
4. Tap **"Mirror Screen"** and accept the Android prompt **"Start now"**.
5. Switch to any app on your phone—it mirrors live on your laptop screen!

#### Option B (Full OS Wireless Mouse/Keyboard Control via ADB):
1. On your Android phone, enable **Developer Options $\to$ Wireless Debugging**.
2. Tap **"Pair device with pairing code"** to view your Wi-Fi IP, Port, and 6-digit PIN.
3. In the Laptop Dashboard, open the **"Whole Phone OS"** tab:
   - Enter IP, Port, and 6-digit PIN, then click **"Pair"**.
4. Now your mouse clicks and drags on the laptop frame interact directly with your real Android phone!
5. (Alternative): If plugged in via USB once, click **"⚡ Switch USB to Wireless (5555)"**, then unplug the cable and stay connected wirelessly!

---

## 🏗️ Architecture

```
c:\Users\juwon\Downloads\RWD/
├── bin/platform-tools/        # Official Google Android ADB binaries
├── certs/                     # Auto-generated SSL certificates for Android WebRTC
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
