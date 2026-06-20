import type { AgentStatusSnapshot, DeviceUiSpec, StateMessage } from './protocol';

export function isAgentStatus(status: string): boolean {
  return ['running', 'waiting', 'done', 'failed', 'idle'].includes(status);
}

export function normalizeDeviceUi(
  ui: (Partial<DeviceUiSpec> & { ttlMs?: number }) | undefined,
  now = Date.now()
): DeviceUiSpec | undefined {
  if (!ui || !ui.id || typeof ui.id !== 'string') {
    return undefined;
  }
  const id = ui.id.trim().slice(0, 40);
  if (!id) {
    return undefined;
  }
  const state = ui.state && isAgentStatus(ui.state) ? ui.state : 'waiting';
  const ttlMs =
    Number.isFinite(ui.ttlMs) && ui.ttlMs! > 0 ? Math.min(ui.ttlMs!, 30 * 60 * 1000) : undefined;
  const expiresAt = ttlMs
    ? now + ttlMs
    : Number.isFinite(ui.expiresAt) && ui.expiresAt! > now
      ? Math.min(ui.expiresAt!, now + 30 * 60 * 1000)
      : undefined;
  return {
    id,
    title: ui.title?.trim().slice(0, 32) || undefined,
    state,
    message: ui.message?.trim().slice(0, 120) || undefined,
    fields: Array.isArray(ui.fields)
      ? ui.fields
          .slice(0, 3)
          .map((field) => ({
            label: String(field.label ?? '')
              .trim()
              .slice(0, 8),
            value: String(field.value ?? '')
              .trim()
              .slice(0, 24)
          }))
          .filter((field) => field.label || field.value)
      : undefined,
    actions: Array.isArray(ui.actions)
      ? ui.actions
          .slice(0, 3)
          .map((action) => ({
            id: String(action.id ?? '')
              .trim()
              .slice(0, 24),
            label: String(action.label ?? '')
              .trim()
              .slice(0, 10),
            button: action.button
          }))
          .filter((action) => action.id && action.label)
      : undefined,
    source: ui.source?.trim().slice(0, 16) || 'agent',
    updatedAt: now,
    expiresAt
  };
}

export function agentToChatState(
  agent: AgentStatusSnapshot | undefined
): StateMessage['chat'] | undefined {
  if (!agent) {
    return undefined;
  }
  if (agent.status === 'running') {
    return 'working';
  }
  if (agent.status === 'waiting') {
    return 'maybeWaiting';
  }
  return undefined;
}
