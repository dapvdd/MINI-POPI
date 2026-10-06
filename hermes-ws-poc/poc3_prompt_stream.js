const WebSocket = require('ws');

const TOKEN = process.env.HERMES_TOKEN;

if (!TOKEN) {
  console.error('❌ HERMES_TOKEN environment variable is not set!');
  process.exit(1);
}

const url =
  `ws://127.0.0.1:9119/api/ws?token=${encodeURIComponent(TOKEN)}`;

console.log('Connecting to Hermes Gateway...');

const ws = new WebSocket(url);

let activeSessionId = null;
let promptSent = false;

ws.on('open', () => {
  console.log('🚀 WEBSOCKET CONNECTED!');
  console.log('Waiting for gateway.ready...\n');
});

ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data.toString());

    // ==========================================
    // 1. Gateway ready
    // ==========================================
    if (
      msg.method === 'event' &&
      msg.params?.type === 'gateway.ready'
    ) {
      console.log('⚡ Gateway ready! Creating session...');

      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'session.create',
        params: {}
      }));

      return;
    }

    // ==========================================
    // 2. Session created
    // ==========================================
    if (
      msg.id === 1 &&
      msg.result?.session_id
    ) {
      activeSessionId = msg.result.session_id;

      console.log(
        `🎉 SESSION CREATED! ID: ${activeSessionId}`
      );

      if (!promptSent) {
        promptSent = true;
        sendPrompt();
      }

      return;
    }

    // ==========================================
    // 3. JSON-RPC response to prompt.submit
    // ==========================================
    if (msg.id === 2) {
      console.log('\n📨 prompt.submit RESPONSE:');
      console.dir(msg, {
        depth: null,
        colors: true
      });

      if (msg.error) {
        console.error('\n❌ prompt.submit FAILED');
      } else {
        console.log('\n✅ prompt.submit ACCEPTED');
      }

      return;
    }

    // ==========================================
    // 4. Gateway events
    // ==========================================
    if (msg.method === 'event') {
      const type = msg.params?.type;
      const sessionId = msg.params?.session_id;
      const payload = msg.params?.payload;

      console.log(`\n📩 [EVENT: ${type}]`);

      if (sessionId) {
        console.log(`Session: ${sessionId}`);
      }

      console.dir(payload, {
        depth: null,
        colors: true
      });

      return;
    }

    // ==========================================
    // 5. Unknown JSON-RPC message
    // ==========================================
    console.log('\n📦 MESSAGE:');
    console.dir(msg, {
      depth: null,
      colors: true
    });

  } catch (err) {
    console.error(
      '❌ Error parsing message:',
      err.message
    );
  }
});

function sendPrompt() {
  const text =
    'Halo Hermes, tes koneksi streaming WebSocket. Balas singkat saja!';

  const payload = {
    jsonrpc: '2.0',
    id: 2,
    method: 'prompt.submit',
    params: {
      session_id: activeSessionId,
      text
    }
  };

  console.log('\n📤 Sending prompt.submit:');
  console.dir(payload, {
    depth: null,
    colors: true
  });

  ws.send(JSON.stringify(payload));
}

ws.on('error', (err) => {
  console.error('❌ WS Error:', err.message);
});

ws.on('close', (code, reason) => {
  console.log(
    `🔒 WS Closed: ${code} - ${reason.toString() || 'No reason'}`
  );
});