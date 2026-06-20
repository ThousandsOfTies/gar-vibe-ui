#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const { WebSocket } = require('ws');

const host = args.host || process.env.VIBE_REMOTE_HOST || '127.0.0.1';
const port = Number(args.port || process.env.VIBE_REMOTE_PORT || 39271);
const token = args.token || process.env.VIBE_REMOTE_TOKEN || '';
const devDir = path.resolve(
  args.dev || process.env.VIBE_REMOTE_DEV || '/tmp/gar-vibe-remote-device'
);
const reconnectMs = Number(args.reconnectMs || 3000);
const pollMs = Number(args.pollMs || 250);
const source = args.source || 'virtual-m5stack';
const url = `ws://${host}:${port}`;

if (!token) {
  fail('A token is required. Pass --token=... or VIBE_REMOTE_TOKEN=...');
}
if (!Number.isFinite(port) || port <= 0) {
  fail(`Invalid port: ${port}`);
}

const files = {
  buttonA: path.join(devDir, 'button_a'),
  buttonB: path.join(devDir, 'button_b'),
  buttonC: path.join(devDir, 'button_c'),
  holdA: path.join(devDir, 'hold_a'),
  holdB: path.join(devDir, 'hold_b'),
  holdC: path.join(devDir, 'hold_c'),
  state: path.join(devDir, 'state.json'),
  screen: path.join(devDir, 'screen.txt'),
  events: path.join(devDir, 'events.log'),
  README: path.join(devDir, 'README')
};

const controls = [
  { file: files.buttonA, status: 'running', message: 'button A' },
  { file: files.buttonB, status: 'waiting', message: 'button B' },
  { file: files.buttonC, status: 'done', message: 'button C' },
  { file: files.holdA, status: 'failed', message: 'button A hold' },
  { file: files.holdB, status: 'idle', message: 'button B hold' },
  { file: files.holdC, action: 'reconnect', message: 'button C hold' }
];

let ws;
let connected = false;
let reconnectTimer;
let pollTimer;
const seen = new Map();

setupDevDir();
connect();
pollTimer = setInterval(pollControls, pollMs);

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function setupDevDir() {
  fs.mkdirSync(devDir, { recursive: true });
  for (const control of controls) {
    if (!fs.existsSync(control.file)) {
      fs.writeFileSync(control.file, '0\n');
    }
    seen.set(control.file, statSignature(control.file));
  }
  fs.writeFileSync(files.README, usageText());
  fs.writeFileSync(files.state, '{}\n');
  fs.writeFileSync(files.screen, 'Vibe Remote virtual device starting\n');
  appendEvent(`devdir ${devDir}`);
}

function connect() {
  clearTimeout(reconnectTimer);
  appendEvent(`connect ${url}`);
  ws = new WebSocket(url);

  ws.on('open', () => {
    connected = true;
    appendEvent('ws connected');
    send({ type: 'hello', token });
    send({ type: 'ping', token });
  });

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (err) {
      appendEvent(`invalid json ${err.message}`);
      return;
    }

    if (msg.type === 'state') {
      fs.writeFileSync(files.state, JSON.stringify(msg, null, 2) + '\n');
      fs.writeFileSync(files.screen, renderScreen(msg));
    } else if (msg.type === 'ack') {
      appendEvent(`ack ok=${msg.ok}${msg.error ? ` error=${msg.error}` : ''}`);
    } else {
      appendEvent(`message ${msg.type || 'unknown'}`);
    }
  });

  ws.on('close', () => {
    connected = false;
    appendEvent('ws disconnected');
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    connected = false;
    appendEvent(`ws error ${err.message}`);
  });
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, reconnectMs);
}

function pollControls() {
  for (const control of controls) {
    const sig = statSignature(control.file);
    if (sig === seen.get(control.file)) {
      continue;
    }
    seen.set(control.file, sig);
    const value = fs.readFileSync(control.file, 'utf8').trim().toLowerCase();
    if (!['1', 'press', 'pressed', 'click', 'clicked', 'hold', 'held'].includes(value)) {
      continue;
    }
    fs.writeFileSync(control.file, '0\n');
    seen.set(control.file, statSignature(control.file));

    if (control.action === 'reconnect') {
      appendEvent('control reconnect');
      if (ws) {
        ws.close();
      } else {
        scheduleReconnect();
      }
      continue;
    }

    appendEvent(`control ${path.basename(control.file)} -> ${control.status}`);
    send({
      type: 'agentStatus',
      token,
      status: control.status,
      source,
      message: control.message,
      ttlMs: 120000
    });
  }
}

function send(msg) {
  if (!connected || !ws || ws.readyState !== WebSocket.OPEN) {
    appendEvent(`drop ${msg.type}: not connected`);
    return;
  }
  ws.send(JSON.stringify(msg));
}

function renderScreen(state) {
  const agent = state.agent || {};
  const activity = state.activity || {};
  return [
    'Vibe Remote virtual device',
    `chat:   ${state.chat || 'unknown'}`,
    `agent:  ${agent.source || '-'} ${agent.status || 'idle'}`,
    `msg:    ${agent.message || '-'}`,
    `file:   ${activity.file || '-'}`,
    `cmd:    ${activity.command || '-'}`,
    `diag:   E${activity.errors ?? 0} W${activity.warnings ?? 0}`,
    `task:   ${activity.taskRunning ? 'running' : 'idle'}`,
    `debug:  ${activity.debugging ? 'running' : 'idle'}`,
    '',
    'controls:',
    '  echo press > button_a  # running',
    '  echo press > button_b  # waiting',
    '  echo press > button_c  # done',
    '  echo hold  > hold_a    # failed',
    '  echo hold  > hold_b    # idle',
    '  echo hold  > hold_c    # reconnect',
    ''
  ].join('\n');
}

function appendEvent(line) {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  fs.appendFileSync(files.events, stamped + '\n');
  console.log(stamped);
}

function statSignature(file) {
  try {
    const stat = fs.statSync(file);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return 'missing';
  }
}

function usageText() {
  return `Vibe Remote virtual device

This directory behaves like a tiny pseudo /dev surface for Vibe Remote.

Controls:
  echo press > button_a  # running
  echo press > button_b  # waiting
  echo press > button_c  # done
  echo hold  > hold_a    # failed
  echo hold  > hold_b    # idle
  echo hold  > hold_c    # reconnect

Outputs:
  cat screen.txt
  cat state.json
  tail -f events.log
`;
}

function shutdown() {
  clearInterval(pollTimer);
  clearTimeout(reconnectTimer);
  if (ws) {
    ws.close();
  }
  process.exit(0);
}

function parseArgs(argv) {
  const result = {};
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      result.help = true;
      continue;
    }
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) {
      result[toCamel(match[1])] = match[2];
    }
  }
  return result;
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function printHelp() {
  console.log(`Usage: virtual-device.js --token=TOKEN [options]

Options:
  --host=HOST             Vibe Remote host (default: 127.0.0.1)
  --port=PORT             Vibe Remote port (default: 39271)
  --token=TOKEN           Vibe Remote token
  --dev=PATH              pseudo-dev directory (default: /tmp/gar-vibe-remote-device)
  --source=NAME           agentStatus source name (default: virtual-m5stack)
  --poll-ms=MS            control file polling interval
  --reconnect-ms=MS       reconnect delay
`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
