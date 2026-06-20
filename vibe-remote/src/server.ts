import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { StateMonitor } from './stateMonitor';
import type {
  AgentStatusSnapshot,
  DeviceUiSpec,
  InboundMessage,
  OutboundMessage,
  StateMessage,
  UiActionSnapshot
} from './protocol';
import { agentToChatState, isAgentStatus, normalizeDeviceUi } from './protocolHelpers';

export interface RemoteClient {
  label: string;
  send(msg: OutboundMessage): void;
}

export interface ServerOptions {
  port: number;
  host: string;
  token: string;
  idleThresholdMs: number;
  pollIntervalMs: number;
}

/**
 * ローカルWebSocketサーバ。
 * - MCP/外部エージェントからの自己申告ステータスを受け取る
 * - 作業状態を状態ビューアへ定期配信する
 *
 * セキュリティ：全メッセージに共有トークンを必須化し、不一致は拒否する。
 */
export class RemoteServer implements vscode.Disposable {
  private wss?: WebSocketServer;
  private pollTimer?: NodeJS.Timeout;
  private clients = new Set<RemoteClient>();
  private authenticatedClients = new Set<RemoteClient>();
  private agentStatus: AgentStatusSnapshot | undefined;
  private deviceUi: DeviceUiSpec | undefined;
  private lastUiAction: UiActionSnapshot | undefined;
  private lastStateJson = '';

  private readonly output: vscode.OutputChannel;

  constructor(
    private readonly opts: ServerOptions,
    private readonly monitor: StateMonitor,
    output: vscode.OutputChannel
  ) {
    this.output = output;
  }

  start(): void {
    this.wss = new WebSocketServer({
      port: this.opts.port,
      host: this.opts.host
    });

    this.wss.on('connection', (socket, req) => {
      const client: RemoteClient = {
        label: `ws:${req.socket.remoteAddress ?? 'unknown'}`,
        send: (msg) => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(msg));
          }
        }
      };
      this.clients.add(client);
      this.log(`接続: ${client.label}`);
      socket.on('message', (data) => this.handleMessage(client, data.toString()));
      socket.on('error', (err) => this.log(`ソケットエラー: ${err.message}`));
      socket.on('close', () => {
        this.authenticatedClients.delete(client);
        this.clients.delete(client);
      });
    });

    this.wss.on('error', (err) => {
      this.log(`サーバエラー: ${err.message}`);
      void vscode.window.showErrorMessage(`Vibe Remote サーバ起動失敗: ${err.message}`);
    });

    this.wss.on('listening', () => {
      this.log(
        `待受開始 ws://${this.opts.host}:${this.opts.port} (token: ${maskToken(this.opts.token)})`
      );
    });

    // 定期ポーリングで状態を配信
    this.pollTimer = setInterval(() => this.broadcastStateIfChanged(), this.opts.pollIntervalMs);
  }

  addClient(client: RemoteClient): vscode.Disposable {
    this.clients.add(client);
    this.log(`接続: ${client.label}`);
    return new vscode.Disposable(() => {
      this.authenticatedClients.delete(client);
      this.clients.delete(client);
      this.log(`切断: ${client.label}`);
    });
  }

  receive(client: RemoteClient, raw: string): void {
    this.handleMessage(client, raw);
  }

  private handleMessage(client: RemoteClient, raw: string): void {
    let msg: InboundMessage;
    try {
      msg = JSON.parse(raw) as InboundMessage;
    } catch {
      this.sendAck(client, false, 'JSON解析エラー');
      return;
    }

    if (msg.type === 'ping') {
      if (!this.authenticate(client, msg.token)) {
        return;
      }
      this.sendState(client, this.buildState());
      return;
    }

    if (msg.type === 'hello') {
      if (!this.authenticate(client, msg.token)) {
        return;
      }
      this.sendAck(client, true);
      this.sendState(client, this.buildState());
      return;
    }

    if (msg.type === 'agentStatus') {
      if (!this.authenticate(client, msg.token)) {
        return;
      }
      if (!isAgentStatus(msg.status)) {
        this.sendAck(client, false, `未知のagent status: ${msg.status}`);
        return;
      }

      const now = Date.now();
      const ttlMs =
        Number.isFinite(msg.ttlMs) && msg.ttlMs! > 0
          ? Math.min(msg.ttlMs!, 30 * 60 * 1000)
          : undefined;
      this.agentStatus = {
        source: msg.source?.trim() || 'agent',
        status: msg.status,
        message: msg.message?.trim() || undefined,
        updatedAt: now,
        expiresAt: ttlMs ? now + ttlMs : undefined
      };
      this.log(
        `agent ${this.agentStatus.source}: ${this.agentStatus.status}${this.agentStatus.message ? ` (${this.agentStatus.message})` : ''}`
      );
      this.sendAck(client, true);
      this.broadcastStateIfChanged(true);
      return;
    }

    if (msg.type === 'deviceUi') {
      if (!this.authenticate(client, msg.token)) {
        return;
      }
      const ui = normalizeDeviceUi(msg.ui);
      if (!ui) {
        this.sendAck(client, false, 'device UI が不正です');
        return;
      }
      this.deviceUi = ui;
      this.log(`device UI ${ui.id}: ${ui.state ?? 'idle'} ${ui.title ?? ''}`.trim());
      this.sendAck(client, true);
      this.broadcastStateIfChanged(true);
      return;
    }

    if (msg.type === 'clearDeviceUi') {
      if (!this.authenticate(client, msg.token)) {
        return;
      }
      if (!msg.uiId || this.deviceUi?.id === msg.uiId) {
        this.deviceUi = undefined;
      }
      this.sendAck(client, true);
      this.broadcastStateIfChanged(true);
      return;
    }

    if (msg.type === 'uiAction') {
      if (!this.authenticate(client, msg.token)) {
        return;
      }
      if (!msg.uiId || !msg.actionId) {
        this.sendAck(client, false, 'uiId/actionId が必要です');
        return;
      }
      this.lastUiAction = {
        uiId: msg.uiId,
        actionId: msg.actionId,
        button: msg.button,
        source: msg.source?.trim() || 'device',
        ts: Date.now()
      };
      this.log(
        `ui action ${this.lastUiAction.uiId}: ${this.lastUiAction.actionId} (${this.lastUiAction.source})`
      );
      this.sendAck(client, true);
      this.broadcastStateIfChanged(true);
      return;
    }

    if (msg.type === 'getUiAction') {
      if (!this.authenticate(client, msg.token)) {
        return;
      }
      const action =
        !msg.uiId || this.lastUiAction?.uiId === msg.uiId ? this.lastUiAction : undefined;
      this.send(client, { type: 'uiActionResult', action });
      if (action && msg.consume !== false) {
        this.lastUiAction = undefined;
      }
      return;
    }

    this.sendAck(client, false, '未知のメッセージ種別');
  }

  private authenticate(client: RemoteClient, token: string): boolean {
    if (this.isValidToken(token)) {
      this.authenticatedClients.add(client);
      return true;
    }

    this.log(`トークン不一致のメッセージを拒否: ${client.label}`);
    this.sendAck(client, false, 'トークン不一致');
    return false;
  }

  private isValidToken(token: string): boolean {
    const expected = Buffer.from(this.opts.token);
    const actual = Buffer.from(token || '');
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  }

  private buildState(): StateMessage {
    const agent = this.getAgentStatus();
    const ui = this.getDeviceUi();
    return {
      type: 'state',
      chat: ui
        ? 'maybeWaiting'
        : (agentToChatState(agent) ?? this.monitor.computeChatState(this.opts.idleThresholdMs)),
      agent,
      ui,
      activity: this.monitor.getActivity(),
      ts: Date.now()
    };
  }

  private getAgentStatus(): AgentStatusSnapshot | undefined {
    if (this.agentStatus?.expiresAt && this.agentStatus.expiresAt <= Date.now()) {
      this.agentStatus = undefined;
    }
    return this.agentStatus;
  }

  private getDeviceUi(): DeviceUiSpec | undefined {
    if (this.deviceUi?.expiresAt && this.deviceUi.expiresAt <= Date.now()) {
      this.deviceUi = undefined;
    }
    return this.deviceUi;
  }

  private broadcastStateIfChanged(force = false): void {
    if (!this.wss && this.clients.size === 0) {
      return;
    }
    const state = this.buildState();
    // ts を除いた内容で差分判定（毎回tsだけ変わるので）
    const cmp = JSON.stringify({ ...state, ts: 0 });
    if (!force && cmp === this.lastStateJson) {
      return;
    }
    this.lastStateJson = cmp;
    for (const client of this.clients) {
      if (this.authenticatedClients.has(client)) {
        this.sendState(client, state);
      }
    }
  }

  private sendState(client: RemoteClient, state: StateMessage): void {
    this.send(client, state);
  }

  private sendAck(client: RemoteClient, ok: boolean, error?: string): void {
    this.send(client, { type: 'ack', ok, error });
  }

  private send(client: RemoteClient, msg: OutboundMessage): void {
    client.send(msg);
  }

  private log(line: string): void {
    this.output.appendLine(`[${new Date().toLocaleTimeString()}] ${line}`);
  }

  dispose(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    if (this.wss) {
      for (const client of this.wss.clients) {
        client.terminate();
      }
      this.wss.close();
      this.wss = undefined;
    }
    this.authenticatedClients.clear();
    this.clients.clear();
  }
}

function maskToken(token: string): string {
  if (token.length <= 4) {
    return '****';
  }
  return token.slice(0, 2) + '****' + token.slice(-2);
}
