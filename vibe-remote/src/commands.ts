import * as vscode from 'vscode';
import type { ActionValue } from './protocol';

/**
 * 操作値 → VS Code 公式コマンドID のマッピング。
 * いずれも proposed API ではなく、現行VS Codeに存在する正式なコマンド。
 */
const COMMAND_MAP: Record<ActionValue, string> = {
  ok: 'workbench.action.chat.acceptTool',
  ng: 'workbench.action.chat.skipTool',
  acceptAll: 'chatEditing.acceptAllFiles',
  submit: 'workbench.action.chat.submit',
  micOn: 'workbench.action.chat.startVoiceChat',
  micOff: 'workbench.action.chat.stopListening',
  micToggle: 'workbench.action.chat.startVoiceChat', // micToggleはstate参照で実体を切替（dispatch側で処理）
  readAloud: 'workbench.action.chat.readChatResponseAloud',
  stopRead: 'workbench.action.speech.stopReadAloud'
};

/**
 * 操作を実行する。micToggle は現在のマイク状態を見て On/Off を切り替える。
 * @returns 実行したコマンドID。失敗時は例外を投げる。
 */
export async function dispatchAction(
  value: ActionValue,
  micIsOn: () => boolean
): Promise<string> {
  let commandId: string;

  if (value === 'micToggle') {
    commandId = micIsOn()
      ? COMMAND_MAP.micOff
      : COMMAND_MAP.micOn;
  } else {
    commandId = COMMAND_MAP[value];
  }

  if (!commandId) {
    throw new Error(`未知の操作: ${value}`);
  }

  await vscode.commands.executeCommand(commandId);
  return commandId;
}

/** micToggle が「マイクをONにする」方向かどうか（state更新用のヒント） */
export function isMicStartAction(value: ActionValue, micIsOn: boolean): boolean {
  if (value === 'micOn') {
    return true;
  }
  if (value === 'micToggle') {
    return !micIsOn;
  }
  return false;
}

/** micToggle/micOff が「マイクをOFFにする」方向かどうか */
export function isMicStopAction(value: ActionValue, micIsOn: boolean): boolean {
  if (value === 'micOff') {
    return true;
  }
  if (value === 'micToggle') {
    return micIsOn;
  }
  return false;
}
