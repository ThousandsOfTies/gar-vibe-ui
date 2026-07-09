import assert from 'node:assert/strict';
import test from 'node:test';

import { agentToChatState, isAgentStatus, normalizeDeviceUi } from '../src/protocolHelpers';

test('normalizeDeviceUi trims and limits device UI payloads', () => {
  const now = 1_000;
  const ui = normalizeDeviceUi(
    {
      id: ` ${'x'.repeat(60)} `,
      title: ` ${'title'.repeat(20)} `,
      state: 'waiting',
      mode: 'menu',
      selected: 2,
      message: ` ${'message'.repeat(30)} `,
      fields: [
        { label: 'FirstLabel', value: '123456789012345678901234567890' },
        { label: 'Second', value: 'ok' },
        { label: 'Third', value: 'ok' },
        { label: 'Fourth', value: 'ignored' }
      ],
      actions: [
        { id: 'ok', label: 'ConfirmNow', button: 'A' },
        { id: 'ng', label: 'RejectNow', button: 'B' },
        { id: 'later', label: 'LaterPlease', button: 'P' },
        { id: 'extra', label: 'ExtraAction', button: 'A-hold' }
      ],
      source: 'very-long-agent-source-name',
      ttlMs: 60_000
    },
    now
  );

  assert.equal(ui?.id.length, 40);
  assert.equal(ui?.title?.length, 32);
  assert.equal(ui?.message?.length, 120);
  assert.equal(ui?.mode, 'menu');
  assert.equal(ui?.selected, 2);
  assert.equal(ui?.fields?.length, 3);
  assert.deepEqual(ui?.fields?.[0], { label: 'FirstLab', value: '123456789012345678901234' });
  assert.equal(ui?.actions?.length, 4);
  assert.deepEqual(ui?.actions?.[0], { id: 'ok', label: 'ConfirmNow', button: 'A' });
  assert.equal(ui?.source, 'very-long-agent-');
  assert.equal(ui?.updatedAt, now);
  assert.equal(ui?.expiresAt, now + 60_000);
});

test('normalizeDeviceUi rejects missing ids and clamps expiry', () => {
  assert.equal(normalizeDeviceUi(undefined, 1_000), undefined);
  assert.equal(normalizeDeviceUi({ id: '   ' }, 1_000), undefined);

  const ui = normalizeDeviceUi({ id: 'x', state: 'not-a-state', ttlMs: 9_999_999 }, 1_000);
  assert.equal(ui?.state, 'waiting');
  assert.equal(ui?.mode, 'menu');
  assert.equal(ui?.selected, 0);
  assert.equal(ui?.expiresAt, 1_000 + 30 * 60 * 1000);
});

test('agent status helpers map known statuses', () => {
  assert.equal(isAgentStatus('running'), true);
  assert.equal(isAgentStatus('wat'), false);
  assert.equal(agentToChatState({ source: 'test', status: 'running', updatedAt: 1 }), 'working');
  assert.equal(
    agentToChatState({ source: 'test', status: 'waiting', updatedAt: 1 }),
    'maybeWaiting'
  );
  assert.equal(agentToChatState({ source: 'test', status: 'done', updatedAt: 1 }), undefined);
});
