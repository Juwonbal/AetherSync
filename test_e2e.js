const WebSocket = require('ws');

async function runTest() {
  console.log('--- Starting AetherSync End-to-End WebSocket & Protocol Test ---');

  const netRes = await fetch('http://localhost:3000/api/network-info');
  const netData = await netRes.json();
  const sessionId = netData.sessionId;
  const pin = netData.pin;

  console.log(`[Test] Using Session: ${sessionId}, PIN: ${pin}`);

  const wsLaptop = new WebSocket('ws://localhost:3000/ws');
  const wsMobile = new WebSocket('ws://localhost:3000/ws');

  let laptopPaired = false;
  let mobilePaired = false;
  let consoleReceived = false;
  let clickReceived = false;
  let scrollReceived = false;
  let evalReceived = false;
  let vibrateReceived = false;

  await new Promise((resolve) => {
    let openCount = 0;
    wsLaptop.on('open', () => {
      openCount++;
      wsLaptop.send(JSON.stringify({ type: 'join', role: 'laptop', sessionId, pin }));
      if (openCount === 2) resolve();
    });
    wsMobile.on('open', () => {
      openCount++;
      wsMobile.send(JSON.stringify({ type: 'join', role: 'mobile', sessionId, pin, deviceInfo: { platform: 'TestMobile' } }));
      if (openCount === 2) resolve();
    });
  });

  wsLaptop.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'joined' && msg.role === 'laptop') {
      console.log('✅ Laptop joined successfully');
    }
    if (msg.type === 'peer_connected' && msg.role === 'mobile') {
      console.log('✅ Laptop received peer_connected notification');
      laptopPaired = true;
    }
    if (msg.type === 'console_log') {
      console.log('✅ Laptop received console log from mobile:', msg.args[0].value);
      consoleReceived = true;
    }
    if (msg.type === 'phone_scroll') {
      console.log('✅ Laptop received phone scroll event:', msg.scrollY);
      scrollReceived = true;
    }
    if (msg.type === 'eval_response') {
      console.log('✅ Laptop received REPL eval response:', msg.result.value);
      evalReceived = true;
    }
  });

  wsMobile.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'joined' && msg.role === 'mobile') {
      console.log('✅ Mobile joined successfully');
      mobilePaired = true;
    }
    if (msg.type === 'remote_click') {
      console.log(`✅ Mobile received remote click at (${msg.x}, ${msg.y})`);
      clickReceived = true;
    }
    if (msg.type === 'eval_request') {
      console.log('✅ Mobile received eval request:', msg.code);
      // Simulate eval
      const res = eval(msg.code);
      wsMobile.send(JSON.stringify({
        type: 'eval_response',
        id: msg.id,
        success: true,
        result: { type: typeof res, value: res }
      }));
    }
    if (msg.type === 'vibrate_cmd') {
      console.log('✅ Mobile received vibration command:', msg.pattern);
      vibrateReceived = true;
    }
  });

  // Wait 500ms for handshakes
  await new Promise(r => setTimeout(r, 500));

  // 1. Mobile sends console log
  wsMobile.send(JSON.stringify({
    type: 'console_log',
    level: 'info',
    args: [{ type: 'string', value: 'Hello from Mobile Client!' }],
    rawTime: '12:00:00'
  }));

  // 2. Mobile sends scroll
  wsMobile.send(JSON.stringify({
    type: 'phone_scroll',
    scrollY: 350,
    scrollRatioY: 0.45
  }));

  // 3. Laptop sends remote click
  wsLaptop.send(JSON.stringify({
    type: 'remote_click',
    x: 0.5,
    y: 0.25
  }));

  // 4. Laptop sends eval request
  wsLaptop.send(JSON.stringify({
    type: 'eval_request',
    id: 'test_eval_1',
    code: '10 + 25'
  }));

  // 5. Laptop sends vibrate command
  wsLaptop.send(JSON.stringify({
    type: 'vibrate_cmd',
    pattern: [150, 50, 150]
  }));

  // Wait 1 second to collect results
  await new Promise(r => setTimeout(r, 1000));

  wsLaptop.close();
  wsMobile.close();

  console.log('\n--- Test Summary ---');
  console.log(`Laptop Paired: ${laptopPaired ? 'PASS' : 'FAIL'}`);
  console.log(`Mobile Paired: ${mobilePaired ? 'PASS' : 'FAIL'}`);
  console.log(`Console Relay: ${consoleReceived ? 'PASS' : 'FAIL'}`);
  console.log(`Scroll Sync: ${scrollReceived ? 'PASS' : 'FAIL'}`);
  console.log(`Click Control: ${clickReceived ? 'PASS' : 'FAIL'}`);
  console.log(`REPL Eval: ${evalReceived ? 'PASS' : 'FAIL'}`);
  console.log(`Vibration Trigger: ${vibrateReceived ? 'PASS' : 'FAIL'}`);

  if (laptopPaired && mobilePaired && consoleReceived && scrollReceived && clickReceived && evalReceived && vibrateReceived) {
    console.log('\n🎉 ALL PROTOCOL TESTS PASSED PERFECTLY!\n');
    process.exit(0);
  } else {
    console.error('\n❌ Some tests failed!');
    process.exit(1);
  }
}

runTest().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
