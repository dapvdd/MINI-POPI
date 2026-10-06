const WebSocket = require('ws');

const TOKEN = process.env.HERMES_TOKEN;

if (!TOKEN) {
  console.error('HERMES_TOKEN belum diset.');
  process.exit(1);
}

const url =
  `ws://127.0.0.1:9119/api/ws?token=${encodeURIComponent(TOKEN)}`;

console.log('Connecting to Hermes...');
console.log('URL:', url.replace(TOKEN, '***'));

const ws = new WebSocket(url);

ws.on('open', () => {
  console.log('🚀 WEBSOCKET CONNECTED!');
  console.log('Waiting for Hermes events...\n');
});

ws.on('message', data => {
  console.log('📩 HERMES:');
  console.dir(JSON.parse(data.toString()), {
    depth: null,
    colors: true
  });
});

ws.on('error', err => {
  console.error('❌ WS Error:', err.message);
});

ws.on('close', (code, reason) => {
  console.log(`🔒 WS Closed: ${code} - ${reason}`);
});