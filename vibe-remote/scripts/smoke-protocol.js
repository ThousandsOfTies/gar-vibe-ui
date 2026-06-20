#!/usr/bin/env node

const { WebSocket } = require('ws');

const args = new Map();
for (const arg of process.argv.slice(2)) {
  const match = arg.match(/^--([^=]+)=(.*)$/);
  if (match) {
    args.set(match[1], match[2]);
  }
}

const host = args.get('host') || process.env.VIBE_REMOTE_HOST || '127.0.0.1';
const port = Number(args.get('port') || process.env.VIBE_REMOTE_PORT || 39271);
const token = args.get('token') || process.env.VIBE_REMOTE_TOKEN || '';
const status = args.get('status') || process.env.VIBE_REMOTE_STATUS || '';
const timeoutMs = Number(args.get('timeout') || 5000);
const url = `ws://${host}:${port}`;

if (Number.isNaN(port) || port <= 0) {
  fail(`Invalid port: ${port}`);
}

if (!token) {
  fail('A token is required. Pass --token=... or VIBE_REMOTE_TOKEN=...');
}

const ws = new WebSocket(url);
const timeout = setTimeout(() => {
  ws.close();
  fail(`Timed out after ${timeoutMs}ms waiting for Vibe Remote at ${url}`);
}, timeoutMs);

let sawState = false;
let sawAck = !status;

ws.on('open', () => {
  console.log(`connected ${url}`);
  ws.send(JSON.stringify({ type: 'hello', token }));
  ws.send(JSON.stringify({ type: 'ping', token }));

  if (status) {
    ws.send(
      JSON.stringify({
        type: 'agentStatus',
        status,
        source: 'smoke',
        message: 'smoke protocol test',
        token
      })
    );
  }
});

ws.on('message', (data) => {
  let msg;
  try {
    msg = JSON.parse(data.toString());
  } catch (err) {
    ws.close();
    fail(`Received non-JSON message: ${err.message}`);
  }

  if (msg.type === 'state') {
    sawState = true;
    const agent = msg.agent ? ` agent=${msg.agent.source}:${msg.agent.status}` : '';
    console.log(`state chat=${msg.chat}${agent}`);
  } else if (msg.type === 'ack') {
    sawAck = true;
    console.log(`ack ok=${msg.ok}${msg.error ? ` error=${msg.error}` : ''}`);
    if (!msg.ok) {
      ws.close();
      fail(msg.error || 'Protocol request failed');
    }
  }

  if (sawState && sawAck) {
    clearTimeout(timeout);
    ws.close();
    console.log('smoke protocol ok');
  }
});

ws.on('error', (err) => {
  clearTimeout(timeout);
  fail(`WebSocket error: ${err.message}`);
});

function fail(message) {
  console.error(message);
  process.exit(1);
}
