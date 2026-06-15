#!/usr/bin/env node

const { WebSocket } = require('ws');

const DEFAULT_HOST = process.env.VIBE_REMOTE_HOST || '127.0.0.1';
const DEFAULT_PORT = Number(process.env.VIBE_REMOTE_PORT || 39271);
const DEFAULT_TOKEN = process.env.VIBE_REMOTE_TOKEN || '';
const DEFAULT_TTL_SECONDS = Number(process.env.VIBE_REMOTE_TTL_SECONDS || 120);

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
        'Use vibe_remote_heartbeat while working, vibe_remote_request_decision before asking the user for a choice, and vibe_remote_set_status when work completes or fails.'
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
    const choices = Array.isArray(args.choices) && args.choices.length
      ? ` choices: ${args.choices.join(' / ')}`
      : '';
    await postStatus({
      status: 'waiting',
      message: `${args.message}${choices}`,
      source: args.source,
      ttlSeconds: args.ttl_seconds
    });
    return textResult('Vibe Remote decision request posted.');
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
    throw new Error('VIBE_REMOTE_TOKEN is required. Run "Vibe Remote: 接続トークンを表示" and configure it as an MCP env var.');
  }
  if (!['running', 'waiting', 'done', 'failed', 'idle'].includes(status)) {
    throw new Error(`Invalid status: ${status}`);
  }

  const ttl = Number.isFinite(ttlSeconds) && ttlSeconds > 0
    ? ttlSeconds
    : DEFAULT_TTL_SECONDS;

  await sendWs({
    type: 'agentStatus',
    token: DEFAULT_TOKEN,
    status,
    source: source || 'codex',
    message,
    ttlMs: Math.round(ttl * 1000)
  });
}

function sendWs(message) {
  const url = `ws://${DEFAULT_HOST}:${DEFAULT_PORT}`;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`Timed out connecting to ${url}`));
    }, 5000);

    ws.on('open', () => {
      ws.send(JSON.stringify(message));
    });
    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch (err) {
        clearTimeout(timeout);
        ws.close();
        reject(err);
        return;
      }
      if (msg.type === 'ack') {
        clearTimeout(timeout);
        ws.close();
        msg.ok ? resolve() : reject(new Error(msg.error || 'Vibe Remote rejected the status update'));
      }
    });
    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function textResult(text) {
  return { content: [{ type: 'text', text }] };
}

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
