import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CHANNEL, REQUEST_TYPE, PLAYBACK_FLAG, createGroupHandler, validateGroupRequest } from '../extension/groups.mjs';

const VIDEO = 'https://www.youtube.com/watch?v=USeyDcWyVCc';
const EXTENSION_ID = 'test-youtube-chatgpt-extension';
const REQUEST_ID = '60b05387-85f3-4d7f-a000-a123456789ab';
const sender = (changes = {}) => ({
  id: EXTENSION_ID, frameId: 0, url: 'https://www.youtube.com/',
  tab: { id: 7, windowId: 3 }, ...changes,
});
const request = (changes = {}) => ({
  channel: CHANNEL, type: REQUEST_TYPE, requestId: REQUEST_ID,
  videoURL: VIDEO, title: 'Vídeo de ejemplo', background: false, ...changes,
});

// A small asynchronous Tabs API fixture. Existing user tabs remain distinct
// from tabs created by the operation, so destructive cleanup is observable.
function browserFixture(before = () => {}) {
  const calls = [];
  const tabs = new Map([[7, { id: 7, url: 'https://www.youtube.com/', windowId: 3 }],
    [8, { id: 8, url: 'https://example.org/', windowId: 3 }]]);
  let nextId = 100;
  let nextGroupId = 200;
  const session = {};
  async function call(method, ...args) {
    const entry = { method, args: structuredClone(args) };
    calls.push(entry);
    await before(entry, { calls, tabs });
  }
  const api = {
    runtime: { id: EXTENSION_ID },
    storage: { session: {
      async get(key) { return structuredClone(key === null ? session : { [key]: session[key] }); },
      async set(values) { Object.assign(session, structuredClone(values)); },
      async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete session[key]; },
    } },
    tabs: {
      onActivated: { addListener() {} },
      onRemoved: { addListener() {} },
      async create(properties) {
        await call('create', properties);
        const tab = { id: nextId++, ...properties };
        tabs.set(tab.id, tab);
        return { ...tab };
      },
      async update(id, properties) {
        await call('update', id, properties);
        Object.assign(tabs.get(id), properties);
        if ('muted' in properties) tabs.get(id).mutedInfo = { muted: properties.muted };
        return { ...tabs.get(id) };
      },
      async group(properties) {
        await call('group', properties);
        const id = nextGroupId++;
        properties.tabIds.forEach(tabId => { tabs.get(tabId).groupId = id; });
        return id;
      },
      async get(id) { await call('get', id); return { ...tabs.get(id) }; },
      async remove(id) { await call('remove', id); tabs.delete(id); },
    },
    tabGroups: {
      async update(id, properties) { await call('group.update', id, properties); return { id, ...properties }; },
    },
  };
  return { api, calls, tabs };
}

test('grouping creates exactly two new tabs and mutes before navigation', async () => {
  const fixture = browserFixture();
  const result = await createGroupHandler(fixture.api)(request(), sender());
  assert.deepEqual(result, { groupId: 200, videoTabId: 100, chatgptTabId: 101 });
  const { calls, tabs } = fixture;
  const created = calls.filter(x => x.method === 'create');
  assert.equal(created.length, 2);
  created.forEach(({ args: [properties] }) => {
    assert.equal(properties.url, 'about:blank');
    assert.equal(properties.active, false);
    assert.equal(properties.windowId, 3);
    assert.equal(properties.openerTabId, 7);
  });
  const muteIndex = calls.findIndex(x => x.method === 'update' && x.args[0] === 100 && x.args[1].muted === true);
  const groupIndex = calls.findIndex(x => x.method === 'group');
  const navigations = calls.map((x, i) => [x, i]).filter(([x]) => x.method === 'update' && x.args[1].url);
  assert.equal(navigations.length, 2);
  navigations.forEach(([, index]) => { assert(muteIndex >= 0 && muteIndex < index); assert(groupIndex < index); });
  assert.deepEqual(calls[groupIndex].args[0], { tabIds: [100, 101], createProperties: { windowId: 3 } });
  assert.equal(calls.find(x => x.method === 'group.update').args[1].title, 'Vídeo de ejemplo');
  assert.equal(tabs.get(100).url, `${VIDEO}&${PLAYBACK_FLAG}=${REQUEST_ID}`);
  assert.equal(tabs.get(100).muted, true);
  assert.equal(tabs.get(100).active, true);
  assert.equal(new URL(tabs.get(101).url).searchParams.get('q'), `Resume ${VIDEO}`);
  assert.equal(tabs.get(101).active, false);
  assert.equal(tabs.get(7).url, 'https://www.youtube.com/');
  assert.equal(tabs.get(8).url, 'https://example.org/');
});

test('background activation leaves both new tabs in the background', async () => {
  const { api, tabs } = browserFixture();
  await createGroupHandler(api)(request({ background: true }), sender());
  assert.equal(tabs.get(100).active, false);
  assert.equal(tabs.get(101).active, false);
});

test('playback is registered before navigation and ChatGPT loads before the video', async () => {
  const { api, calls } = browserFixture();
  let prepared;
  await createGroupHandler(api, { preparePlayback: async (record) => {
    assert.equal(calls.filter(x => x.method === 'update' && x.args[1].url).length, 0);
    prepared = record;
  } })(request(), sender());
  assert.deepEqual(prepared, {
    requestId: REQUEST_ID, videoURL: VIDEO, videoTabId: 100, chatgptTabId: 101,
    groupId: 200, windowId: 3, focusChat: true,
  });
  assert.deepEqual(calls.filter(x => x.method === 'update' && x.args[1].url).map(x => x.args[0]), [101, 100]);
});

test('destinations are reconstructed and group titles are normalized', () => {
  const normalized = validateGroupRequest(request({ title: '  Un\n título\t ', chatgptURL: 'https://attacker.invalid/' }), sender(), EXTENSION_ID);
  assert.equal(normalized.title, 'Un título');
  assert.equal(new URL(normalized.chatgptURL).origin, 'https://chatgpt.com');
  assert.equal(new URL(normalized.chatgptURL).searchParams.get('q'), `Resume ${VIDEO}`);
  assert.equal(validateGroupRequest(request({ title: ' \n ' }), sender(), EXTENSION_ID).title, 'YouTube + ChatGPT');
});

test('invalid payloads and unauthorized senders cannot create tabs', async () => {
  const fixture = browserFixture();
  const handle = createGroupHandler(fixture.api);
  const badRequests = [
    { videoURL: 'javascript:alert(1)' }, { videoURL: 'https://attacker.invalid/watch?v=USeyDcWyVCc' },
    { videoURL: `${VIDEO}&redirect=https://attacker.invalid/` }, { videoURL: `${VIDEO}#fragment` },
    { videoURL: 'https://www.youtube.com/watch?v=short' }, { requestId: '' },
    { requestId: '__proto__' }, { title: 'x'.repeat(121) }, { title: {} },
    { background: 'false' }, { channel: 'different-channel' }, { type: 'anything' },
  ];
  for (const changes of badRequests) await assert.rejects(handle(request(changes), sender()));
  const badSenders = [
    { id: 'another-extension' }, { frameId: 1 }, { url: 'https://attacker.invalid/' },
    { url: 'https://www.youtube.com.attacker.invalid/' }, { url: 'http://www.youtube.com/' },
    { tab: undefined }, { tab: { id: -1, windowId: 3 } }, { tab: { id: 7, windowId: '3' } },
  ];
  for (const changes of badSenders) await assert.rejects(handle(request(), sender(changes)));
  assert.equal(fixture.calls.length, 0);
});

test('missing grouping APIs fail before creating any tab', async () => {
  for (const missing of ['tabs.create', 'tabs.update', 'tabs.group', 'tabGroups.update']) {
    const fixture = browserFixture();
    const [object, method] = missing.split('.');
    delete fixture.api[object][method];
    await assert.rejects(createGroupHandler(fixture.api)(request(), sender()));
    assert.equal(fixture.calls.length, 0, missing);
  }
});

test('concurrent duplicate IDs share one operation; changed payloads are rejected', async () => {
  const fixture = browserFixture();
  const handle = createGroupHandler(fixture.api);
  const first = handle(request(), sender());
  const duplicate = handle(request(), sender());
  assert.equal(first, duplicate);
  await assert.rejects(handle(request({ background: true }), sender()));
  const [a, b] = await Promise.all([first, duplicate]);
  assert.deepEqual(a, b);
  assert.equal(fixture.calls.filter(x => x.method === 'create').length, 2);
  assert.equal(await handle(request(), sender()), a);
});

test('request identity is scoped to the source tab', async () => {
  const fixture = browserFixture();
  const handle = createGroupHandler(fixture.api);
  const a = await handle(request(), sender());
  const b = await handle(request(), sender({ tab: { id: 8, windowId: 3 } }));
  assert.notEqual(a.groupId, b.groupId);
  assert.equal(fixture.calls.filter(x => x.method === 'create').length, 4);
});

test('rollback removes only the new tabs still known to be blank', async () => {
  const fixture = browserFixture(({ method }) => { if (method === 'group') throw Error('Grouping failed'); });
  const handle = createGroupHandler(fixture.api);
  await assert.rejects(handle(request(), sender()), /Grouping failed/);
  assert.deepEqual(fixture.calls.filter(x => x.method === 'remove').map(x => x.args[0]), [100, 101]);
  assert.deepEqual([...fixture.tabs.keys()], [7, 8]);
  await assert.rejects(handle(request(), sender()), /Grouping failed/);
  assert.equal(fixture.calls.filter(x => x.method === 'create').length, 2, 'failed requests are not replayed');
});

test('rollback preserves user-navigated, pending-navigation, and unknown-URL tabs', async () => {
  for (const changed of [{ url: 'https://example.org/' }, { pendingUrl: 'https://example.org/' }, { url: undefined }]) {
    const fixture = browserFixture(({ method }, { tabs }) => {
      if (method === 'group') { Object.assign(tabs.get(100), changed); throw Error('Grouping failed'); }
    });
    await assert.rejects(createGroupHandler(fixture.api)(request(), sender()));
    assert(fixture.tabs.has(100));
    assert.deepEqual(fixture.calls.filter(x => x.method === 'remove').map(x => x.args[0]), [101]);
    assert(fixture.tabs.has(7) && fixture.tabs.has(8));
  }
});

test('ambiguous failed navigation does not close a potentially navigated tab', async () => {
  const fixture = browserFixture(({ method, args }) => {
    if (method === 'update' && args[1].url) throw Error('Navigation failed after it may have started');
  });
  await assert.rejects(createGroupHandler(fixture.api)(request(), sender()));
  assert(fixture.tabs.has(101));
  assert.deepEqual(fixture.calls.filter(x => x.method === 'remove').map(x => x.args[0]), [100]);
});

test('bounded deduplication does not evict a pending request', async () => {
  let release;
  const paused = new Promise(resolve => { release = resolve; });
  const fixture = browserFixture(async ({ method }) => { if (method === 'create') await paused; });
  const handle = createGroupHandler(fixture.api, { maxRequests: 1, ttlMs: 0 });
  const first = handle(request(), sender());
  await assert.rejects(handle(request({ requestId: '70b05387-85f3-4d7f-a000-a123456789ab' }), sender()));
  assert.equal(handle(request(), sender()), first);
  release(); await first;
  assert.equal(fixture.calls.filter(x => x.method === 'create').length, 2);
});

test('MV3 package points at present modules and only injects into top-level YouTube', async () => {
  const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.type, 'module');
  assert(manifest.permissions.includes('tabGroups'));
  assert(manifest.permissions.includes('storage'));
  assert.equal(manifest.content_scripts[0].all_frames, false);
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://www.youtube.com/*', 'https://youtube.com/*']);
  await readFile(new URL(`../extension/${manifest.background.service_worker}`, import.meta.url));
  assert(manifest.content_scripts[0].js.indexOf('playback.js') < manifest.content_scripts[0].js.indexOf('startup.js'));
  for (const name of manifest.content_scripts[0].js) await readFile(new URL(`../extension/${name}`, import.meta.url));
});

test('worker routes only its internal channel and answers success or error asynchronously', async () => {
  const fixture = browserFixture();
  let listener;
  fixture.api.runtime.onMessage = { addListener(value) { listener = value; } };
  globalThis.chrome = fixture.api;
  try {
    await import('../extension/background.mjs');
    assert.equal(listener({ channel: 'unrelated' }, sender(), () => assert.fail('unexpected response')), undefined);
    const result = await new Promise(resolve => assert.equal(listener(request(), sender(), resolve), true));
    assert.equal(result.ok, true);
    assert.equal(result.value.groupId, 200);
    const playbackSender = sender({ url: VIDEO, tab: { id: 100, windowId: 3 } });
    const ready = await new Promise(resolve => listener({ ...request(), type: 'PLAYBACK_READY' }, playbackSender, resolve));
    assert.deepEqual(ready, { ok: true, value: { nativeMuted: true } });
    const playing = await new Promise(resolve => listener({ ...request(), type: 'PLAYBACK_STATUS', status: 'playing' }, playbackSender, resolve));
    assert.deepEqual(playing, { ok: true, value: { focused: true } });
    assert.equal(fixture.tabs.get(101).active, true);
    const error = await new Promise(resolve => assert.equal(listener(request(), sender({ frameId: 4 }), resolve), true));
    assert.equal(error.ok, false);
    assert.equal(typeof error.error, 'string');
  } finally { delete globalThis.chrome; }
});
