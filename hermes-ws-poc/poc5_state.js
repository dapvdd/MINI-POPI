const WebSocket = require('ws');

const TOKEN = process.env.HERMES_TOKEN;

if (!TOKEN) {
  throw new Error('HERMES_TOKEN belum diset');
}

const url =
  `ws://127.0.0.1:9119/api/ws?token=${encodeURIComponent(TOKEN)}`;

const ws = new WebSocket(url);

let requestId = 1;
let sessionId = null;

const agent = {
  status: 'OFFLINE',
  tool: null,
  command: null,
  lastOutput: null,
  lastError: null,
  startedAt: null,
};

function render() {
  console.clear();

  console.log('╔══════════════════════════════════════╗');
  console.log('║        🤖 HERMES VIRTUAL OFFICE      ║');
  console.log('╠══════════════════════════════════════╣');
  console.log(`║ Status : ${agent.status.padEnd(25)}║`);
  console.log(`║ Tool   : ${(agent.tool ?? '-').padEnd(25)}║`);
  console.log(`║ Command: ${(agent.command ?? '-').slice(0, 25).padEnd(25)}║`);
  console.log(`║ Output : ${(agent.lastOutput ?? '-').slice(0, 25).padEnd(25)}║`);
  console.log('╚══════════════════════════════════════╝');
}

function rpc(method, params) {
  const id = requestId++;

  ws.send(JSON.stringify({
    jsonrpc: '2.0',
    id,
    method,
    params
  }));
}

function setStatus(status) {
  agent.status = status;
  render();
}

ws.on('open', () => {
  console.log('🔌 Connected to Hermes Gateway...');
});

ws.on('message', (data) => {
  let msg;

  try {
    msg = JSON.parse(data.toString());
  } catch {
    return;
  }

  // Gateway siap
  if (
    msg.method === 'event' &&
    msg.params?.type === 'gateway.ready'
  ) {
    setStatus('IDLE');

    rpc('session.create', {});
    return;
  }

  // Session dibuat
  if (
    msg.id &&
    msg.result?.session_id &&
    !sessionId
  ) {
    sessionId = msg.result.session_id;

    console.log(`\n🆕 Session: ${sessionId}`);

    rpc('prompt.submit', {
      session_id: sessionId,
      text: `
Gunakan terminal tool untuk menjalankan:

printf 'HERMES OFFICE POC 5 SUCCESS\\n'

Setelah selesai, jawab singkat.
      `.trim()
    });

    return;
  }

  if (msg.method !== 'event') {
    return;
  }

  const type = msg.params?.type;
  const payload = msg.params?.payload ?? {};

  switch (type) {

    case 'message.start':
      agent.lastOutput = null;
      agent.lastError = null;
      setStatus('THINKING');
      break;

    case 'thinking.delta':
      if (payload.text) {
        setStatus('THINKING');
      }
      break;

    case 'reasoning.delta':
      setStatus('THINKING');
      break;

    case 'tool.generating':
      agent.tool = payload.name ?? null;
      setStatus('PREPARING TOOL');
      break;

    case 'tool.start':
      agent.tool = payload.name ?? null;
      agent.command = payload.args?.command ?? payload.context ?? null;
      agent.startedAt = Date.now();

      setStatus('WORKING');

      console.log('\n⚙️ TOOL START');
      console.log('Tool:', agent.tool);
      console.log('Command:', agent.command);
      break;

    case 'tool.complete':
      agent.tool = payload.name ?? agent.tool;

      agent.lastOutput =
        payload.result?.output ??
        payload.result_text ??
        null;

      agent.lastError =
        payload.result?.error ??
        null;

      setStatus(
        agent.lastError || payload.result?.exit_code !== 0
          ? 'ERROR'
          : 'TOOL DONE'
      );

      console.log('\n✅ TOOL COMPLETE');
      console.log('Duration:', payload.duration_s, 's');
      console.log('Exit code:', payload.result?.exit_code);
      console.log('Output:', agent.lastOutput);
      break;

    case 'message.delta':
      // Hermes sedang mengirim jawaban
      break;

    case 'message.complete':
      if (payload.status === 'error') {
        setStatus('ERROR');
      } else {
        setStatus('IDLE');
      }

      console.log('\n🏁 MESSAGE COMPLETE');

      setTimeout(() => {
        ws.close();
      }, 1000);

      break;

    default:
      break;
  }
});

ws.on('close', () => {
  agent.status = 'OFFLINE';

  console.log('\n🔌 Hermes Gateway disconnected.');
});

ws.on('error', (err) => {
  agent.status = 'ERROR';

  console.error('\n❌ WebSocket error:', err.message);
});