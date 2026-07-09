import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BROKER_PROCESS_FILTER,
  buildBrokerStartArgs,
  buildStartPowerShellCommand,
  buildStatusPowerShellCommand,
  buildStopPowerShellCommand,
  defaultApprovalBrokerPort,
  isWsl,
  parseProcessList,
  powerShellPath,
  psQuote
} from '../src/approvalBrokerUtil';

test('psQuote wraps values in single quotes and escapes embedded quotes', () => {
  assert.equal(psQuote('plain'), "'plain'");
  assert.equal(psQuote("O'Brien"), "'O''Brien'");
  assert.equal(psQuote(''), "''");
});

test('isWsl is true only on linux when the Windows PowerShell binary is present', () => {
  assert.equal(
    isWsl('linux', (p) => p === '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'),
    true
  );
  assert.equal(isWsl('linux', () => false), false);
  assert.equal(isWsl('win32', () => true), false);
  assert.equal(isWsl('darwin', () => true), false);
});

test('powerShellPath switches between the WSL-mounted binary and the plain command', () => {
  assert.equal(
    powerShellPath(true),
    '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
  );
  assert.equal(powerShellPath(false), 'powershell.exe');
});

test('defaultApprovalBrokerPort differs between WSL and non-WSL hosts', () => {
  assert.equal(defaultApprovalBrokerPort(true), 39273);
  assert.equal(defaultApprovalBrokerPort(false), 39271);
});

test('buildBrokerStartArgs includes required flags and omits -DryRun when disabled', () => {
  const args = buildBrokerStartArgs('C:\\scripts\\broker.ps1', 'C:\\logs\\broker.log', {
    host: '127.0.0.1',
    port: 39273,
    token: 'secret-token',
    pollSeconds: 2,
    decisionTimeoutSeconds: 60,
    dryRun: false
  });

  assert.deepEqual(args, [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    'C:\\scripts\\broker.ps1',
    '-Loop',
    '-HostName',
    '127.0.0.1',
    '-Port',
    '39273',
    '-Token',
    'secret-token',
    '-PollSeconds',
    '2',
    '-DecisionTimeoutSeconds',
    '60',
    '-LogPath',
    'C:\\logs\\broker.log'
  ]);
});

test('buildBrokerStartArgs appends -DryRun when enabled', () => {
  const args = buildBrokerStartArgs('script.ps1', 'log.txt', {
    host: '127.0.0.1',
    port: 39271,
    token: 'tok',
    pollSeconds: 1,
    decisionTimeoutSeconds: 30,
    dryRun: true
  });

  assert.equal(args.at(-1), '-DryRun');
});

test('buildStartPowerShellCommand quotes every argument and starts a hidden process', () => {
  const command = buildStartPowerShellCommand(['-Token', "weird'value"]);
  assert.match(command, /\$a=@\('-Token','weird''value'\)/);
  assert.match(command, /Start-Process -FilePath 'powershell\.exe'/);
  assert.match(command, /-WindowStyle Hidden/);
});

test('buildStatusPowerShellCommand and buildStopPowerShellCommand use the broker process filter', () => {
  const escapedFilter = BROKER_PROCESS_FILTER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const filterPattern = new RegExp(escapedFilter);

  assert.match(buildStatusPowerShellCommand(), /Get-CimInstance Win32_Process/);
  assert.match(buildStatusPowerShellCommand(), filterPattern);
  assert.match(buildStopPowerShellCommand(), /Stop-Process -Id \$_\.ProcessId -Force/);
});

test('parseProcessList trims lines and drops blanks across CRLF/LF output', () => {
  assert.deepEqual(parseProcessList('  123 powershell.exe  \r\n\r\n456 other\n  \n'), [
    '123 powershell.exe',
    '456 other'
  ]);
  assert.deepEqual(parseProcessList(''), []);
  assert.deepEqual(parseProcessList('\n \n'), []);
});
