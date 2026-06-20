import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';
import * as vscode from 'vscode';

const execFile = util.promisify(childProcess.execFile);

export interface LocalBridgeOptions {
  listenPort: number;
  upstreamPort: number;
  advertiseHost: string;
  logPath: string;
  nodePath: string;
}

interface BridgeStatus {
  listening: boolean;
  processes: string[];
  logPath: string;
}

export class LocalBridgeManager implements vscode.Disposable {
  constructor(
    private readonly extensionPath: string,
    private readonly output: vscode.OutputChannel
  ) {}

  async start(): Promise<void> {
    const opts = this.readOptions();
    const status = await this.status();
    if (status.listening) {
      void vscode.window.showInformationMessage(
        `Vibe Remote Local Bridge は起動済みです (${opts.listenPort})。`
      );
      return;
    }
    if (status.processes.length > 0) {
      this.output.appendLine('Local Bridge: stale process を停止します。');
      await this.stop(false);
    }

    const advertiseHost = opts.advertiseHost || (await this.detectHostIpv4());
    if (!advertiseHost) {
      void vscode.window.showErrorMessage(
        'Vibe Remote Local Bridge: Host OS側のLAN IPv4を自動検出できませんでした。vibeRemote.localBridge.advertiseHost を設定してください。'
      );
      return;
    }

    const scriptPath = path.join(this.extensionPath, 'scripts', 'local-bridge.js');
    if (!fs.existsSync(scriptPath)) {
      void vscode.window.showErrorMessage(
        `Vibe Remote Local Bridge script が見つかりません: ${scriptPath}`
      );
      return;
    }
    const nodePath = opts.nodePath || (await this.detectNodePath());
    if (!nodePath) {
      void vscode.window.showErrorMessage(
        'Vibe Remote Local Bridge: Host OS側の Node.js が見つかりません。vibeRemote.localBridge.nodePath を設定してください。'
      );
      return;
    }

    const windowsScript = await this.toWindowsPath(scriptPath);
    const windowsLog = await this.toWindowsPath(opts.logPath);
    const windowsErr = await this.toWindowsPath(`${opts.logPath}.err`);
    fs.mkdirSync(path.dirname(opts.logPath), { recursive: true });
    fs.rmSync(opts.logPath, { force: true });
    fs.rmSync(`${opts.logPath}.err`, { force: true });

    const args = [
      windowsScript,
      `--listen-port=${opts.listenPort}`,
      `--upstream-port=${opts.upstreamPort}`,
      `--advertise-host=${advertiseHost}`
    ];
    const ps = [
      `$a=@(${args.map(psQuote).join(',')})`,
      `Start-Process -FilePath ${psQuote(nodePath)} ` +
        "-ArgumentList $a -WorkingDirectory 'C:\\' -WindowStyle Hidden " +
        `-RedirectStandardOutput ${psQuote(windowsLog)} ` +
        `-RedirectStandardError ${psQuote(windowsErr)}`
    ].join('; ');

    await this.runPowerShell(ps);
    await delay(800);
    const after = await this.status();
    if (!after.listening) {
      void vscode.window.showErrorMessage(
        `Vibe Remote Local Bridge を起動しましたが、${opts.listenPort} がLISTENしていません。Outputを確認してください。`
      );
      await this.tailLogs(opts.logPath);
      return;
    }
    this.output.appendLine(
      `Local Bridge: ws://0.0.0.0:${opts.listenPort} -> ws://127.0.0.1:${opts.upstreamPort}`
    );
    this.output.appendLine(`Local Bridge: advertise host ${advertiseHost}`);
    void vscode.window.showInformationMessage(
      `Vibe Remote Local Bridge を起動しました (${advertiseHost}:${opts.listenPort})。`
    );
  }

  async stop(showMessage = true): Promise<void> {
    const ps = [
      'Get-CimInstance Win32_Process',
      "Where-Object { $_.Name -like 'node.exe' -and $_.CommandLine -like '*local-bridge.js*' }",
      'ForEach-Object { Stop-Process -Id $_.ProcessId -Force }'
    ].join(' | ');
    await this.runPowerShell(ps);
    if (showMessage) {
      void vscode.window.showInformationMessage('Vibe Remote Local Bridge を停止しました。');
    }
  }

  async showStatus(): Promise<void> {
    const status = await this.status();
    const lines = [
      `listening: ${status.listening ? 'yes' : 'no'}`,
      `processes: ${status.processes.length}`,
      ...status.processes.map((line) => `  ${line}`),
      `log: ${status.logPath}`
    ];
    this.output.appendLine('--- Local Bridge Status ---');
    for (const line of lines) {
      this.output.appendLine(line);
    }
    void vscode.window.showInformationMessage(
      `Vibe Remote Local Bridge: ${status.listening ? 'listening' : 'not listening'}`
    );
  }

  dispose(): void {
    // The bridge is a local-host process. Do not stop it implicitly on extension unload.
  }

  private async status(): Promise<BridgeStatus> {
    const opts = this.readOptions();
    const listenPs = `$c = Get-NetTCPConnection -LocalPort ${opts.listenPort} -State Listen -ErrorAction SilentlyContinue; if ($c) { 'yes' } else { 'no' }`;
    const processPs = [
      'Get-CimInstance Win32_Process',
      "Where-Object { $_.Name -like 'node.exe' -and $_.CommandLine -like '*local-bridge.js*' }",
      'ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }'
    ].join(' | ');
    const [listen, processes] = await Promise.all([
      this.runPowerShell(listenPs),
      this.runPowerShell(processPs)
    ]);
    return {
      listening: listen.stdout.trim() === 'yes',
      processes: processes.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
      logPath: opts.logPath
    };
  }

  private readOptions(): LocalBridgeOptions {
    const cfg = vscode.workspace.getConfiguration('vibeRemote.localBridge');
    const rootCfg = vscode.workspace.getConfiguration('vibeRemote');
    return {
      listenPort: cfg.get<number>('listenPort', 39273),
      upstreamPort: cfg.get<number>('upstreamPort', rootCfg.get<number>('port', 39271)),
      advertiseHost: cfg.get<string>('advertiseHost', ''),
      logPath: cfg.get<string>('logPath', '/tmp/vibe-local-bridge.log'),
      nodePath: cfg.get<string>('nodePath', '')
    };
  }

  private async detectNodePath(): Promise<string> {
    if (!isWsl()) {
      return process.execPath;
    }
    const ps = '(Get-Command node.exe -ErrorAction SilentlyContinue).Source';
    const result = await this.runPowerShell(ps);
    return result.stdout.trim();
  }

  private async detectHostIpv4(): Promise<string> {
    const ps = [
      'Get-NetIPConfiguration',
      'Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address }',
      'ForEach-Object { $_.IPv4Address.IPAddress }',
      "Where-Object { $_ -notlike '127.*' -and $_ -notlike '169.254.*' }",
      'Select-Object -First 1'
    ].join(' | ');
    const result = await this.runPowerShell(ps);
    return result.stdout.trim();
  }

  private async toWindowsPath(value: string): Promise<string> {
    if (!isWsl()) {
      return value;
    }
    const { stdout } = await execFile('wslpath', ['-w', value]);
    return stdout.trim();
  }

  private async runPowerShell(script: string): Promise<{ stdout: string; stderr: string }> {
    const powershell = powerShellPath();
    try {
      const result = await execFile(
        powershell,
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
        {
          windowsHide: true,
          maxBuffer: 1024 * 1024
        }
      );
      if (result.stderr.trim()) {
        this.output.appendLine(result.stderr.trim());
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.output.appendLine(`PowerShell error: ${message}`);
      throw err;
    }
  }

  private async tailLogs(logPath: string): Promise<void> {
    for (const candidate of [logPath, `${logPath}.err`]) {
      if (fs.existsSync(candidate)) {
        const text = fs.readFileSync(candidate, 'utf8').split(/\r?\n/).slice(-20).join('\n');
        this.output.appendLine(`--- ${candidate} ---`);
        this.output.appendLine(text);
      }
    }
  }
}

function isWsl(): boolean {
  return (
    process.platform === 'linux' &&
    fs.existsSync('/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe')
  );
}

function powerShellPath(): string {
  if (isWsl()) {
    return '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
  }
  return 'powershell.exe';
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
