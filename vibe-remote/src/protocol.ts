// エージェント/状態ビューア と 拡張 の間でやり取りするメッセージ型。

/** デバイス → 拡張：接続認証 */
export interface HelloMessage {
  type: 'hello';
  /** 共有トークン。認証成功後に状態配信を許可する。 */
  token: string;
}

/** 状態ビューア → 拡張：疎通確認 */
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
  | PingMessage
  | AgentStatusMessage;

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

/** 拡張 → 状態ビューア：状態通知 */
export interface StateMessage {
  type: 'state';
  chat: ChatState;
  /** MCP/外部エージェントから自己申告された状態 */
  agent?: AgentStatusSnapshot;
  /** 直近に観測できた作業の実況（公式APIで取得） */
  activity: ActivitySnapshot;
  ts: number;
}

/** 拡張 → 状態ビューア：受領応答 */
export interface AckMessage {
  type: 'ack';
  ok: boolean;
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
