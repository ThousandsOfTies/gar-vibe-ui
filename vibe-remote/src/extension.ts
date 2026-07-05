import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { RemoteServer, ServerOptions } from './server';
import { ApprovalBrokerManager } from './approvalBrokerManager';
import { DiscoveryPublisher } from './discovery';
import { LocalBridgeManager } from './localBridgeManager';
import { SerialSppBridge, SerialSppBridgeOptions } from './serialSppBridge';
import { StateMonitor } from './stateMonitor';
import { getStatusViewerHtml } from './webview';

const TOKEN_KEY = 'vibeRemote.token.v2';

let server: RemoteServer | undefined;
let discovery: DiscoveryPublisher | undefined;
let sppBridge: SerialSppBridge | undefined;
let localBridge: LocalBridgeManager | undefined;
let approvalBroker: ApprovalBrokerManager | undefined;
let monitor: StateMonitor | undefined;
let statusBar: vscode.StatusBarItem | undefined;
let output: vscode.OutputChannel;
let currentToken = '';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  output = vscode.window.createOutputChannel('Vibe Remote');
  context.subscriptions.push(output);

  currentToken = await ensureToken(context);

  monitor = new StateMonitor();
  context.subscriptions.push(monitor);
  localBridge = new LocalBridgeManager(context.extensionPath, output);
  context.subscriptions.push(localBridge);
  approvalBroker = new ApprovalBrokerManager(context.extensionPath, output, () => currentToken);
  context.subscriptions.push(approvalBroker);

  startServer(context, currentToken);
  void syncApprovalBroker(false);

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'vibeRemote.openVirtualRemote';
  statusBar.text = '$(broadcast) Vibe';
  statusBar.tooltip = 'Vibe Remote: クリックで状態ビューアを開く';
  statusBar.show();
  context.subscriptions.push(statusBar);

  context.subscriptions.push(
    vscode.commands.registerCommand('vibeRemote.openVirtualRemote', () =>
      openVirtualRemote(context, currentToken)
    ),
    vscode.commands.registerCommand('vibeRemote.showToken', () => {
      void vscode.window.showInformationMessage(`Vibe Remote 接続トークン: ${currentToken}`);
    }),
    vscode.commands.registerCommand('vibeRemote.restartServer', () => {
      restartServer(context, currentToken);
      void vscode.window.showInformationMessage('Vibe Remote サーバを再起動しました。');
    }),
    vscode.commands.registerCommand('vibeRemote.regenerateToken', async () => {
      const nextToken = await regenerateToken(context);
      if (!nextToken) {
        return;
      }
      currentToken = nextToken;
      restartServer(context, currentToken);
      void vscode.window.showInformationMessage(
        `Vibe Remote 接続トークンを再生成しました: ${currentToken}`
      );
    }),
    vscode.commands.registerCommand('vibeRemote.startLocalBridge', () => localBridge?.start()),
    vscode.commands.registerCommand('vibeRemote.stopLocalBridge', () => localBridge?.stop()),
    vscode.commands.registerCommand('vibeRemote.showLocalBridgeStatus', () =>
      localBridge?.showStatus()
    ),
    vscode.commands.registerCommand('vibeRemote.startApprovalBroker', () =>
      approvalBroker?.start()
    ),
    vscode.commands.registerCommand('vibeRemote.stopApprovalBroker', () => approvalBroker?.stop()),
    vscode.commands.registerCommand('vibeRemote.showApprovalBrokerStatus', () =>
      approvalBroker?.showStatus()
    )
  );

  // 設定変更でサーバ再起動
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration('vibeRemote')) {
        currentToken = await ensureToken(context);
        restartServer(context, currentToken);
        if (e.affectsConfiguration('vibeRemote.approvalBroker')) {
          void syncApprovalBroker(true);
        }
      }
    })
  );
}

export function deactivate(): void {
  server?.dispose();
  server = undefined;
  discovery?.dispose();
  discovery = undefined;
  sppBridge?.dispose();
  sppBridge = undefined;
  localBridge?.dispose();
  localBridge = undefined;
  approvalBroker?.dispose();
  approvalBroker = undefined;
}

async function ensureToken(context: vscode.ExtensionContext): Promise<string> {
  const configuredToken = vscode.workspace
    .getConfiguration('vibeRemote')
    .get<string>('token', '')
    .trim();
  if (configuredToken) {
    return configuredToken;
  }

  let token = await context.secrets.get(TOKEN_KEY);
  if (!token) {
    token = createToken();
    await context.secrets.store(TOKEN_KEY, token);
  }
  return token;
}

async function regenerateToken(context: vscode.ExtensionContext): Promise<string | undefined> {
  const configuredToken = vscode.workspace
    .getConfiguration('vibeRemote')
    .get<string>('token', '')
    .trim();
  if (configuredToken) {
    void vscode.window.showWarningMessage(
      'vibeRemote.token が設定されているため自動生成トークンは再生成できません。設定値を空にすると再生成できます。'
    );
    return undefined;
  }

  const token = createToken();
  await context.secrets.store(TOKEN_KEY, token);
  return token;
}

function createToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

function readOptions(token: string): ServerOptions {
  const cfg = vscode.workspace.getConfiguration('vibeRemote');
  return {
    token,
    port: cfg.get<number>('port', 39271),
    host: cfg.get<string>('bindAddress', '127.0.0.1'),
    idleThresholdMs: cfg.get<number>('idleThresholdMs', 4000),
    pollIntervalMs: cfg.get<number>('pollIntervalMs', 1000)
  };
}

function readDiscoveryOptions() {
  const cfg = vscode.workspace.getConfiguration('vibeRemote');
  return {
    enabled: cfg.get<boolean>('discoveryEnabled', false),
    serviceType: cfg.get<string>('discoveryServiceType', 'vibe-remote'),
    serviceName: cfg.get<string>('discoveryServiceName', 'Vibe Remote')
  };
}

function readSppOptions(): SerialSppBridgeOptions {
  const cfg = vscode.workspace.getConfiguration('vibeRemote');
  return {
    enabled: cfg.get<boolean>('sppEnabled', false),
    path: cfg.get<string>('sppPort', ''),
    baudRate: cfg.get<number>('sppBaudRate', 115200)
  };
}

function startServer(context: vscode.ExtensionContext, token: string): void {
  const opts = readOptions(token);
  server = new RemoteServer(opts, monitor!, output);
  server.start();

  const discoveryOpts = readDiscoveryOptions();
  discovery = new DiscoveryPublisher(
    {
      ...discoveryOpts,
      port: opts.port,
      bindAddress: opts.host
    },
    output
  );
  discovery.start();

  sppBridge = new SerialSppBridge(readSppOptions(), server, output);
  sppBridge.start();
}

function restartServer(context: vscode.ExtensionContext, token: string): void {
  sppBridge?.dispose();
  server?.dispose();
  discovery?.dispose();
  startServer(context, token);
}

function openVirtualRemote(context: vscode.ExtensionContext, token: string): void {
  const opts = readOptions(token);
  const panel = vscode.window.createWebviewPanel(
    'vibeRemote.virtualRemote',
    'Vibe Remote（状態ビューア）',
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  // 状態ビューアはローカル接続するため、host が 0.0.0.0 でも 127.0.0.1 へ繋ぐ
  const wsHost = opts.host === '0.0.0.0' ? '127.0.0.1' : opts.host;
  panel.webview.html = getStatusViewerHtml(wsHost, opts.port, token);
}

async function syncApprovalBroker(stopWhenDisabled: boolean): Promise<void> {
  const enabled = vscode.workspace
    .getConfiguration('vibeRemote.approvalBroker')
    .get<boolean>('enabled', false);
  if (enabled) {
    if (stopWhenDisabled) {
      await approvalBroker?.stop(false);
    }
    await approvalBroker?.start(false);
  } else if (stopWhenDisabled) {
    await approvalBroker?.stop(false);
  }
}
