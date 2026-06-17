import * as os from 'os';
import * as vscode from 'vscode';

export interface DiscoveryOptions {
  enabled: boolean;
  serviceType: string;
  serviceName: string;
  port: number;
  bindAddress: string;
}

interface PublishOptions {
  name: string;
  type: string;
  protocol: 'tcp' | 'udp';
  port: number;
  txt?: Record<string, string>;
}

interface PublishedService {
  stop(callback?: () => void): void;
}

interface BonjourInstance {
  publish(opts: PublishOptions): PublishedService;
  unpublishAll(callback?: () => void): void;
  destroy(): void;
}

type BonjourCtor = new () => BonjourInstance;

/**
 * LAN上のクライアント向けに、WebSocket待受をmDNSで広告する。
 * トークンは広告しない。
 */
export class DiscoveryPublisher implements vscode.Disposable {
  private bonjour?: BonjourInstance;
  private service?: PublishedService;

  constructor(
    private readonly opts: DiscoveryOptions,
    private readonly output: vscode.OutputChannel
  ) {}

  start(): void {
    if (!this.opts.enabled) {
      this.log('mDNS広告は無効です。');
      return;
    }

    try {
      const bonjourModule = require('bonjour-service') as { Bonjour: BonjourCtor };
      const Bonjour = bonjourModule.Bonjour;
      this.bonjour = new Bonjour();

      const serviceType = sanitizeServiceType(this.opts.serviceType);
      const serviceName = this.opts.serviceName.trim() || 'Vibe Remote';
      const instanceName = `${serviceName} (${os.hostname()})`;

      this.service = this.bonjour.publish({
        name: instanceName,
        type: serviceType,
        protocol: 'tcp',
        port: this.opts.port,
        txt: {
          proto: 'ws',
          auth: 'token',
          bind: this.opts.bindAddress
        }
      });

      this.log(
        `mDNS広告開始 _${serviceType}._tcp.local (name: ${instanceName}, port: ${this.opts.port})`
      );
      if (this.opts.bindAddress !== '0.0.0.0') {
        this.log('注意: bindAddress が 127.0.0.1 のため、外部デバイス接続はできません。');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log(`mDNS広告開始失敗: ${message}`);
    }
  }

  dispose(): void {
    try {
      this.service?.stop();
    } catch {
      // no-op
    }
    this.service = undefined;

    try {
      this.bonjour?.unpublishAll();
      this.bonjour?.destroy();
    } catch {
      // no-op
    }
    this.bonjour = undefined;
  }

  private log(line: string): void {
    this.output.appendLine(`[${new Date().toLocaleTimeString()}] ${line}`);
  }
}

function sanitizeServiceType(input: string): string {
  const raw = input.trim().toLowerCase();
  if (!raw) {
    return 'vibe-remote';
  }
  const safe = raw.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return safe || 'vibe-remote';
}
