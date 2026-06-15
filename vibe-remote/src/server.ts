import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { StateMonitor } from './stateMonitor';
import type {
  AgentStatusSnapshot,
  InboundMessage,
  OutboundMessage,
  StateMessage
} from './protocol';

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
  private authenticatedSockets = new Set<WebSocket>();
  private agentStatus: AgentStatusSnapshot | undefined;
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
      this.log(`接続: ${req.socket.remoteAddress}`);
      socket.on('message', (data) => this.handleMessage(socket, data.toString()));
      socket.on('error', (err) => this.log(`ソケットエラー: ${err.message}`));
      socket.on('close', () => this.authenticatedSockets.delete(socket));
    });

    this.wss.on('error', (err) => {
      this.log(`サーバエラー: ${err.message}`);
      void vscode.window.showErrorMessage(
        `Vibe Remote サーバ起動失敗: ${err.message}`
      );
    });

    this.wss.on('listening', () => {
      this.log(
        `待受開始 ws://${this.opts.host}:${this.opts.port} (token: ${maskToken(
          this.opts.token
        )})`
      );
    });

    // 定期ポーリングで状態を配信
    this.pollTimer = setInterval(() => this.broadcastStateIfChanged(), this.opts.pollIntervalMs);
  }

  private handleMessage(socket: WebSocket, raw: string): void {
    let msg: InboundMessage;
    try {
      msg = JSON.parse(raw) as InboundMessage;
    } catch {
      this.sendAck(socket, false, 'JSON解析エラー');
      return;
    }

    if (msg.type === 'ping') {
      if (!this.authenticate(socket, msg.token)) {
        return;
      }
      this.sendState(socket, this.buildState());
      return;
    }

    if (msg.type === 'hello') {
      if (!this.authenticate(socket, msg.token)) {
        return;
      }
      this.sendAck(socket, true);
      this.sendState(socket, this.buildState());
      return;
    }

    if (msg.type === 'agentStatus') {
      if (!this.authenticate(socket, msg.token)) {
        return;
      }
      if (!isAgentStatus(msg.status)) {
        this.sendAck(socket, false, `未知のagent status: ${msg.status}`);
        return;
      }

      const now = Date.now();
      const ttlMs = Number.isFinite(msg.ttlMs) && msg.ttlMs! > 0
        ? Math.min(msg.ttlMs!, 30 * 60 * 1000)
        : undefined;
      this.agentStatus = {
        source: msg.source?.trim() || 'agent',
        status: msg.status,
        message: msg.message?.trim() || undefined,
        updatedAt: now,
        expiresAt: ttlMs ? now + ttlMs : undefined
      };
      this.log(`agent ${this.agentStatus.source}: ${this.agentStatus.status}${this.agentStatus.message ? ` (${this.agentStatus.message})` : ''}`);
      this.sendAck(socket, true);
      this.broadcastStateIfChanged(true);
      return;
    }

    this.sendAck(socket, false, '未知のメッセージ種別');
  }

  private authenticate(socket: WebSocket, token: string): boolean {
    if (this.isValidToken(token)) {
      this.authenticatedSockets.add(socket);
      return true;
    }

    this.log('トークン不一致のメッセージを拒否');
    this.sendAck(socket, false, 'トークン不一致');
    return false;
  }

  private isValidToken(token: string): boolean {
    const expected = Buffer.from(this.opts.token);
    const actual = Buffer.from(token || '');
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  }

  private buildState(): StateMessage {
    const agent = this.getAgentStatus();
    return {
      type: 'state',
      chat: agentToChatState(agent) ?? this.monitor.computeChatState(this.opts.idleThresholdMs),
      agent,
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

  private broadcastStateIfChanged(force = false): void {
    if (!this.wss) {
      return;
    }
    const state = this.buildState();
    // ts を除いた内容で差分判定（毎回tsだけ変わるので）
    const cmp = JSON.stringify({ ...state, ts: 0 });
    if (!force && cmp === this.lastStateJson) {
      return;
    }
    this.lastStateJson = cmp;
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN && this.authenticatedSockets.has(client)) {
        this.sendState(client, state);
      }
    }
  }

  private sendState(socket: WebSocket, state: StateMessage): void {
    this.send(socket, state);
  }

  private sendAck(socket: WebSocket, ok: boolean, error?: string): void {
    this.send(socket, { type: 'ack', ok, error });
  }

  private send(socket: WebSocket, msg: OutboundMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(msg));
    }
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
    this.authenticatedSockets.clear();
  }
}

function isAgentStatus(status: string): boolean {
  return ['running', 'waiting', 'done', 'failed', 'idle'].includes(status);
}

function agentToChatState(agent: AgentStatusSnapshot | undefined): StateMessage['chat'] | undefined {
  if (!agent) {
    return undefined;
  }
  if (agent.status === 'running') {
    return 'working';
  }
  if (agent.status === 'waiting') {
    return 'maybeWaiting';
  }
  return undefined;
}

function maskToken(token: string): string {
  if (token.length <= 4) {
    return '****';
  }
  return token.slice(0, 2) + '****' + token.slice(-2);
}
