import * as vscode from 'vscode';
import { RemoteClient, RemoteServer } from './server';
import type { OutboundMessage } from './protocol';

interface SerialPortLike {
  write(data: string): void;
  close(callback?: (err?: Error | null) => void): void;
  on(event: 'open', listener: () => void): this;
  on(event: 'data', listener: (data: Buffer) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'close', listener: () => void): this;
}

interface SerialPortCtor {
  new (opts: { path: string; baudRate: number; autoOpen?: boolean }): SerialPortLike;
}

export interface SerialSppBridgeOptions {
  enabled: boolean;
  path: string;
  baudRate: number;
}

export class SerialSppBridge implements vscode.Disposable {
  private port?: SerialPortLike;
  private client?: RemoteClient;
  private clientRegistration?: vscode.Disposable;
  private rx = '';

  constructor(
    private readonly opts: SerialSppBridgeOptions,
    private readonly server: RemoteServer,
    private readonly output: vscode.OutputChannel
  ) {}

  start(): void {
    if (!this.opts.enabled) {
      return;
    }
    if (!this.opts.path.trim()) {
      this.log('SPP serial is enabled but vibeRemote.sppPort is empty');
      void vscode.window.showWarningMessage(
        'Vibe Remote SPP が有効ですが、vibeRemote.sppPort が未設定です。'
      );
      return;
    }

    let SerialPort: SerialPortCtor;
    try {
      ({ SerialPort } = require('serialport') as { SerialPort: SerialPortCtor });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log(`serialport load failed: ${message}`);
      void vscode.window.showErrorMessage(
        `Vibe Remote SPP 起動失敗: serialport を読み込めません (${message})`
      );
      return;
    }

    this.client = {
      label: `spp:${this.opts.path}`,
      send: (msg: OutboundMessage) => {
        this.port?.write(`${JSON.stringify(msg)}\n`);
      }
    };
    this.clientRegistration = this.server.addClient(this.client);

    this.port = new SerialPort({
      path: this.opts.path,
      baudRate: this.opts.baudRate,
      autoOpen: true
    });
    this.port.on('open', () => this.log(`SPP serial opened: ${this.opts.path}`));
    this.port.on('data', (data) => this.handleData(data));
    this.port.on('error', (err) => this.log(`SPP serial error: ${err.message}`));
    this.port.on('close', () => this.log(`SPP serial closed: ${this.opts.path}`));
  }

  dispose(): void {
    this.clientRegistration?.dispose();
    this.clientRegistration = undefined;
    if (this.port) {
      this.port.close((err) => {
        if (err) {
          this.log(`SPP serial close error: ${err.message}`);
        }
      });
      this.port = undefined;
    }
    this.client = undefined;
    this.rx = '';
  }

  private handleData(data: Buffer): void {
    this.rx += data.toString('utf8');
    for (;;) {
      const newline = this.rx.indexOf('\n');
      if (newline < 0) {
        if (this.rx.length > 8192) {
          this.rx = '';
          this.log('SPP serial receive buffer overflow; buffer cleared');
        }
        return;
      }
      const line = this.rx.slice(0, newline).trim();
      this.rx = this.rx.slice(newline + 1);
      if (line && this.client) {
        this.server.receive(this.client, line);
      }
    }
  }

  private log(line: string): void {
    this.output.appendLine(`[${new Date().toLocaleTimeString()}] ${line}`);
  }
}
