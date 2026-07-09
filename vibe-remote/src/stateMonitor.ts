import * as vscode from 'vscode';
import type { ActivitySnapshot, ChatState } from './protocol';

/**
 * 公式の安定APIだけを使って「作業の実況」と「ざっくり状態」を観測する。
 *
 * 重要：承認待ちかどうかを正確に取る公式APIは存在しないため、
 * ここでは活動の有無に基づくヒューリスティックで chat 状態を推定する。
 * 正確なエージェントの入力待ちは安定APIでは取れないため、承認ブローカーのUI検出を優先する。
 */
export class StateMonitor implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private lastActivityTs = Date.now();

  // ターミナルのシェル統合で観測した直近コマンド
  private lastCommand: string | undefined;
  private lastExitCode: number | undefined;
  private runningCommands = 0;

  private runningTasks = 0;

  constructor() {
    this.registerListeners();
  }

  private markActivity(): void {
    this.lastActivityTs = Date.now();
  }

  private registerListeners(): void {
    // --- ファイル編集の活動 ---
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument(() => this.markActivity()),
      vscode.workspace.onDidSaveTextDocument(() => this.markActivity()),
      vscode.window.onDidChangeActiveTextEditor(() => this.markActivity())
    );

    // --- ターミナルのシェル統合API（実行コマンドと結果が取れる） ---
    const anyWindow = vscode.window as unknown as {
      onDidStartTerminalShellExecution?: vscode.Event<{
        execution: { commandLine?: { value?: string } | string };
      }>;
      onDidEndTerminalShellExecution?: vscode.Event<{
        exitCode: number | undefined;
        execution: { commandLine?: { value?: string } | string };
      }>;
    };

    if (anyWindow.onDidStartTerminalShellExecution) {
      this.disposables.push(
        anyWindow.onDidStartTerminalShellExecution((e) => {
          this.runningCommands++;
          this.lastCommand = extractCommandLine(e.execution);
          this.lastExitCode = undefined;
          this.markActivity();
        })
      );
    }
    if (anyWindow.onDidEndTerminalShellExecution) {
      this.disposables.push(
        anyWindow.onDidEndTerminalShellExecution((e) => {
          this.runningCommands = Math.max(0, this.runningCommands - 1);
          this.lastCommand = extractCommandLine(e.execution) ?? this.lastCommand;
          this.lastExitCode = e.exitCode;
          this.markActivity();
        })
      );
    }

    // --- タスク（ビルド/テスト） ---
    this.disposables.push(
      vscode.tasks.onDidStartTask(() => {
        this.runningTasks++;
        this.markActivity();
      }),
      vscode.tasks.onDidEndTask(() => {
        this.runningTasks = Math.max(0, this.runningTasks - 1);
        this.markActivity();
      })
    );

    // --- デバッグ ---
    this.disposables.push(
      vscode.debug.onDidStartDebugSession(() => this.markActivity()),
      vscode.debug.onDidTerminateDebugSession(() => this.markActivity())
    );

    // --- ウィンドウフォーカス ---
    this.disposables.push(vscode.window.onDidChangeWindowState(() => this.markActivity()));
  }

  /** 公式APIから取得できる作業の実況スナップショット */
  getActivity(): ActivitySnapshot {
    let errors = 0;
    let warnings = 0;
    for (const [, diags] of vscode.languages.getDiagnostics()) {
      for (const d of diags) {
        if (d.severity === vscode.DiagnosticSeverity.Error) {
          errors++;
        } else if (d.severity === vscode.DiagnosticSeverity.Warning) {
          warnings++;
        }
      }
    }

    const file = vscode.window.activeTextEditor
      ? basename(vscode.window.activeTextEditor.document.uri.path)
      : undefined;

    return {
      command: this.lastCommand,
      exitCode: this.runningCommands > 0 ? undefined : this.lastExitCode,
      errors,
      warnings,
      file,
      debugging: vscode.debug.activeDebugSession !== undefined,
      taskRunning: this.runningTasks > 0,
      focused: vscode.window.state.focused
    };
  }

  /**
   * ざっくり状態を計算する。
   * - 何か実行中（コマンド/タスク/デバッグ）→ working
   * - 直近に活動あり → working
   * - 活動が少し止まった → maybeWaiting（待ちかも）
   * - 長く止まった → idle
   *
   * 注意：Copilot/Chatパネル内の質問待ちは公式APIから見えないため、
   * idle は「質問待ちではない」ではなく「観測可能な活動がない」という意味。
   */
  computeChatState(idleThresholdMs: number): ChatState {
    const activelyRunning =
      this.runningCommands > 0 ||
      this.runningTasks > 0 ||
      vscode.debug.activeDebugSession !== undefined;

    if (activelyRunning) {
      return 'working';
    }

    const sinceActivity = Date.now() - this.lastActivityTs;
    if (sinceActivity < idleThresholdMs) {
      return 'working';
    }
    if (sinceActivity < idleThresholdMs * 4) {
      return 'maybeWaiting';
    }
    return 'idle';
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}

function extractCommandLine(execution: {
  commandLine?: { value?: string } | string;
}): string | undefined {
  const cl = execution?.commandLine;
  if (!cl) {
    return undefined;
  }
  if (typeof cl === 'string') {
    return cl.trim() || undefined;
  }
  return cl.value?.trim() || undefined;
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}
