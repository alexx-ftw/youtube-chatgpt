import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../extension/bridge.js', import.meta.url), 'utf8');
const REQUEST = 'data-yt-chatgpt-group-request';
const ACCEPTED = 'data-yt-chatgpt-group-accepted';
const EVENT = 'yt-chatgpt-open-group';
const VIDEO = 'https://www.youtube.com/watch?v=USeyDcWyVCc';
const request = (changes = {}) => ({
  requestId: '60b05387-85f3-4d7f-a000-a123456789ab', videoURL: VIDEO,
  title: 'Vídeo de ejemplo', ...changes,
});

function domFixture() {
  class Element {
    constructor(tag = 'a') {
      this.tag = tag; this.attrs = new Map(); this.parentElement = null;
      this.isConnected = true; this.children = []; this.style = {}; this.textContent = '';
    }
    setAttribute(key, value) { this.attrs.set(key, String(value)); }
    getAttribute(key) { return this.attrs.get(key) ?? null; }
    removeAttribute(key) { this.attrs.delete(key); }
    matches(selector) { return selector === 'a.yt-chatgpt-open' && this.tag === 'a' && this.className === 'yt-chatgpt-open'; }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    append(child) { this.children.push(child); child.parentElement = this; child.isConnected = true; }
    remove() {
      if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(x => x !== this);
      this.isConnected = false;
    }
  }
  const listeners = new Map();
  const document = {
    body: new Element('body'), documentElement: new Element('html'),
    addEventListener(type, listener) {
      const entries = listeners.get(type) || []; entries.push(listener); listeners.set(type, entries);
    },
    createElement(tag) { return new Element(tag); },
    emit(type, target, options = {}) {
      const event = { type, target, button: 0, isTrusted: false, ctrlKey: false, metaKey: false, ...options };
      for (const listener of [...(listeners.get(type) || [])]) listener(event);
    },
  };
  function anchor(payload = request()) {
    const link = new Element(); link.className = 'yt-chatgpt-open';
    link.setAttribute(REQUEST, JSON.stringify(payload)); return link;
  }
  return { Element, document, anchor, listeners, now: 1000 };
}

function installBridge(dom, reply = () => Promise.resolve({ ok: true })) {
  const sent = [], timers = new Map();
  let nextTimer = 0;
  const context = vm.createContext({
    Element: dom.Element, document: dom.document, Date: { now: () => dom.now },
    setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    chrome: { runtime: { sendMessage(message) {
      sent.push(structuredClone(message)); return reply(message);
    } } },
  });
  vm.runInContext(source, context, { filename: 'extension/bridge.js' });
  return { context, sent, timers };
}

test('trusted left, middle and keyboard activations acknowledge synchronously', () => {
  for (const [type, props, background] of [
    ['click', { button: 0 }, false], ['auxclick', { button: 1 }, true],
    ['click', { button: 0, detail: 0 }, false],
    ['click', { button: 0, ctrlKey: true }, true], ['click', { button: 0, metaKey: true }, true],
  ]) {
    const dom = domFixture();
    const link = dom.anchor(request({ background: !background, chatgptURL: 'https://attacker.invalid/' }));
    const bridge = installBridge(dom, () => {
      assert.equal(link.getAttribute(ACCEPTED), request().requestId, 'ack exists before asynchronous work starts');
      return Promise.resolve({ ok: true });
    });
    dom.document.emit(type, link, { isTrusted: true, ...props });
    dom.document.emit(EVENT, link);
    assert.equal(link.getAttribute(ACCEPTED), request().requestId);
    assert.equal(bridge.sent.length, 1);
    assert.equal(bridge.sent[0].background, background, 'focus is derived from the real gesture, not request JSON');
    assert.equal(bridge.sent[0].channel, 'yt-chatgpt-groups');
    assert.equal(bridge.sent[0].type, 'OPEN_GROUP');
    assert.equal(bridge.sent[0].videoURL, VIDEO);
    assert.equal('chatgptURL' in bridge.sent[0], false);
  }
});

test('untrusted clicks, right clicks, pointerdown and requests without gestures cannot open groups', () => {
  for (const event of [null, ['click', { isTrusted: false }], ['click', { isTrusted: true, button: 2 }],
    ['auxclick', { isTrusted: true, button: 2 }], ['pointerdown', { isTrusted: true }],
    ['contextmenu', { isTrusted: true, button: 2 }]]) {
    const dom = domFixture(); const bridge = installBridge(dom); const link = dom.anchor();
    if (event) dom.document.emit(event[0], link, event[1]);
    dom.document.emit(EVENT, link);
    assert.equal(bridge.sent.length, 0);
    assert.equal(link.getAttribute(ACCEPTED), null);
  }
});

test('authorization is bound to one exact anchor and consumed once', () => {
  const dom = domFixture(); const bridge = installBridge(dom);
  const link = dom.anchor(), other = dom.anchor();
  const child = new dom.Element('span'); link.append(child);
  dom.document.emit('click', child, { isTrusted: true });
  dom.document.emit(EVENT, other); assert.equal(bridge.sent.length, 0);
  dom.document.emit(EVENT, link); assert.equal(bridge.sent.length, 1);
  link.removeAttribute(ACCEPTED);
  dom.document.emit(EVENT, link); assert.equal(bridge.sent.length, 1);
});

test('expired gestures and malformed requests are rejected without acknowledgement', () => {
  const invalid = ['not json', JSON.stringify(null), 'x'.repeat(1025),
    JSON.stringify(request({ requestId: 'bad' })), JSON.stringify(request({ title: 'x'.repeat(121) })),
    JSON.stringify(request({ videoURL: 'https://attacker.invalid/' })),
    JSON.stringify(request({ videoURL: `${VIDEO}&list=extra` }))];
  for (const raw of invalid) {
    const dom = domFixture(); const bridge = installBridge(dom); const link = dom.anchor();
    link.setAttribute(REQUEST, raw);
    dom.document.emit('click', link, { isTrusted: true }); dom.document.emit(EVENT, link);
    assert.equal(bridge.sent.length, 0); assert.equal(link.getAttribute(ACCEPTED), null);
    // Fixing the payload cannot reuse the consumed authorization.
    link.setAttribute(REQUEST, JSON.stringify(request())); dom.document.emit(EVENT, link);
    assert.equal(bridge.sent.length, 0);
  }
  const dom = domFixture(); const bridge = installBridge(dom); const link = dom.anchor();
  dom.document.emit('click', link, { isTrusted: true }); dom.now += 1001; dom.document.emit(EVENT, link);
  assert.equal(bridge.sent.length, 0); assert.equal(link.getAttribute(ACCEPTED), null);
});

test('reinjection and two separate extension worlds do not send the action twice', () => {
  const dom = domFixture(); const first = installBridge(dom);
  vm.runInContext(source, first.context);
  assert.equal(dom.listeners.get('click').length, 1);
  const second = installBridge(dom); const link = dom.anchor();
  dom.document.emit('click', link, { isTrusted: true }); dom.document.emit(EVENT, link);
  assert.equal(first.sent.length + second.sent.length, 1);
  assert.equal(link.getAttribute(ACCEPTED), request().requestId);
});

test('late worker failure retains acceptance and shows an error without retrying', async () => {
  for (const reply of [() => Promise.resolve({ ok: false, error: 'Grouping unavailable' }),
    () => Promise.reject(Error('Worker disconnected')), () => { throw Error('Extension context invalid'); }]) {
    const dom = domFixture(); dom.document.body = null;
    const bridge = installBridge(dom, reply); const link = dom.anchor();
    dom.document.emit('click', link, { isTrusted: true }); dom.document.emit(EVENT, link);
    assert.equal(link.getAttribute(ACCEPTED), request().requestId);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(bridge.sent.length, 1);
    const alerts = dom.document.documentElement.children.filter(node => node.getAttribute('role') === 'alert');
    assert.equal(alerts.length, 1);
    assert.match(alerts[0].textContent, /No se pudo completar el grupo/);
  }
});
