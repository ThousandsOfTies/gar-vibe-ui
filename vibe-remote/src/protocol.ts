// デバイス/仮想リモコン と 拡張 の間でやり取りするメッセージ型。

/** デバイス → 拡張：接続認証 */
export interface HelloMessage {
  type: 'hello';
  /** 共有トークン。認証成功後に状態配信と操作を許可する。 */
  token: string;
}

/** デバイス → 拡張：操作メッセージ */
export interface ActionMessage {
  type: 'action';
  /** 実行したい操作 */
  value: ActionValue;
  /** 共有トークン。サーバ側で照合する。 */
  token: string;
}

/** デバイス → 拡張：疎通確認 */
export interface PingMessage {
  type: 'ping';
  token: string;
}

/** MCP/外部エージェント → 拡張：自己申告ステータス */
export interface AgentStatusMessage {
  type: 'agentStatus';
  token: string;
  status: AgentRuntimeStatus;
  source?: string;
  message?: string;
  ttlMs?: number;
}

export type InboundMessage =
  | HelloMessage
  | ActionMessage
  | PingMessage
  | AgentStatusMessage;

/** 実行可能な操作の一覧 */
export type ActionValue =
  | 'ok'         // ツール実行を承認
  | 'ng'         // スキップ
  | 'acceptAll'  // 編集を全受け入れ
  | 'submit'     // 送信 (Enter)
  | 'micOn'      // 音声入力開始
  | 'micOff'     // 音声入力停止
  | 'micToggle'  // 音声入力トグル
  | 'readAloud'  // 応答を読み上げ
  | 'stopRead';  // 読み上げ停止

/**
 * チャット/作業のざっくり状態（活動ヒューリスティック）。
 * idle は「観測可能な活動がない」であり、Chatパネル内の入力待ちを否定しない。
 */
export type ChatState = 'working' | 'maybeWaiting' | 'idle';

/** エージェント自己申告の実行状態 */
export type AgentRuntimeStatus =
  | 'running'
  | 'waiting'
  | 'done'
  | 'failed'
  | 'idle';

export interface AgentStatusSnapshot {
  source: string;
  status: AgentRuntimeStatus;
  message?: string;
  updatedAt: number;
  expiresAt?: number;
}

/** 拡張 → デバイス：状態通知（LED/画面/ロボ制御用） */
export interface StateMessage {
  type: 'state';
  chat: ChatState;
  mic: 'on' | 'off';
  tts: 'on' | 'off';
  /** MCP/外部エージェントから自己申告された状態 */
  agent?: AgentStatusSnapshot;
  /** 直近に観測できた作業の実況（公式APIで取得） */
  activity: ActivitySnapshot;
  ts: number;
}

/** 拡張 → デバイス：操作受領の応答 */
export interface AckMessage {
  type: 'ack';
  ok: boolean;
  value?: ActionValue;
  error?: string;
}

export type OutboundMessage = StateMessage | AckMessage;

/** 公式APIから安定して取得できる「作業の実況」 */
export interface ActivitySnapshot {
  /** 実行中/直近のターミナルコマンド（例: "npm test"） */
  command?: string;
  /** 直近コマンドの終了コード（undefined=実行中 or 不明） */
  exitCode?: number;
  /** 診断のエラー数 */
  errors: number;
  /** 診断の警告数 */
  warnings: number;
  /** 編集中ファイル名（basename） */
  file?: string;
  /** デバッグセッション実行中か */
  debugging: boolean;
  /** タスク実行中か */
  taskRunning: boolean;
  /** ウィンドウにフォーカスがあるか */
  focused: boolean;
}
