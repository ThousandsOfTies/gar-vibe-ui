import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { RemoteServer, ServerOptions } from './server';
import { StateMonitor } from './stateMonitor';
import { getStatusViewerHtml } from './webview';

const TOKEN_KEY = 'vibeRemote.token';

let server: RemoteServer | undefined;
let monitor: StateMonitor | undefined;
let statusBar: vscode.StatusBarItem | undefined;
let output: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  output = vscode.window.createOutputChannel('Vibe Remote');
  context.subscriptions.push(output);

  const token = await ensureToken(context);

  monitor = new StateMonitor();
  context.subscriptions.push(monitor);

  startServer(context, token);

  statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBar.command = 'vibeRemote.openVirtualRemote';
  statusBar.text = '$(broadcast) Vibe';
  statusBar.tooltip = 'Vibe Remote: クリックで状態ビューアを開く';
  statusBar.show();
  context.subscriptions.push(statusBar);

  context.subscriptions.push(
    vscode.commands.registerCommand('vibeRemote.openVirtualRemote', () =>
      openVirtualRemote(context, token)
    ),
    vscode.commands.registerCommand('vibeRemote.showToken', () => {
      void vscode.window.showInformationMessage(`Vibe Remote 接続トークン: ${token}`);
    }),
    vscode.commands.registerCommand('vibeRemote.restartServer', () => {
      restartServer(context, token);
      void vscode.window.showInformationMessage('Vibe Remote サーバを再起動しました。');
    })
  );

  // 設定変更でサーバ再起動
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('vibeRemote')) {
        restartServer(context, token);
      }
    })
  );
}

export function deactivate(): void {
  server?.dispose();
  server = undefined;
}

async function ensureToken(context: vscode.ExtensionContext): Promise<string> {
  let token = await context.secrets.get(TOKEN_KEY);
  if (!token) {
    token = crypto.randomBytes(16).toString('hex');
    await context.secrets.store(TOKEN_KEY, token);
  }
  return token;
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

function startServer(context: vscode.ExtensionContext, token: string): void {
  const opts = readOptions(token);
  server = new RemoteServer(opts, monitor!, output);
  server.start();
}

function restartServer(context: vscode.ExtensionContext, token: string): void {
  server?.dispose();
  startServer(context, token);
}

function openVirtualRemote(
  context: vscode.ExtensionContext,
  token: string
): void {
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
