import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../extension/startup.js', import.meta.url), 'utf8');
const VIDEO = 'https://www.youtube.com/watch?v=USeyDcWyVCc';
const REQUEST = '60b05387-85f3-4d7f-a000-a123456789ab';
const MARKER = 'yt_chatgpt_group_play';
const marked = `${VIDEO}&${MARKER}=${REQUEST}`;
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture({ href = marked, reply, noRoot = false, historyFails = false,
  controllerThrows = false, noController = false } = {}) {
  class Element {
    constructor() { this.children = []; this.parent = null; this.style = {}; this.attrs = {}; this.textContent = ''; }
    setAttribute(key, value) { this.attrs[key] = value; }
    append(node) { this.children.push(node); node.parent = this; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
  }
  const location = { href };
  const listeners = new Map();
  const document = {
    body: noRoot ? null : new Element(), documentElement: noRoot ? null : new Element(),
    createElement() { return new Element(); },
    addEventListener(type, listener, options) {
      const entries = listeners.get(type) || []; entries.push({ listener, options }); listeners.set(type, entries);
    },
    emit(type) {
      const entries = [...(listeners.get(type) || [])];
      for (const entry of entries) {
        if (entry.options?.once) listeners.set(type, (listeners.get(type) || []).filter(item => item !== entry));
        entry.listener();
      }
    },
  };
  const messages = [], starts = [], replacements = [], timers = new Map();
  let timerId = 0;
  const history = {
    state: { retained: true },
    replaceState(state, title, value) {
      replacements.push({ state, title, value });
      if (historyFails) throw new Error('history disabled');
      location.href = value;
    },
  };
  const context = vm.createContext({
    URL, location, history, document,
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    chrome: { runtime: { sendMessage(message) {
      messages.push(structuredClone(message));
      return reply ? reply(message) : Promise.resolve({ ok: true, value: { nativeMuted: true } });
    } } },
    ...(!noController ? { startYouTubePlayback(options) {
      starts.push(options);
      if (controllerThrows) throw new Error('controller initialization failed');
    } } : {}),
  });
  return {
    context, location, history, document, messages, starts, replacements, timers, Element,
    run() { vm.runInContext(source, context, { filename: 'extension/startup.js' }); },
    notices() { return [...(document.body?.children || []), ...(document.documentElement?.children || [])]; },
    expire(delay) {
      for (const [id, timer] of [...timers]) {
        if (timer.delay === delay) { timers.delete(id); timer.callback(); }
      }
    },
  };
}

test('startup is limited to a valid helper marker on a YouTube watch URL', async () => {
  for (const href of [VIDEO, `${VIDEO}&yt_chatgpt_mute=1`, `${VIDEO}&${MARKER}=invalid`,
    `https://www.youtube.com/results?v=USeyDcWyVCc&${MARKER}=${REQUEST}`,
    `https://www.youtube.com/watch?v=bad&${MARKER}=${REQUEST}`,
    `https://attacker.invalid/watch?v=USeyDcWyVCc&${MARKER}=${REQUEST}`,
    `http://www.youtube.com/watch?v=USeyDcWyVCc&${MARKER}=${REQUEST}`]) {
    const dom = fixture({ href }); dom.run(); await tick();
    assert.equal(dom.messages.length, 0, href);
    assert.equal(dom.starts.length, 0);
    assert.equal(dom.replacements.length, 0);
    assert.equal(dom.notices().length, 0);
  }
});

test('consumes only its marker and waits for tab authorization before playing', async () => {
  let authorize;
  const dom = fixture({
    href: `${marked}&t=24&list=keep&yt_chatgpt_mute=1#part`,
    reply: () => new Promise(resolve => { authorize = resolve; }),
  });
  dom.run();
  assert.equal(dom.starts.length, 0);
  assert.equal(dom.location.href, `${VIDEO}&t=24&list=keep&yt_chatgpt_mute=1#part`);
  assert.equal(dom.replacements[0].state, dom.history.state);
  assert.deepEqual(dom.messages, [{
    channel: 'yt-chatgpt-groups', type: 'PLAYBACK_READY', requestId: REQUEST, videoURL: VIDEO,
  }]);
  authorize({ ok: true, value: { nativeMuted: true } }); await tick();
  assert.equal(dom.starts.length, 1);
  assert.equal(dom.starts[0].videoURL, VIDEO);
  assert.equal(dom.starts[0].nativeMuted, true);
  assert.equal(dom.timers.size, 0);
  assert.equal(dom.notices().length, 0);
});

test('propagates unconfirmed native mute so the player controller can mute first', async () => {
  const dom = fixture({ href: marked.replace('www.youtube.com', 'youtube.com'),
    reply: () => Promise.resolve({ ok: true, value: { nativeMuted: false } }) });
  dom.run(); await tick();
  assert.equal(dom.starts.length, 1);
  assert.equal(dom.starts[0].nativeMuted, false);
  assert.equal(dom.starts[0].videoURL, VIDEO);
});

test('authorization failures produce a notice without calling the player', async () => {
  for (const reply of [() => Promise.resolve({ ok: false, error: 'unknown tab' }),
    () => Promise.resolve({ ok: true, value: { nativeMuted: 'true' } }),
    () => Promise.resolve(undefined), () => Promise.reject(Error('worker stopped')),
    () => { throw Error('extension unavailable'); }]) {
    const dom = fixture({ reply }); dom.run(); await tick();
    assert.equal(dom.starts.length, 0);
    assert.equal(dom.messages.length, 1);
    assert.equal(dom.notices().length, 1);
    assert.equal(dom.notices()[0].attrs.role, 'alert');
    assert.match(dom.notices()[0].textContent, /Pulsa Reproducir/);
    assert.equal([...dom.timers.values()].some(timer => timer.delay === 10000), false);
  }
});

test('navigation while awaiting authorization cancels without touching another video', async () => {
  let authorize;
  const dom = fixture({ reply: message => message.type === 'PLAYBACK_READY'
    ? new Promise(resolve => { authorize = resolve; }) : Promise.resolve({ ok: true }) });
  dom.run();
  dom.location.href = 'https://www.youtube.com/watch?v=SNwoI6531us';
  authorize({ ok: true, value: { nativeMuted: true } }); await tick();
  assert.equal(dom.starts.length, 0);
  assert.equal(dom.messages[1].status, 'cancelled');
  assert.equal(dom.notices().length, 0);
});

test('reports exactly one terminal result and only failed playback shows a notice', async () => {
  for (const status of ['playing', 'cancelled', 'failed']) {
    const dom = fixture(); dom.run(); await tick();
    dom.starts[0].onResult({ status });
    dom.starts[0].onResult({ status: 'failed' });
    await tick();
    assert.deepEqual(dom.messages[1], {
      channel: 'yt-chatgpt-groups', type: 'PLAYBACK_STATUS', requestId: REQUEST, videoURL: VIDEO, status,
    });
    assert.equal(dom.messages.length, 2);
    assert.equal(dom.starts.length, 1);
    assert.equal(dom.notices().length, status === 'failed' ? 1 : 0);
  }
});

test('status reporting failure explains where ChatGPT is without restarting playback', async () => {
  for (const statusReply of [() => Promise.reject(Error('port closed')),
    () => { throw Error('context invalidated'); },
    () => Promise.resolve({ ok: false, error: 'startup expired' })]) {
    const dom = fixture({ reply: message => message.type === 'PLAYBACK_READY'
      ? Promise.resolve({ ok: true, value: { nativeMuted: true } }) : statusReply() });
    dom.run(); await tick();
    dom.starts[0].onResult({ status: 'playing' }); await tick();
    assert.equal(dom.messages.length, 2);
    assert.equal(dom.starts.length, 1);
    assert.equal(dom.notices().length, 1);
    assert.match(dom.notices()[0].textContent, /El vídeo está reproduciéndose/);
    assert.match(dom.notices()[0].textContent, /Abre la pestaña de ChatGPT del grupo/);
    assert.doesNotMatch(dom.notices()[0].textContent, /Pulsa Reproducir/);
  }
});

test('intentional focus suppression is quiet when playback status was accepted', async () => {
  const dom = fixture({ reply: message => message.type === 'PLAYBACK_READY'
    ? Promise.resolve({ ok: true, value: { nativeMuted: true } })
    : Promise.resolve({ ok: true, value: { focused: false } }) });
  dom.run(); await tick();
  dom.starts[0].onResult({ status: 'playing' }); await tick();
  assert.equal(dom.notices().length, 0);
  assert.equal(dom.messages.length, 2);
  assert.equal(dom.starts.length, 1);
});

test('controller initialization errors report failure instead of opening tabs or retrying', async () => {
  for (const options of [{ controllerThrows: true }, { noController: true }]) {
    const dom = fixture(options); dom.run(); await tick();
    assert.equal(dom.messages.length, 2);
    assert.equal(dom.messages[1].status, 'failed');
    assert.equal(dom.notices().length, 1);
  }
});

test('authorization timeout ignores a late success and does not start playback', async () => {
  let authorize;
  const dom = fixture({ reply: () => new Promise(resolve => { authorize = resolve; }) });
  dom.run(); dom.expire(10000); await tick();
  assert.equal(dom.notices().length, 1);
  authorize({ ok: true, value: { nativeMuted: true } }); await tick();
  assert.equal(dom.starts.length, 0);
  assert.equal(dom.messages.length, 1);
});

test('reinjection is harmless even when consuming the marker fails', async () => {
  const dom = fixture({ historyFails: true });
  dom.run(); dom.run(); await tick();
  assert.equal(dom.messages.length, 1);
  assert.equal(dom.starts.length, 1);
  assert.equal(dom.replacements.length, 1);
});

test('failure notices wait for a DOM root and are suppressed after navigation', async () => {
  for (const navigate of [false, true]) {
    const dom = fixture({ noRoot: true, reply: () => Promise.resolve({ ok: false }) });
    dom.run(); await tick(); assert.equal(dom.notices().length, 0);
    if (navigate) dom.location.href = 'https://www.youtube.com/watch?v=SNwoI6531us';
    dom.document.body = new dom.Element(); dom.document.emit('DOMContentLoaded');
    assert.equal(dom.notices().length, navigate ? 0 : 1);
    dom.expire(15000); assert.equal(dom.notices().length, 0);
  }
});
