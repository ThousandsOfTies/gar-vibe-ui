import * as fs from 'fs';

export const BROKER_PROCESS_FILTER =
  "$_.Name -like 'powershell*.exe' -and $_.CommandLine -match '(^|\\s)-File\\s+.*vscode-approval-broker\\.ps1'";

export interface BrokerStartArgsOptions {
  host: string;
  port: number;
  token: string;
  pollSeconds: number;
  decisionTimeoutSeconds: number;
  dryRun: boolean;
}

/**
 * Detects whether the current process is running inside WSL by checking for
 * the Windows PowerShell binary under /mnt/c. Parameters are injectable so
 * this can be exercised deterministically in tests.
 */
export function isWsl(
  platform: NodeJS.Platform = process.platform,
  existsSync: (path: string) => boolean = fs.existsSync
): boolean {
  return (
    platform === 'linux' &&
    existsSync('/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe')
  );
}

export function powerShellPath(wsl: boolean = isWsl()): string {
  if (wsl) {
    return '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
  }
  return 'powershell.exe';
}

export function defaultApprovalBrokerPort(wsl: boolean = isWsl()): number {
  return wsl ? 39273 : 39271;
}

/** Quotes a value for use inside a single-quoted PowerShell string literal. */
export function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Builds the argv passed to the vscode-approval-broker.ps1 script.
 * `scriptPath` and `logPath` are expected to already be Windows-style paths.
 */
export function buildBrokerStartArgs(
  scriptPath: string,
  logPath: string,
  opts: BrokerStartArgsOptions
): string[] {
  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-Loop',
    '-HostName',
    opts.host,
    '-Port',
    String(opts.port),
    '-Token',
    opts.token,
    '-PollSeconds',
    String(opts.pollSeconds),
    '-DecisionTimeoutSeconds',
    String(opts.decisionTimeoutSeconds),
    '-LogPath',
    logPath
  ];
  if (opts.dryRun) {
    args.push('-DryRun');
  }
  return args;
}

/** Builds the PowerShell one-liner that starts the broker as a detached process. */
export function buildStartPowerShellCommand(args: string[]): string {
  return [
    `$a=@(${args.map(psQuote).join(',')})`,
    "Start-Process -FilePath 'powershell.exe' " +
      "-ArgumentList $a -WorkingDirectory 'C:\\' -WindowStyle Hidden"
  ].join('; ');
}

/** Builds the PowerShell one-liner that lists running broker processes. */
export function buildStatusPowerShellCommand(filter: string = BROKER_PROCESS_FILTER): string {
  return [
    'Get-CimInstance Win32_Process',
    `Where-Object { ${filter} }`,
    'ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }'
  ].join(' | ');
}

/** Builds the PowerShell one-liner that force-stops running broker processes. */
export function buildStopPowerShellCommand(filter: string = BROKER_PROCESS_FILTER): string {
  return [
    'Get-CimInstance Win32_Process',
    `Where-Object { ${filter} }`,
    'ForEach-Object { Stop-Process -Id $_.ProcessId -Force }'
  ].join(' | ');
}

/** Splits raw PowerShell stdout into trimmed, non-empty process lines. */
export function parseProcessList(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
