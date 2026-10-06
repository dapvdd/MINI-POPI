const WebSocket = require('ws');

const TOKEN = process.env.HERMES_TOKEN;

if (!TOKEN) {
  console.error('❌ Error: HERMES_TOKEN environment variable is not set!');
  process.exit(1);
}

const url = `ws://127.0.0.1:9119/api/ws?token=${encodeURIComponent(TOKEN)}`;

console.log('Connecting to Hermes Gateway...');
console.log('URL:', url.replace(TOKEN, '***'));

const ws = new WebSocket(url);

ws.on('open', () => {
  console.log('🚀 WEBSOCKET CONNECTED!');
  console.log('Waiting for gateway.ready event...\n');
});

ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data.toString());
    
    console.log('📩 RECEIVED EVENT/RESPONSE:');
    console.dir(msg, { depth: null, colors: true });
    console.log('---');

    // Trigger session.create HANYA SETELAH gateway.ready diterima
    if (msg.method === 'event' && msg.params?.type === 'gateway.ready') {
      console.log('⚡ Gateway is ready! Sending `session.create`...');
      
      const sessionCreatePayload = {
        jsonrpc: "2.0",
        id: 1,
        method: "session.create",
        params: {}
      };

      console.log('📤 SENDING:', JSON.stringify(sessionCreatePayload, null, 2));
      ws.send(JSON.stringify(sessionCreatePayload));
    }

    // Tangkap response khusus untuk id: 1 (session.create)
    if (msg.id === 1) {
      console.log('🎉 SESSION CREATED SUCCESSFULLY!');
      console.log('Session ID / Payload:', msg.result || msg);
    }

  } catch (err) {
    console.error('❌ Error parsing message:', err.message);
  }
});

ws.on('error', (err) => {
  console.error('❌ WS Error:', err.message);
});

ws.on('close', (code, reason) => {
  console.log(`🔒 WS Closed: ${code} - ${reason.toString() || 'No reason'}`);
});