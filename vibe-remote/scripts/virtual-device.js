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
  { file: files.buttonA, button: 'A' },
  { file: files.buttonB, button: 'B' },
  { file: files.buttonC, button: 'P' },
  { file: files.holdA, button: 'A-hold' },
  { file: files.holdB, button: 'B-hold' },
  { file: files.holdC, button: 'P-hold' }
];

let ws;
let connected = false;
let reconnectTimer;
let pollTimer;
let currentUi;
let selectedIndex = 0;
let pendingAction;
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
      applyState(msg);
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

    if (control.button === 'P-hold') {
      appendEvent('control reconnect');
      if (ws) {
        ws.close();
      } else {
        scheduleReconnect();
      }
      continue;
    }

    handleButton(control.button);
  }
}

function applyState(state) {
  const nextUi = state.ui && typeof state.ui.id === 'string' ? state.ui : undefined;
  if (!nextUi) {
    currentUi = undefined;
    selectedIndex = 0;
    pendingAction = undefined;
    return;
  }
  const previousUiId = currentUi?.id;
  currentUi = nextUi;
  const actionCount = actions().length;
  if (previousUiId !== currentUi.id) {
    pendingAction = undefined;
    selectedIndex = Number.isFinite(currentUi.selected) ? Math.floor(currentUi.selected) : 0;
  }
  if (actionCount <= 0) {
    selectedIndex = 0;
  } else if (selectedIndex < 0 || selectedIndex >= actionCount) {
    selectedIndex = 0;
  }
}

function actions() {
  return Array.isArray(currentUi?.actions) ? currentUi.actions : [];
}

function handleButton(button) {
  if (!currentUi) {
    appendEvent(`button ${button}: ignored (no device UI)`);
    return;
  }
  if (currentUi.mode === 'direct') {
    if (sendActionForButton(button)) {
      return;
    }
    appendEvent(`button ${button}: ignored (no direct action)`);
    return;
  }
  if (button === 'A') {
    if (!sendSelectedAction(button)) {
      appendEvent('button A: ignored (no menu action)');
    }
    return;
  }
  if (button === 'B') {
    const list = actions();
    if (list.length <= 0) {
      appendEvent('button B: ignored (no menu action)');
      return;
    }
    selectedIndex = (selectedIndex + 1) % list.length;
    appendEvent(`button B: selected ${list[selectedIndex].id}`);
    fs.writeFileSync(files.screen, renderScreen({ ui: currentUi, chat: 'idle', activity: {} }));
    return;
  }
  if (button === 'P') {
    sendBackAction(button);
    return;
  }
  if (!sendActionForButton(button)) {
    appendEvent(`button ${button}: ignored (no matching hold action)`);
  }
}

function sendActionForButton(button) {
  const action = actions().find((item) => item.button === button);
  if (!action) {
    return false;
  }
  sendUiAction(action, button);
  return true;
}

function sendSelectedAction(button) {
  const list = actions();
  if (list.length <= 0) {
    return false;
  }
  if (selectedIndex < 0 || selectedIndex >= list.length) {
    selectedIndex = 0;
  }
  sendUiAction(list[selectedIndex], button);
  return true;
}

function sendBackAction(button) {
  const action = actions().find((item) => ['back', 'cancel', 'no', 'ng'].includes(item.id)) || {
    id: 'back',
    label: 'Back'
  };
  sendUiAction(action, button);
}

function sendUiAction(action, button) {
  appendEvent(`button ${button}: ui action ${currentUi.id}/${action.id}`);
  pendingAction = {
    uiId: currentUi.id,
    label: action.label,
    until: Date.now() + 5000
  };
  send({
    type: 'uiAction',
    token,
    uiId: currentUi.id,
    actionId: action.id,
    button,
    source
  });
  fs.writeFileSync(files.screen, renderScreen({ ui: currentUi, chat: 'idle', activity: {} }));
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
  const ui = state.ui || currentUi;
  const uiActions = Array.isArray(ui?.actions) ? ui.actions : [];
  const sent =
    pendingAction && pendingAction.uiId === ui?.id && Date.now() < pendingAction.until
      ? pendingAction.label
      : '-';
  return [
    'Vibe Remote virtual device',
    `chat:   ${state.chat || 'unknown'}`,
    `agent:  ${agent.source || '-'} ${agent.status || 'idle'}`,
    `msg:    ${agent.message || '-'}`,
    `ui:     ${ui?.id || '-'} ${ui?.title || ''}`,
    `select: ${uiActions[selectedIndex]?.label || '-'}`,
    `sent:   ${sent}`,
    `file:   ${activity.file || '-'}`,
    `cmd:    ${activity.command || '-'}`,
    `diag:   E${activity.errors ?? 0} W${activity.warnings ?? 0}`,
    `task:   ${activity.taskRunning ? 'running' : 'idle'}`,
    `debug:  ${activity.debugging ? 'running' : 'idle'}`,
    '',
    'controls:',
    '  echo press > button_a  # select / confirm current UI action',
    '  echo press > button_b  # rotate menu selection',
    '  echo press > button_c  # back / cancel current UI',
    '  echo hold  > hold_a    # A-hold UI action when defined',
    '  echo hold  > hold_b    # B-hold UI action when defined',
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
  echo press > button_a  # select / confirm current UI action
  echo press > button_b  # rotate menu selection
  echo press > button_c  # back / cancel current UI
  echo hold  > hold_a    # A-hold UI action when defined
  echo hold  > hold_b    # B-hold UI action when defined
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
