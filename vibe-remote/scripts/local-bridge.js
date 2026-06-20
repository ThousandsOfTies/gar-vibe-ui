#!/usr/bin/env node

const os = require('os');
const { WebSocket, WebSocketServer } = require('ws');

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const upstreamHost = args.upstreamHost || process.env.VIBE_REMOTE_UPSTREAM_HOST || '127.0.0.1';
const upstreamPort = Number(args.upstreamPort || process.env.VIBE_REMOTE_UPSTREAM_PORT || 39271);
const upstreamUrl =
  args.upstreamUrl ||
  process.env.VIBE_REMOTE_UPSTREAM_URL ||
  `ws://${upstreamHost}:${upstreamPort}`;

const listenHost = args.listenHost || process.env.VIBE_REMOTE_BRIDGE_HOST || '0.0.0.0';
const listenPort = Number(args.listenPort || process.env.VIBE_REMOTE_BRIDGE_PORT || 39272);

const discoveryEnabled = readBool(args.discovery, process.env.VIBE_REMOTE_BRIDGE_DISCOVERY, true);
const discoveryType = sanitizeServiceType(
  args.discoveryType || process.env.VIBE_REMOTE_DISCOVERY_TYPE || 'vibe-remote'
);
const discoveryName =
  args.discoveryName || process.env.VIBE_REMOTE_DISCOVERY_NAME || 'Vibe Remote Local Bridge';
const advertiseHost = args.advertiseHost || process.env.VIBE_REMOTE_ADVERTISE_HOST || '';

const sppPort = args.sppPort || process.env.VIBE_REMOTE_SPP_PORT || '';
const sppBaudRate = Number(args.sppBaudRate || process.env.VIBE_REMOTE_SPP_BAUD_RATE || 115200);

if (!Number.isFinite(upstreamPort) || upstreamPort <= 0) {
  fail(`Invalid upstream port: ${upstreamPort}`);
}
if (!Number.isFinite(listenPort) || listenPort <= 0) {
  fail(`Invalid listen port: ${listenPort}`);
}
if (sppPort && (!Number.isFinite(sppBaudRate) || sppBaudRate <= 0)) {
  fail(`Invalid SPP baud rate: ${sppBaudRate}`);
}

let bonjour;
let publishedService;
let server;
let serial;
let serialUpstream;
let serialRx = '';

startWebSocketProxy();
startDiscovery();
if (sppPort) {
  startSerialBridge();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function startWebSocketProxy() {
  server = new WebSocketServer({ host: listenHost, port: listenPort });
  server.on('listening', () => {
    log(`ws proxy listening ws://${listenHost}:${listenPort} -> ${upstreamUrl}`);
  });
  server.on('connection', (downstream, req) => {
    const label = `${req.socket.remoteAddress || 'unknown'}:${req.socket.remotePort || '-'}`;
    log(`device ws connected ${label}`);

    const upstream = new WebSocket(upstreamUrl);
    let upstreamOpen = false;
    const pending = [];

    downstream.on('message', (data) => {
      const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
      if (upstreamOpen) {
        upstream.send(text);
      } else {
        pending.push(text);
      }
    });
    downstream.on('close', () => {
      log(`device ws closed ${label}`);
      upstream.close();
    });
    downstream.on('error', (err) => {
      log(`device ws error ${label}: ${err.message}`);
      upstream.close();
    });

    upstream.on('open', () => {
      upstreamOpen = true;
      log(`upstream connected for ${label}`);
      while (pending.length > 0 && upstream.readyState === WebSocket.OPEN) {
        upstream.send(pending.shift());
      }
    });
    upstream.on('message', (data) => {
      if (downstream.readyState === WebSocket.OPEN) {
        const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
        downstream.send(text);
      }
    });
    upstream.on('close', () => {
      log(`upstream closed for ${label}`);
      downstream.close();
    });
    upstream.on('error', (err) => {
      log(`upstream error for ${label}: ${err.message}`);
      downstream.close();
    });
  });
  server.on('error', (err) => {
    log(`ws proxy error: ${err.message}`);
  });
}

function startDiscovery() {
  if (!discoveryEnabled) {
    log('mDNS discovery disabled');
    return;
  }

  try {
    const { Bonjour } = require('bonjour-service');
    bonjour = new Bonjour();
    const instanceName = `${discoveryName} (${os.hostname()})`;
    const publishOptions = {
      name: instanceName,
      type: discoveryType,
      protocol: 'tcp',
      port: listenPort,
      txt: {
        proto: 'ws',
        auth: 'token',
        bridge: 'local',
        upstream: `${upstreamHost}:${upstreamPort}`
      }
    };
    if (advertiseHost) {
      publishOptions.host = advertiseHost;
    }
    publishedService = bonjour.publish(publishOptions);
    log(
      `mDNS advertising _${discoveryType}._tcp.local name="${instanceName}" ` +
        `host="${advertiseHost || 'default'}" port=${listenPort}`
    );
  } catch (err) {
    log(`mDNS advertise failed: ${err.message}`);
  }
}

function startSerialBridge() {
  let SerialPort;
  try {
    ({ SerialPort } = require('serialport'));
  } catch (err) {
    fail(`serialport module is not available: ${err.message}`);
  }

  serial = new SerialPort({ path: sppPort, baudRate: sppBaudRate, autoOpen: true });
  serial.on('open', () => {
    log(`SPP serial opened ${sppPort} @ ${sppBaudRate}`);
    connectSerialUpstream();
  });
  serial.on('data', (data) => handleSerialData(data));
  serial.on('error', (err) => log(`SPP serial error: ${err.message}`));
  serial.on('close', () => {
    log(`SPP serial closed ${sppPort}`);
    serialUpstream?.close();
  });
}

function connectSerialUpstream() {
  serialUpstream?.close();
  serialUpstream = new WebSocket(upstreamUrl);
  serialUpstream.on('open', () => log(`SPP upstream connected ${upstreamUrl}`));
  serialUpstream.on('message', (data) => {
    if (serial?.writable) {
      serial.write(`${data.toString()}\n`);
    }
  });
  serialUpstream.on('close', () => {
    log('SPP upstream closed; reconnecting in 3s');
    setTimeout(() => {
      if (serial && !serial.destroyed) {
        connectSerialUpstream();
      }
    }, 3000);
  });
  serialUpstream.on('error', (err) => log(`SPP upstream error: ${err.message}`));
}

function handleSerialData(data) {
  serialRx += data.toString('utf8');
  while (serialRx.includes('\n')) {
    const index = serialRx.indexOf('\n');
    const line = serialRx.slice(0, index).trim();
    serialRx = serialRx.slice(index + 1);
    if (!line) {
      continue;
    }
    if (serialUpstream?.readyState === WebSocket.OPEN) {
      serialUpstream.send(line);
    } else {
      log(`drop serial line: upstream not connected`);
    }
  }
  if (serialRx.length > 8192) {
    serialRx = '';
    log('SPP receive buffer overflow; buffer cleared');
  }
}

function shutdown() {
  try {
    publishedService?.stop();
    bonjour?.unpublishAll();
    bonjour?.destroy();
  } catch {
    // no-op
  }
  serialUpstream?.close();
  serial?.close();
  server?.close();
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

function readBool(value, envValue, defaultValue) {
  const raw = value ?? envValue;
  if (raw === undefined || raw === '') {
    return defaultValue;
  }
  return !['0', 'false', 'off', 'no'].includes(String(raw).toLowerCase());
}

function sanitizeServiceType(input) {
  const safe = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return safe || 'vibe-remote';
}

function log(line) {
  console.log(`[${new Date().toISOString()}] ${line}`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function printHelp() {
  console.log(`Vibe Remote Local Bridge

Runs on the local OS (for example Windows) and bridges physical device access to
the Vibe Remote server running in a remote workspace such as WSL.

WebSocket proxy:
  M5Stack/LAN device -> ws://LOCAL_PC:39272 -> ws://127.0.0.1:39271 in WSL

Usage:
  node scripts/local-bridge.js [options]

Options:
  --upstream-host=HOST       Vibe Remote server host as seen from local OS (default: 127.0.0.1)
  --upstream-port=PORT       Vibe Remote server port (default: 39271)
  --upstream-url=URL         Full upstream WebSocket URL
  --listen-host=HOST         Local bridge listen host (default: 0.0.0.0)
  --listen-port=PORT         Local bridge listen port (default: 39272)
  --discovery=false          Disable mDNS advertisement
  --discovery-type=TYPE      mDNS service type (default: vibe-remote)
  --discovery-name=NAME      mDNS instance name
  --advertise-host=HOST      Host/IP to advertise via mDNS, e.g. Windows Wi-Fi IPv4
  --spp-port=PORT            Optional Bluetooth SPP serial port, e.g. COM5 or /dev/rfcomm0
  --spp-baud-rate=BAUD       SPP serial baud rate (default: 115200)

Environment variables mirror the options:
  VIBE_REMOTE_UPSTREAM_HOST, VIBE_REMOTE_UPSTREAM_PORT, VIBE_REMOTE_UPSTREAM_URL
  VIBE_REMOTE_BRIDGE_HOST, VIBE_REMOTE_BRIDGE_PORT, VIBE_REMOTE_BRIDGE_DISCOVERY
  VIBE_REMOTE_DISCOVERY_TYPE, VIBE_REMOTE_DISCOVERY_NAME, VIBE_REMOTE_ADVERTISE_HOST
  VIBE_REMOTE_SPP_PORT, VIBE_REMOTE_SPP_BAUD_RATE
`);
}
