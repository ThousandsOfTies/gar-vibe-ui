import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import {
  dispatchAction,
  isMicStartAction,
  isMicStopAction
} from './commands';
import { StateMonitor } from './stateMonitor';
import type {
  ActionValue,
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
 * - デバイス/仮想リモコンからの操作を受けて公式コマンドを実行
 * - 作業状態を定期配信（LED/画面/ロボ制御用）
 *
 * セキュリティ：全 action メッセージに共有トークンを必須化し、不一致は拒否する。
 */
export class RemoteServer implements vscode.Disposable {
  private wss?: WebSocketServer;
  private pollTimer?: NodeJS.Timeout;
  private authenticatedSockets = new Set<WebSocket>();
  private micOn = false;
  private ttsOn = false;
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
      this.sendAck(socket, false, undefined, 'JSON解析エラー');
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

    if (msg.type === 'action') {
      if (!this.authenticate(socket, msg.token, msg.value)) {
        return;
      }

      // マイク状態の更新（実体を観測できないため送信内容から推定）
      const willStartMic = isMicStartAction(msg.value, this.micOn);
      const willStopMic = isMicStopAction(msg.value, this.micOn);
      if (msg.value === 'readAloud') {
        this.ttsOn = true;
      } else if (msg.value === 'stopRead') {
        this.ttsOn = false;
      }

      dispatchAction(msg.value, () => this.micOn)
        .then((commandId) => {
          if (willStartMic) {
            this.micOn = true;
          }
          if (willStopMic) {
            this.micOn = false;
          }
          this.log(`操作 ${msg.value} → ${commandId}`);
          this.sendAck(socket, true, msg.value);
          // 状態が変わった可能性が高いので即配信
          this.broadcastStateIfChanged(true);
        })
        .catch((err: Error) => {
          this.log(`操作失敗 ${msg.value}: ${err.message}`);
          this.sendAck(socket, false, msg.value, err.message);
        });
      return;
    }

    this.sendAck(socket, false, undefined, '未知のメッセージ種別');
  }

  private authenticate(socket: WebSocket, token: string, value?: ActionValue): boolean {
    if (this.isValidToken(token)) {
      this.authenticatedSockets.add(socket);
      return true;
    }

    this.log('トークン不一致のメッセージを拒否');
    this.sendAck(socket, false, value, 'トークン不一致');
    return false;
  }

  private isValidToken(token: string): boolean {
    const expected = Buffer.from(this.opts.token);
    const actual = Buffer.from(token || '');
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  }

  private buildState(): StateMessage {
    return {
      type: 'state',
      chat: this.monitor.computeChatState(this.opts.idleThresholdMs),
      mic: this.micOn ? 'on' : 'off',
      tts: this.ttsOn ? 'on' : 'off',
      activity: this.monitor.getActivity(),
      ts: Date.now()
    };
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

  private sendAck(
    socket: WebSocket,
    ok: boolean,
    value?: ActionValue,
    error?: string
  ): void {
    this.send(socket, { type: 'ack', ok, value, error });
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

function maskToken(token: string): string {
  if (token.length <= 4) {
    return '****';
  }
  return token.slice(0, 2) + '****' + token.slice(-2);
}
