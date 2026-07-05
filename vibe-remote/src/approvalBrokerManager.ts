import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';
import * as vscode from 'vscode';

const execFile = util.promisify(childProcess.execFile);
const BROKER_PROCESS_FILTER =
  "$_.Name -like 'powershell*.exe' -and $_.CommandLine -match '(^|\\s)-File\\s+.*vscode-approval-broker\\.ps1'";

export interface ApprovalBrokerOptions {
  enabled: boolean;
  dryRun: boolean;
  host: string;
  port: number;
  pollSeconds: number;
  decisionTimeoutSeconds: number;
  logPath: string;
}

interface ApprovalBrokerStatus {
  running: boolean;
  processes: string[];
  logPath: string;
  dryRun: boolean;
}

export class ApprovalBrokerManager implements vscode.Disposable {
  constructor(
    private readonly extensionPath: string,
    private readonly output: vscode.OutputChannel,
    private readonly getToken: () => string
  ) {}

  async start(showMessage = true): Promise<void> {
    const opts = this.readOptions();
    const status = await this.status();
    if (status.running) {
      void vscode.window.showInformationMessage(
        `Vibe Remote Approval Broker は起動済みです${opts.dryRun ? ' (DryRun)' : ''}。`
      );
      return;
    }

    const scriptPath = path.join(this.extensionPath, 'scripts', 'vscode-approval-broker.ps1');
    if (!fs.existsSync(scriptPath)) {
      void vscode.window.showErrorMessage(
        `Vibe Remote Approval Broker script が見つかりません: ${scriptPath}`
      );
      return;
    }

    const token = this.getToken();
    if (!token) {
      void vscode.window.showErrorMessage('Vibe Remote Approval Broker: token が空です。');
      return;
    }

    const windowsScript = await this.toWindowsPath(scriptPath);
    const windowsLog = await this.toWindowsPath(opts.logPath);
    fs.mkdirSync(path.dirname(opts.logPath), { recursive: true });
    fs.rmSync(opts.logPath, { force: true });
    fs.rmSync(`${opts.logPath}.err`, { force: true });

    const args = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      windowsScript,
      '-Loop',
      '-HostName',
      opts.host,
      '-Port',
      String(opts.port),
      '-Token',
      token,
      '-PollSeconds',
      String(opts.pollSeconds),
      '-DecisionTimeoutSeconds',
      String(opts.decisionTimeoutSeconds),
      '-LogPath',
      windowsLog
    ];
    if (opts.dryRun) {
      args.push('-DryRun');
    }

    const ps = [
      `$a=@(${args.map(psQuote).join(',')})`,
      "Start-Process -FilePath 'powershell.exe' " +
        "-ArgumentList $a -WorkingDirectory 'C:\\' -WindowStyle Hidden"
    ].join('; ');

    await this.runPowerShell(ps);
    await delay(800);
    const after = await this.status();
    if (!after.running) {
      void vscode.window.showErrorMessage(
        'Vibe Remote Approval Broker を起動しましたが、プロセスが見つかりません。Outputを確認してください。'
      );
      await this.tailLogs(opts.logPath);
      return;
    }

    this.output.appendLine(
      `Approval Broker: started host=${opts.host} port=${opts.port} dryRun=${opts.dryRun}`
    );
    if (showMessage) {
      void vscode.window.showInformationMessage(
        `Vibe Remote Approval Broker を起動しました${opts.dryRun ? ' (DryRun)' : ''}。`
      );
    }
  }

  async stop(showMessage = true): Promise<void> {
    const ps = [
      'Get-CimInstance Win32_Process',
      `Where-Object { ${BROKER_PROCESS_FILTER} }`,
      'ForEach-Object { Stop-Process -Id $_.ProcessId -Force }'
    ].join(' | ');
    await this.runPowerShell(ps);
    if (showMessage) {
      void vscode.window.showInformationMessage('Vibe Remote Approval Broker を停止しました。');
    }
  }

  async showStatus(): Promise<void> {
    const status = await this.status();
    const lines = [
      `running: ${status.running ? 'yes' : 'no'}`,
      `dryRun: ${status.dryRun ? 'yes' : 'no'}`,
      `processes: ${status.processes.length}`,
      ...status.processes.map((line) => `  ${line}`),
      `log: ${status.logPath}`
    ];
    this.output.appendLine('--- Approval Broker Status ---');
    for (const line of lines) {
      this.output.appendLine(line);
    }
    await this.tailLogs(status.logPath);
    void vscode.window.showInformationMessage(
      `Vibe Remote Approval Broker: ${status.running ? 'running' : 'not running'}`
    );
  }

  dispose(): void {
    // The broker intentionally outlives extension reloads until stopped by command.
  }

  private async status(): Promise<ApprovalBrokerStatus> {
    const opts = this.readOptions();
    const processPs = [
      'Get-CimInstance Win32_Process',
      `Where-Object { ${BROKER_PROCESS_FILTER} }`,
      'ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }'
    ].join(' | ');
    const processes = await this.runPowerShell(processPs);
    const lines = processes.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return {
      running: lines.length > 0,
      processes: lines,
      logPath: opts.logPath,
      dryRun: opts.dryRun
    };
  }

  private readOptions(): ApprovalBrokerOptions {
    const cfg = vscode.workspace.getConfiguration('vibeRemote.approvalBroker');
    return {
      enabled: cfg.get<boolean>('enabled', false),
      dryRun: cfg.get<boolean>('dryRun', true),
      host: cfg.get<string>('host', '127.0.0.1'),
      port: cfg.get<number>('port', defaultApprovalBrokerPort()),
      pollSeconds: cfg.get<number>('pollSeconds', 2),
      decisionTimeoutSeconds: cfg.get<number>('decisionTimeoutSeconds', 60),
      logPath: cfg.get<string>('logPath', '/tmp/vibe-approval-broker.log')
    };
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

function defaultApprovalBrokerPort(): number {
  return isWsl() ? 39273 : 39271;
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
