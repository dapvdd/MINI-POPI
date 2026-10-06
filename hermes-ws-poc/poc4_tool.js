const WebSocket = require('ws');

const TOKEN = process.env.HERMES_TOKEN;

if (!TOKEN) {
  throw new Error('HERMES_TOKEN belum diset');
}

const url =
  `ws://127.0.0.1:9119/api/ws?token=${encodeURIComponent(TOKEN)}`;

const ws = new WebSocket(url);

let activeSessionId = null;
let requestId = 1;

function sendRpc(method, params) {
  const id = requestId++;

  console.log('\n>>> RPC');
  console.log(JSON.stringify({
    jsonrpc: '2.0',
    id,
    method,
    params
  }, null, 2));

  ws.send(JSON.stringify({
    jsonrpc: '2.0',
    id,
    method,
    params
  }));
}

ws.on('open', () => {
  console.log('CONNECTED');
});

ws.on('message', (data) => {
  let msg;

  try {
    msg = JSON.parse(data.toString());
  } catch {
    console.log('RAW:', data.toString());
    return;
  }

  // Jangan print token / credential apa pun.
  console.log('\n<<< EVENT/RESPONSE');
  console.log(JSON.stringify(msg, null, 2));

  // Gateway siap
  if (
    msg.method === 'event' &&
    msg.params?.type === 'gateway.ready'
  ) {
    console.log('\nGateway ready.');

    sendRpc('session.create', {});
    return;
  }

  // Session berhasil dibuat
  if (
    msg.id &&
    msg.result?.session_id &&
    !activeSessionId
  ) {
    activeSessionId = msg.result.session_id;

    console.log('\nSESSION:', activeSessionId);

    sendRpc('prompt.submit', {
      session_id: activeSessionId,
      text: `
Gunakan terminal tool untuk menjalankan perintah berikut:

Write-Output "HERMES TOOL EXECUTION SUCCESS"

Setelah command selesai, jelaskan secara singkat bahwa command berhasil dijalankan.
      `.trim()
    });

    return;
  }

  // Tool mulai
  if (
    msg.method === 'event' &&
    msg.params?.type === 'tool.start'
  ) {
    console.log('\n🔥🔥🔥 TOOL START 🔥🔥🔥');
    console.log(JSON.stringify(msg.params.payload, null, 2));
  }

  // Tool selesai
  if (
    msg.method === 'event' &&
    msg.params?.type === 'tool.complete'
  ) {
    console.log('\n✅✅✅ TOOL COMPLETE ✅✅✅');
    console.log(JSON.stringify(msg.params.payload, null, 2));
  }

  // Stream text
  if (
    msg.method === 'event' &&
    msg.params?.type === 'message.delta'
  ) {
    const delta = msg.params.payload?.delta ?? '';

    process.stdout.write(delta);
  }

  // Turn selesai
  if (
    msg.method === 'event' &&
    msg.params?.type === 'message.complete'
  ) {
    console.log('\n\n🏁 MESSAGE COMPLETE');

    setTimeout(() => {
      ws.close();
    }, 1000);
  }
});

ws.on('close', () => {
  console.log('\nWebSocket closed.');
});

ws.on('error', (err) => {
  console.error('WebSocket error:', err.message);
});