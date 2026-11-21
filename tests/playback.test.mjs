import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../extension/playback.js', import.meta.url), 'utf8');
const VIDEO_URL = 'https://www.youtube.com/watch?v=USeyDcWyVCc';
const OTHER_VIDEO = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

// This fixture controls time and media promises. It tests state transitions,
// not whether a real browser grants autoplay or produces audible playback.
function playbackFixture({ nativeMuted = false, withVideo = true, startURL = VIDEO_URL } = {}) {
  let now = 1000;
  let nextTimer = 0;
  const timers = new Map(), observers = [], trace = [], results = [];
  const clock = {
    setTimeout(callback, delay = 0) {
      const id = ++nextTimer;
      timers.set(id, { callback, at: now + Math.max(0, Number(delay) || 0) });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    async tick(milliseconds) {
      const end = now + milliseconds;
      let count = 0;
      await settle();
      for (;;) {
        const entry = [...timers].filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!entry) break;
        assert(++count < 10000, 'the controller must not schedule an unbounded immediate loop');
        const [id, timer] = entry;
        now = timer.at; timers.delete(id); timer.callback(); await settle();
      }
      now = end;
      await settle();
    },
  };
  class Target {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, callback, options) {
      const entries = this.listeners.get(type) || [];
      entries.push({ callback, once: Boolean(options?.once) });
      this.listeners.set(type, entries);
    }
    removeEventListener(type, callback) {
      this.listeners.set(type, (this.listeners.get(type) || []).filter(entry => entry.callback !== callback));
    }
    emit(type, properties = {}) {
      const event = { type, target: this, isTrusted: false, button: 0,
        ctrlKey: false, metaKey: false, altKey: false,
        preventDefault() {}, stopPropagation() {}, ...properties };
      for (const entry of [...(this.listeners.get(type) || [])]) {
        if (entry.once) this.removeEventListener(type, entry.callback);
        entry.callback(event);
      }
      return event;
    }
    listenerCount() { return [...this.listeners.values()].reduce((sum, entries) => sum + entries.length, 0); }
  }
  class Element extends Target {
    constructor(tag = 'div') {
      super(); this.tagName = tag.toUpperCase(); this.className = ''; this.id = '';
      this.parentElement = null; this.isConnected = true; this.attrs = new Map();
      this.isContentEditable = false;
    }
    get classList() {
      const node = this;
      return {
        contains(name) { return node.className.split(/\s+/).includes(name); },
        add(name) { node.className = [...new Set(node.className.split(/\s+/).filter(Boolean).concat(name))].join(' '); },
        remove(name) { node.className = node.className.split(/\s+/).filter(value => value !== name).join(' '); },
      };
    }
    getAttribute(name) { return this.attrs.get(name) ?? null; }
    setAttribute(name, value) { this.attrs.set(name, String(value)); }
    hasAttribute(name) { return this.attrs.has(name); }
    matches(selector) {
      return selector.split(',').some(part => {
        const item = part.trim();
        if (item === 'video' || item === 'video.html5-main-video') return this.tagName === 'VIDEO';
        if (item === 'input' || item === 'textarea' || item === 'select') return this.tagName === item.toUpperCase();
        if (item.includes('[contenteditable')) return this.isContentEditable;
        if (item === '[role="textbox"]') return this.getAttribute('role') === 'textbox';
        if (item.startsWith('#')) {
          const [id, ...classes] = item.slice(1).split('.');
          return this.id === id && classes.every(name => this.classList.contains(name));
        }
        if (item.startsWith('.')) return item.slice(1).split('.').every(name => this.classList.contains(name));
        return this.tagName === item.toUpperCase();
      });
    }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    contains(node) { return node === this || Boolean(node?.parentElement && this.contains(node.parentElement)); }
    querySelector(selector) {
      if (this === player && selector.includes('video')) return currentVideo;
      return null;
    }
    querySelectorAll(selector) {
      const node = this.querySelector(selector); return node ? [node] : [];
    }
  }
  class Video extends Element {
    constructor() {
      super('video'); this.className = 'html5-main-video'; this.parentElement = player;
      this._muted = false; this.volume = 1; this.paused = true; this.ended = false;
      this.seeking = false; this.currentTime = 0; this.duration = 600;
      this.readyState = 4; this.networkState = 1; this.playbackRate = 1;
      this.videoWidth = 1920; this.videoHeight = 1080;
      this.playCalls = []; this.error = null;
      this.playBehavior = () => { this.paused = false; return Promise.resolve(); };
    }
    get muted() { return this._muted; }
    set muted(value) { this._muted = Boolean(value); trace.push({ type: 'mute', video: this, value: this._muted, at: now }); }
    play() {
      const call = { type: 'play', video: this, muted: this.muted, at: now };
      this.playCalls.push(call); trace.push(call); return this.playBehavior();
    }
    pause() { this.paused = true; this.emit('pause'); }
  }
  const player = new Element(); player.id = 'movie_player';
  const body = new Element('body'); player.parentElement = body;
  let currentVideo = withVideo ? new Video() : null;
  const document = new Target();
  Object.assign(document, {
    body, documentElement: new Element('html'), readyState: 'complete', hidden: false,
    querySelector(selector) {
      if (selector.includes('video')) return currentVideo;
      if (selector.includes('.ad-showing') || selector.includes('.ad-interrupting')) {
        return player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting') ? player : null;
      }
      if (selector === '#movie_player') return player;
      return null;
    },
    querySelectorAll(selector) { const node = this.querySelector(selector); return node ? [node] : []; },
  });
  const window = new Target();
  const location = new URL(startURL);
  class Observer {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe(target, options) { this.target = target; this.options = options; }
    disconnect() { this.disconnected = true; }
  }
  const context = vm.createContext({
    console, URL, document, window, location, Element,
    HTMLMediaElement: Video, HTMLVideoElement: Video, MutationObserver: Observer,
    Date: { now: () => now }, performance: { now: () => now },
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
  });
  vm.runInContext(source, context, { filename: 'extension/playback.js' });
  let stop;
  return {
    clock, trace, results, observers, timers, document, window, location, player, body, Element,
    get video() { return currentVideo; },
    get stop() { return stop; },
    createVideo() { return new Video(); },
    replaceVideo(video) {
      if (currentVideo) currentVideo.isConnected = false;
      currentVideo = video;
      if (video) { video.isConnected = true; video.parentElement = player; }
      observers.filter(observer => !observer.disconnected)
        .forEach(observer => observer.callback([{ type: 'childList', addedNodes: video ? [video] : [], removedNodes: [] }]));
    },
    start() {
      stop = context.startYouTubePlayback({ videoURL: VIDEO_URL, nativeMuted,
        onResult(result) { results.push(structuredClone(result)); },
        onNeedsMute() { trace.push({ type: 'needsMute', video: currentVideo, muted: currentVideo?.muted, at: now }); },
      });
      return stop;
    },
  };
}

async function progress(env, video = env.video, milliseconds = 4000) {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 250) {
    video.currentTime += 0.25;
    await env.clock.tick(250);
  }
}

function assertStopped(env) {
  assert.equal(env.timers.size, 0, 'all scheduled attempts are cleared');
  assert.equal(env.document.listenerCount(), 0, 'document listeners are removed');
  assert.equal(env.window.listenerCount(), 0, 'window listeners are removed');
  assert(env.observers.every(observer => observer.disconnected), 'observers are disconnected');
}

test('fallback mutes before asking the video to play and confirms actual progress', async () => {
  const env = playbackFixture(); env.start(); await env.clock.tick(0);
  assert(env.video.playCalls.length > 0);
  assert.equal(env.video.playCalls[0].muted, true);
  const mute = env.trace.findIndex(entry => entry.type === 'mute' && entry.value);
  const needsMute = env.trace.findIndex(entry => entry.type === 'needsMute');
  const play = env.trace.findIndex(entry => entry.type === 'play');
  assert(mute >= 0 && mute < needsMute && needsMute < play);
  assert.equal(env.trace[needsMute].muted, true);
  assert.equal(env.results.length, 0, 'play() resolution alone is insufficient');
  await progress(env);
  assert.deepEqual(env.results, [{ status: 'playing' }]);
  assertStopped(env);
});

test('native tab muting initially preserves the media mute flag', async () => {
  const env = playbackFixture({ nativeMuted: true }); env.start(); await env.clock.tick(0);
  assert.equal(env.video.playCalls[0].muted, false);
  assert.equal(env.video.muted, false);
  assert.equal(env.trace.filter(entry => entry.type === 'needsMute').length, 0);
  await progress(env); assert.deepEqual(env.results, [{ status: 'playing' }]);
});

test('NotAllowedError on a natively muted tab causes one muted retry', async () => {
  const env = playbackFixture({ nativeMuted: true });
  let attempt = 0;
  env.video.playBehavior = () => {
    if (attempt++ === 0) return Promise.reject(Object.assign(new Error('Autoplay blocked'), { name: 'NotAllowedError' }));
    env.video.paused = false; return Promise.resolve();
  };
  env.start(); await env.clock.tick(2000);
  assert.equal(env.video.playCalls.length, 2);
  assert.equal(env.video.playCalls[0].muted, false);
  assert.equal(env.video.playCalls[1].muted, true);
  assert.equal(env.trace.filter(entry => entry.type === 'needsMute').length, 1);
  await progress(env); assert.deepEqual(env.results, [{ status: 'playing' }]);
});

test('a pending play promise is never overlapped on the same media element', async () => {
  const env = playbackFixture(); let resolvePlay;
  const pending = new Promise(resolve => { resolvePlay = resolve; });
  env.video.playBehavior = () => pending;
  env.start(); await env.clock.tick(10000);
  assert.equal(env.video.playCalls.length, 1);
  assert.equal(env.results.length, 0);
  env.video.paused = false; resolvePlay(); await settle();
  await progress(env);
  assert.equal(env.video.playCalls.length, 1);
  assert.deepEqual(env.results, [{ status: 'playing' }]);
});

test('a replacement video can start while an old promise remains pending', async () => {
  const env = playbackFixture(); const old = env.video; let resolveOld;
  old.playBehavior = () => new Promise(resolve => { resolveOld = resolve; });
  env.start(); await env.clock.tick(500);
  const replacement = env.createVideo(); env.replaceVideo(replacement); await env.clock.tick(500);
  assert.equal(old.playCalls.length, 1);
  assert.equal(replacement.playCalls.length, 1);
  assert.equal(replacement.playCalls[0].muted, true);
  old.paused = false; old.currentTime = 50; resolveOld(); await settle();
  await env.clock.tick(500); assert.equal(env.results.length, 0);
  await progress(env, replacement);
  assert.deepEqual(env.results, [{ status: 'playing' }]);
  assert.equal(old.playCalls.length, 1);
});

test('a resolved promise, playing event, and advancing ad do not confirm the requested video', async () => {
  const env = playbackFixture(); env.player.classList.add('ad-showing');
  env.start(); await env.clock.tick(500);
  env.video.emit('playing'); env.document.emit('playing', { target: env.video });
  await env.clock.tick(2000); assert.equal(env.results.length, 0);
  await progress(env); assert.equal(env.results.length, 0, 'ad progress is not content progress');
  env.player.classList.remove('ad-showing');
  await progress(env); assert.deepEqual(env.results, [{ status: 'playing' }]);
});

test('seeking and a discontinuous time jump do not count as playback progress', async () => {
  const env = playbackFixture(); env.start(); await env.clock.tick(500);
  env.video.seeking = true; env.document.emit('seeking', { target: env.video });
  await progress(env); assert.equal(env.results.length, 0);
  env.video.currentTime += 60; env.video.seeking = false; env.document.emit('seeked', { target: env.video });
  await env.clock.tick(2000); assert.equal(env.results.length, 0);
  await progress(env); assert.deepEqual(env.results, [{ status: 'playing' }]);
});

test('an unexplained currentTime jump cannot satisfy previously established playback evidence', async () => {
  const env = playbackFixture(); env.start(); await env.clock.tick(1000);
  assert.equal(env.video.paused, false);
  assert.equal(env.results.length, 0);
  // No seeking flag or event: a restored playback position must still be rejected.
  env.video.currentTime = 90;
  await env.clock.tick(2000); assert.equal(env.results.length, 0);
  await progress(env); assert.deepEqual(env.results, [{ status: 'playing' }]);
});

test('a browser policy rejection in a hidden tab waits for visibility instead of retrying in a loop', async () => {
  const env = playbackFixture({ nativeMuted: true });
  env.document.visibilityState = 'hidden';
  let attempt = 0;
  env.video.playBehavior = () => {
    if (attempt++ < 2) return Promise.reject(Object.assign(new Error('Policy'), { name: 'NotAllowedError' }));
    env.video.paused = false; return Promise.resolve();
  };
  env.start(); await env.clock.tick(10000);
  assert.equal(env.video.playCalls.length, 2);
  assert.equal(env.video.muted, true);
  assert.equal(env.results.length, 0);
  env.document.visibilityState = 'visible'; env.document.emit('visibilitychange');
  await env.clock.tick(0); assert.equal(env.video.playCalls.length, 3);
  await progress(env); assert.deepEqual(env.results, [{ status: 'playing' }]);
  assertStopped(env);
});

test('a trusted pause gesture cancels attempts; synthetic gestures do not', async () => {
  const env = playbackFixture(); env.start(); await env.clock.tick(0);
  const control = new env.Element('button'); control.className = 'ytp-play-button'; control.parentElement = env.player;
  env.document.emit('pointerdown', { target: control, isTrusted: false });
  assert.equal(env.results.length, 0);
  env.document.emit('pointerdown', { target: control, isTrusted: true });
  assert.deepEqual(env.results, [{ status: 'cancelled' }]);
  const attempts = env.video.playCalls.length;
  env.video.paused = true; await env.clock.tick(5000);
  assert.equal(env.video.playCalls.length, attempts);
  assertStopped(env);
});

test('after confirmed success a manual pause does not trigger playback again', async () => {
  const env = playbackFixture(); env.start(); await progress(env);
  assert.deepEqual(env.results, [{ status: 'playing' }]);
  const attempts = env.video.playCalls.length;
  env.video.paused = true;
  env.document.emit('keydown', { target: env.player, key: 'k', code: 'KeyK', isTrusted: true });
  env.video.emit('pause', { isTrusted: true });
  await env.clock.tick(5000);
  assert.equal(env.video.playCalls.length, attempts);
  assert.deepEqual(env.results, [{ status: 'playing' }]);
  assertStopped(env);
});

test('a different video is never played and navigation cancels ongoing attempts', async () => {
  const wrong = playbackFixture({ startURL: OTHER_VIDEO }); wrong.start(); await wrong.clock.tick(500);
  assert.equal(wrong.video.playCalls.length, 0);
  assert.deepEqual(wrong.results, [{ status: 'cancelled' }]);
  const env = playbackFixture(); env.start(); await env.clock.tick(500);
  const attempts = env.video.playCalls.length;
  env.location.href = OTHER_VIDEO; env.document.emit('yt-navigate-finish'); await env.clock.tick(500);
  assert.deepEqual(env.results, [{ status: 'cancelled' }]);
  assert.equal(env.video.playCalls.length, attempts);
  assertStopped(env);
});

test('deadline and explicit stop clear all attempts and report only once', async () => {
  const env = playbackFixture({ withVideo: false }); env.start(); await env.clock.tick(91000);
  assert.equal(env.results.length, 1);
  assert.equal(env.results[0].status, 'failed');
  assert.equal(typeof env.results[0].reason, 'string');
  assertStopped(env);
  env.stop(); await env.clock.tick(5000); assert.equal(env.results.length, 1);
  const stopped = playbackFixture(); stopped.start(); await stopped.clock.tick(0);
  stopped.stop(); stopped.stop(); await stopped.clock.tick(5000);
  assert.deepEqual(stopped.results, [{ status: 'cancelled' }]); assertStopped(stopped);
});
