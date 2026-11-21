import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaybackManager } from '../extension/playback-session.mjs';

const VIDEO = 'https://www.youtube.com/watch?v=USeyDcWyVCc';
const REQUEST = '60b05387-85f3-4d7f-a000-a123456789ab';
const record = (extra = {}) => ({
  requestId: REQUEST, videoURL: VIDEO, videoTabId: 100, chatgptTabId: 101,
  groupId: 200, windowId: 3, focusChat: true, ...extra,
});
const sender = (extra = {}) => ({
  id: 'extension-id', frameId: 0, url: VIDEO, tab: { id: 100, windowId: 3 }, ...extra,
});
const message = (type = 'PLAYBACK_READY', extra = {}) => ({
  channel: 'yt-chatgpt-groups', type, requestId: REQUEST, videoURL: VIDEO, ...extra,
});

function fixture() {
  const data = {};
  const updates = [];
  const tabs = new Map([
    [100, { id: 100, groupId: 200, windowId: 3, active: true, mutedInfo: { muted: true } }],
    [101, { id: 101, groupId: 200, windowId: 3, active: false }],
  ]);
  const api = {
    runtime: { id: 'extension-id' },
    storage: { session: {
      async get(key) { return structuredClone(key === null ? data : { [key]: data[key] }); },
      async set(values) { Object.assign(data, structuredClone(values)); },
      async remove(keys) { (Array.isArray(keys) ? keys : [keys]).forEach(key => delete data[key]); },
    } },
    tabs: {
      async get(id) { if (!tabs.has(id)) throw Error('Tab closed'); return structuredClone(tabs.get(id)); },
      async update(id, properties) { updates.push({ id, ...properties }); Object.assign(tabs.get(id), properties); },
    },
  };
  return { api, data, updates, tabs };
}

test('focus waits for authorization and actual playing status, and is consumed once', async () => {
  const f = fixture(), manager = createPlaybackManager(f.api);
  await manager.prepare(record());
  await assert.rejects(manager.handle(message('PLAYBACK_STATUS', { status: 'playing' }), sender()));
  assert.deepEqual(await manager.handle(message(), sender()), { nativeMuted: true });
  assert.deepEqual(f.updates, []);
  assert.deepEqual(await manager.handle(message('PLAYBACK_STATUS', { status: 'playing' }), sender()), { focused: true });
  assert.deepEqual(f.updates, [{ id: 101, active: true }]);
  await assert.rejects(manager.handle(message('PLAYBACK_STATUS', { status: 'playing' }), sender()));
  assert.equal(f.updates.length, 1);
  assert.deepEqual(f.data, {});
});

test('session authorization survives service-worker restart', async () => {
  const f = fixture();
  await createPlaybackManager(f.api).prepare(record());
  await createPlaybackManager(f.api).handle(message(), sender());
  const result = await createPlaybackManager(f.api).handle(message('PLAYBACK_STATUS', { status: 'playing' }), sender());
  assert.equal(result.focused, true);
});

test('background requests, failure and cancellation never select ChatGPT', async () => {
  for (const [focusChat, status] of [[false, 'playing'], [true, 'failed'], [true, 'cancelled']]) {
    const f = fixture(), manager = createPlaybackManager(f.api);
    await manager.prepare(record({ focusChat }));
    await manager.handle(message(), sender());
    assert.deepEqual(await manager.handle(message('PLAYBACK_STATUS', { status }), sender()), { focused: false });
    assert.deepEqual(f.updates, []);
    assert.deepEqual(f.data, {});
  }
});

test('selecting another tab revokes delayed focus even if the user returns to the video', async () => {
  const f = fixture(), manager = createPlaybackManager(f.api);
  await manager.prepare(record());
  await manager.onActivated({ windowId: 3, tabId: 100 });
  await manager.handle(message(), sender());
  await manager.onActivated({ windowId: 3, tabId: 7 });
  await manager.onActivated({ windowId: 3, tabId: 100 });
  assert.equal((await manager.handle(message('PLAYBACK_STATUS', { status: 'playing' }), sender())).focused, false);
  assert.deepEqual(f.updates, []);
});

test('other windows do not revoke focus, and native mute is read from the actual tab', async () => {
  const f = fixture(), manager = createPlaybackManager(f.api);
  f.tabs.get(100).mutedInfo.muted = false;
  await manager.prepare(record());
  await manager.onActivated({ windowId: 8, tabId: 9 });
  assert.deepEqual(await manager.handle(message(), sender()), { nativeMuted: false });
  assert.equal((await manager.handle(message('PLAYBACK_STATUS', { status: 'playing' }), sender())).focused, true);
});

test('closed, moved, ungrouped or inactive tabs cannot cause delayed focus', async () => {
  for (const change of [
    f => f.tabs.delete(101),
    f => { f.tabs.get(101).windowId = 8; },
    f => { f.tabs.get(100).groupId = -1; },
    f => { f.tabs.get(100).active = false; },
  ]) {
    const f = fixture(), manager = createPlaybackManager(f.api);
    await manager.prepare(record()); await manager.handle(message(), sender()); change(f);
    assert.equal((await manager.handle(message('PLAYBACK_STATUS', { status: 'playing' }), sender())).focused, false);
    assert.deepEqual(f.updates, []);
  }
});

test('authorization is bound to extension, frame, video, request and created tab', async () => {
  const f = fixture(), manager = createPlaybackManager(f.api);
  await manager.prepare(record());
  for (const changed of [
    { id: 'other-extension' }, { frameId: 2 }, { url: 'https://example.org/' },
    { url: 'https://www.youtube.com/watch?v=SNwoI6531us' },
    { tab: { id: 7, windowId: 3 } }, { tab: { id: 100, windowId: 8 } },
  ]) await assert.rejects(manager.handle(message(), sender(changed)));
  for (const changed of [
    { requestId: '70b05387-85f3-4d7f-a000-a123456789ab' },
    { videoURL: 'https://www.youtube.com/watch?v=SNwoI6531us' },
    { type: 'PLAYBACK_STATUS', status: 'unknown' }, { channel: 'other-channel' },
  ]) await assert.rejects(manager.handle(message('PLAYBACK_READY', changed), sender()));
  assert.deepEqual(await manager.handle(message(), sender()), { nativeMuted: true });
  await assert.rejects(manager.handle(message(), sender()), /ya está en curso/);
  assert.deepEqual(f.updates, []);
});

test('expired and closed-tab records are removed without touching unrelated session values', async () => {
  const f = fixture(); let clock = 0;
  f.data.unrelated = { setting: true };
  const manager = createPlaybackManager(f.api, { now: () => clock });
  await manager.prepare(record()); clock = 120001;
  await assert.rejects(manager.handle(message(), sender()));
  assert.deepEqual(f.data, { unrelated: { setting: true } });
  await manager.prepare(record());
  await manager.onRemoved(101);
  assert.deepEqual(f.data, { unrelated: { setting: true } });
});
