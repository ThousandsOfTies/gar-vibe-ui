#!/usr/bin/env node

const { WebSocket } = require('ws');

const DEFAULT_HOST = process.env.VIBE_REMOTE_HOST || '127.0.0.1';
const DEFAULT_PORT = Number(process.env.VIBE_REMOTE_PORT || 39271);
const DEFAULT_TOKEN = process.env.VIBE_REMOTE_TOKEN || '';
const DEFAULT_TTL_SECONDS = Number(process.env.VIBE_REMOTE_TTL_SECONDS || 120);
const DEFAULT_REQUEST_TIMEOUT_MS = Number(process.env.VIBE_REMOTE_REQUEST_TIMEOUT_MS || 5000);
const DEFAULT_ACTION_TIMEOUT_SECONDS = Number(process.env.VIBE_REMOTE_ACTION_TIMEOUT_SECONDS || 60);
const ACTION_POLL_INTERVAL_MS = Number(process.env.VIBE_REMOTE_ACTION_POLL_INTERVAL_MS || 1000);

let remoteClient;
let requestQueue = Promise.resolve();

const tools = [
  {
    name: 'vibe_remote_set_status',
    description: 'Report the current agent status to Vibe Remote.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['running', 'waiting', 'done', 'failed', 'idle'],
          description: 'Current agent state.'
        },
        message: { type: 'string', description: 'Short status message for the remote display.' },
        source: { type: 'string', description: 'Agent/source label. Defaults to codex.' },
        ttl_seconds: { type: 'number', description: 'How long the status remains fresh.' }
      },
      required: ['status'],
      additionalProperties: false
    }
  },
  {
    name: 'vibe_remote_heartbeat',
    description: 'Refresh Vibe Remote with a running heartbeat while the agent is working.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Short progress message.' },
        source: { type: 'string', description: 'Agent/source label. Defaults to codex.' },
        ttl_seconds: { type: 'number', description: 'How long the heartbeat remains fresh.' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'vibe_remote_request_decision',
    description: 'Tell Vibe Remote that the agent is waiting for a human decision.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Decision prompt summary.' },
        choices: {
          type: 'array',
          items: { type: 'string' },
          description: 'Short choice labels.'
        },
        source: { type: 'string', description: 'Agent/source label. Defaults to codex.' },
        ttl_seconds: { type: 'number', description: 'How long the waiting status remains fresh.' }
      },
      required: ['message'],
      additionalProperties: false
    },
    outputSchema: {
      type: 'object',
      properties: {
        ui_id: { type: 'string' },
        status: { type: 'string' },
        action_count: { type: 'number' },
        timeout_seconds: { type: 'number' }
      },
      required: ['ui_id', 'status', 'action_count', 'timeout_seconds'],
      additionalProperties: false
    }
  },
  {
    name: 'vibe_remote_show_ui',
    description:
      'Show a small declarative UI on Vibe Remote devices. Limits: title 32 chars, message 120 chars, up to 3 fields, up to 3 actions mapped to A/B/P or hold variants.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Stable UI id. Defaults to a generated id.' },
        title: { type: 'string', description: 'Short title, max 32 chars.' },
        state: {
          type: 'string',
          enum: ['running', 'waiting', 'done', 'failed', 'idle'],
          description: 'UI state color/mood.'
        },
        message: { type: 'string', description: 'Short body text, max 120 chars.' },
        fields: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              value: { type: 'string' }
            },
            required: ['label', 'value'],
            additionalProperties: false
          },
          description: 'Up to 3 compact key/value rows.'
        },
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              label: { type: 'string' },
              button: {
                type: 'string',
                enum: ['A', 'B', 'P', 'A-hold', 'B-hold', 'P-hold']
              }
            },
            required: ['id', 'label'],
            additionalProperties: false
          },
          description: 'Up to 3 actions. Short labels work best: OK, NG, Retry.'
        },
        source: { type: 'string', description: 'Agent/source label. Defaults to codex.' },
        ttl_seconds: { type: 'number', description: 'How long the UI remains fresh.' }
      },
      additionalProperties: false
    },
    outputSchema: {
      type: 'object',
      properties: {
        ui_id: { type: 'string' },
        status: { type: 'string' },
        action_count: { type: 'number' },
        timeout_seconds: { type: 'number' }
      },
      required: ['ui_id', 'status', 'action_count', 'timeout_seconds'],
      additionalProperties: false
    }
  },
  {
    name: 'vibe_remote_get_action',
    description: 'Read the latest action selected on a Vibe Remote device.',
    inputSchema: {
      type: 'object',
      properties: {
        ui_id: { type: 'string', description: 'Only return actions for this UI id.' },
        consume: {
          type: 'boolean',
          description: 'Whether to consume the action. Defaults to true.'
        },
        timeout_seconds: {
          type: 'number',
          description:
            'How long to wait for an action before returning empty. Defaults to 60 seconds. Use 0 for immediate polling.'
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'vibe_remote_clear_ui',
    description: 'Clear the small declarative UI from Vibe Remote devices.',
    inputSchema: {
      type: 'object',
      properties: {
        ui_id: { type: 'string', description: 'Only clear this UI id.' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'vibe_remote_clear_status',
    description: 'Clear or mark the agent status as idle on Vibe Remote.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Optional final message.' },
        source: { type: 'string', description: 'Agent/source label. Defaults to codex.' }
      },
      additionalProperties: false
    }
  }
];

let inputBuffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  inputBuffer += chunk;
  let idx;
  while ((idx = inputBuffer.indexOf('\n')) !== -1) {
    const line = inputBuffer.slice(0, idx).trim();
    inputBuffer = inputBuffer.slice(idx + 1);
    if (line) {
      void handleLine(line);
    }
  }
});

async function handleLine(line) {
  let req;
  try {
    req = JSON.parse(line);
  } catch (err) {
    write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: err.message } });
    return;
  }

  if (!('id' in req)) {
    return;
  }

  try {
    const result = await handleRequest(req.method, req.params || {});
    write({ jsonrpc: '2.0', id: req.id, result });
  } catch (err) {
    write({
      jsonrpc: '2.0',
      id: req.id,
      error: { code: -32000, message: err.message || String(err) }
    });
  }
}

async function handleRequest(method, params) {
  if (method === 'initialize') {
    return {
      protocolVersion: params.protocolVersion || '2025-11-25',
      capabilities: { tools: {} },
      serverInfo: { name: 'vibe-remote', version: '0.1.0' },
      instructions:
        'Use vibe_remote_heartbeat while working, vibe_remote_show_ui or vibe_remote_request_decision before asking the user for a choice, vibe_remote_get_action to read the device response, and vibe_remote_set_status when work completes or fails. Device UI supports title, state, message, up to 3 fields, and up to 3 actions mapped to A/B/P or hold variants.'
    };
  }
  if (method === 'tools/list') {
    return { tools };
  }
  if (method === 'tools/call') {
    return callTool(params.name, params.arguments || {});
  }
  throw new Error(`Unsupported method: ${method}`);
}

async function callTool(name, args) {
  if (name === 'vibe_remote_set_status') {
    await postStatus({
      status: args.status,
      message: args.message,
      source: args.source,
      ttlSeconds: args.ttl_seconds
    });
    return textResult(`Vibe Remote status set to ${args.status}.`);
  }
  if (name === 'vibe_remote_heartbeat') {
    await postStatus({
      status: 'running',
      message: args.message || 'working',
      source: args.source,
      ttlSeconds: args.ttl_seconds
    });
    return textResult('Vibe Remote heartbeat posted.');
  }
  if (name === 'vibe_remote_request_decision') {
    const choices =
      Array.isArray(args.choices) && args.choices.length
        ? ` choices: ${args.choices.join(' / ')}`
        : '';
    const uiId = `decision-${Date.now().toString(36)}`;
    await postStatus({
      status: 'waiting',
      message: `${args.message}${choices}`,
      source: args.source,
      ttlSeconds: args.ttl_seconds
    });
    await postDeviceUi({
      id: uiId,
      title: 'Decision',
      state: 'waiting',
      message: args.message,
      actions: normalizeChoiceActions(args.choices),
      source: args.source,
      ttlSeconds: args.ttl_seconds
    });
    return toolResult(`Vibe Remote decision request posted. ui_id=${uiId}`, {
      ui_id: uiId,
      status: 'waiting',
      action_count: normalizeChoiceActions(args.choices).length,
      timeout_seconds: DEFAULT_ACTION_TIMEOUT_SECONDS
    });
  }
  if (name === 'vibe_remote_show_ui') {
    const uiId = args.id || `ui-${Date.now().toString(36)}`;
    await postDeviceUi({
      id: uiId,
      title: args.title,
      state: args.state || 'waiting',
      message: args.message,
      fields: args.fields,
      actions: args.actions,
      source: args.source,
      ttlSeconds: args.ttl_seconds
    });
    return toolResult(`Vibe Remote UI shown. ui_id=${uiId}`, {
      ui_id: uiId,
      status: args.state || 'waiting',
      action_count: Array.isArray(args.actions) ? Math.min(args.actions.length, 3) : 0,
      timeout_seconds: DEFAULT_ACTION_TIMEOUT_SECONDS
    });
  }
  if (name === 'vibe_remote_get_action') {
    const action = await getUiAction({
      uiId: args.ui_id,
      consume: args.consume,
      timeoutSeconds: args.timeout_seconds
    });
    return textResult(action ? JSON.stringify(action) : 'No Vibe Remote UI action before timeout.');
  }
  if (name === 'vibe_remote_clear_ui') {
    await clearDeviceUi({ uiId: args.ui_id });
    return textResult('Vibe Remote UI cleared.');
  }
  if (name === 'vibe_remote_clear_status') {
    await postStatus({
      status: 'idle',
      message: args.message,
      source: args.source,
      ttlSeconds: 10
    });
    return textResult('Vibe Remote status cleared.');
  }
  throw new Error(`Unknown tool: ${name}`);
}

async function postStatus({ status, message, source, ttlSeconds }) {
  if (!DEFAULT_TOKEN) {
    throw new Error(
      'VIBE_REMOTE_TOKEN is required. Run "Vibe Remote: 接続トークンを表示" and configure it as an MCP env var.'
    );
  }
  if (!['running', 'waiting', 'done', 'failed', 'idle'].includes(status)) {
    throw new Error(`Invalid status: ${status}`);
  }

  const ttl = Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : DEFAULT_TTL_SECONDS;

  await sendWs({
    type: 'agentStatus',
    token: DEFAULT_TOKEN,
    status,
    source: source || 'codex',
    message,
    ttlMs: Math.round(ttl * 1000)
  });
}

async function postDeviceUi({ id, title, state, message, fields, actions, source, ttlSeconds }) {
  if (!DEFAULT_TOKEN) {
    throw new Error(
      'VIBE_REMOTE_TOKEN is required. Run "Vibe Remote: 接続トークンを表示" and configure it as an MCP env var.'
    );
  }
  const ttl = Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : DEFAULT_TTL_SECONDS;
  await sendWs({
    type: 'deviceUi',
    token: DEFAULT_TOKEN,
    ui: {
      id,
      title,
      state,
      message,
      fields,
      actions,
      source: source || 'codex',
      ttlMs: Math.round(ttl * 1000)
    }
  });
}

async function getUiAction({ uiId, consume, timeoutSeconds }) {
  if (!DEFAULT_TOKEN) {
    throw new Error(
      'VIBE_REMOTE_TOKEN is required. Run "Vibe Remote: 接続トークンを表示" and configure it as an MCP env var.'
    );
  }
  const timeoutMs = Math.max(
    0,
    Math.round(
      (Number.isFinite(timeoutSeconds) ? timeoutSeconds : DEFAULT_ACTION_TIMEOUT_SECONDS) * 1000
    )
  );
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const action = await readUiAction({ uiId, consume });
    if (action || timeoutMs === 0 || Date.now() >= deadline) {
      return action;
    }
    await sleep(Math.min(ACTION_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
  }
}

async function readUiAction({ uiId, consume }) {
  const result = await sendWs(
    {
      type: 'getUiAction',
      token: DEFAULT_TOKEN,
      uiId,
      consume: consume !== false
    },
    'uiActionResult'
  );
  return result.action;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function clearDeviceUi({ uiId }) {
  if (!DEFAULT_TOKEN) {
    throw new Error(
      'VIBE_REMOTE_TOKEN is required. Run "Vibe Remote: 接続トークンを表示" and configure it as an MCP env var.'
    );
  }
  await sendWs({
    type: 'clearDeviceUi',
    token: DEFAULT_TOKEN,
    uiId
  });
}

function normalizeChoiceActions(choices) {
  if (!Array.isArray(choices) || choices.length === 0) {
    return [
      { id: 'ok', label: 'OK', button: 'A' },
      { id: 'ng', label: 'NG', button: 'B' }
    ];
  }
  const buttons = ['A', 'B', 'P'];
  return choices.slice(0, 3).map((choice, index) => ({
    id:
      String(choice)
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .slice(0, 24) || `choice_${index + 1}`,
    label: String(choice).slice(0, 10),
    button: buttons[index]
  }));
}

function sendWs(message, expectedType = 'ack') {
  requestQueue = requestQueue
    .catch(() => undefined)
    .then(() => remote().request(message, expectedType));
  return requestQueue;
}

function remote() {
  if (!remoteClient) {
    remoteClient = new PersistentRemoteClient(`ws://${DEFAULT_HOST}:${DEFAULT_PORT}`);
  }
  return remoteClient;
}

class PersistentRemoteClient {
  constructor(url) {
    this.url = url;
    this.ws = undefined;
    this.connecting = undefined;
    this.pending = undefined;
  }

  async request(message, expectedType = 'ack') {
    const ws = await this.connect();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending = undefined;
        reject(new Error(`Timed out waiting for ${expectedType} from ${this.url}`));
      }, DEFAULT_REQUEST_TIMEOUT_MS);

      this.pending = {
        expectedType,
        resolve: (value) => {
          clearTimeout(timeout);
          this.pending = undefined;
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timeout);
          this.pending = undefined;
          reject(err);
        }
      };

      try {
        ws.send(JSON.stringify(message));
      } catch (err) {
        clearTimeout(timeout);
        this.pending = undefined;
        reject(err);
      }
    });
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return Promise.resolve(this.ws);
    }
    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      const timeout = setTimeout(() => {
        ws.close();
        this.connecting = undefined;
        reject(new Error(`Timed out connecting to ${this.url}`));
      }, DEFAULT_REQUEST_TIMEOUT_MS);

      ws.on('open', () => {
        clearTimeout(timeout);
        this.ws = ws;
        this.connecting = undefined;
        resolve(ws);
      });
      ws.on('message', (data) => this.handleMessage(data));
      ws.on('close', () => {
        if (this.ws === ws) {
          this.ws = undefined;
        }
        if (this.pending) {
          this.pending.reject(new Error(`Connection closed: ${this.url}`));
        }
      });
      ws.on('error', (err) => {
        clearTimeout(timeout);
        if (this.connecting) {
          this.connecting = undefined;
          reject(err);
          return;
        }
        if (this.pending) {
          this.pending.reject(err);
        }
      });
    });
    return this.connecting;
  }

  handleMessage(data) {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (err) {
      if (this.pending) {
        this.pending.reject(err);
      }
      return;
    }
    if (!this.pending) {
      return;
    }
    if (this.pending.expectedType !== 'ack' && msg.type === this.pending.expectedType) {
      this.pending.resolve(msg);
      return;
    }
    if (msg.type === 'ack') {
      if (msg.ok) {
        this.pending.resolve();
      } else {
        this.pending.reject(new Error(msg.error || 'Vibe Remote rejected the request'));
      }
    }
  }

  close() {
    this.pending?.reject(new Error('MCP server shutting down'));
    this.pending = undefined;
    this.ws?.close();
    this.ws = undefined;
  }
}

function closeRemote() {
  remoteClient?.close();
}

process.once('beforeExit', closeRemote);
process.once('SIGINT', () => {
  closeRemote();
  process.exit(130);
});
process.once('SIGTERM', () => {
  closeRemote();
  process.exit(143);
});

function textResult(text) {
  return { content: [{ type: 'text', text }] };
}

function toolResult(text, structuredContent) {
  return { content: [{ type: 'text', text }], structuredContent };
}

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
