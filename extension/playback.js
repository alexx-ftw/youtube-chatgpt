// Shared classic script: also embedded verbatim inside the userscript's IIFE.
// Start once for an explicitly marked watch page. Never keep a video playing
// after success, user intervention, navigation, an error, or the 90-second limit.
'use strict';

function startYouTubePlayback({ videoURL, nativeMuted = false, onResult = () => {}, onNeedsMute = () => {} } = {}) {
  const MAX_ATTEMPTS = 12;
  const CHECK_MS = 250;
  const RETRY_MS = 1000;
  const DEADLINE_MS = 90000;
  const states = new WeakMap();
  const listeners = [];
  let active = true;
  let selected = null;
  let attempts = 0;
  let forceElementMute = !nativeMuted;
  let muteNotified = false;
  let checkTimer = null;
  let deadlineTimer = null;

  function videoId(value) {
    try {
      const url = new URL(value, location.origin);
      const id = url.pathname === '/watch' ? url.searchParams.get('v') : null;
      return ['https://www.youtube.com', 'https://youtube.com'].includes(url.origin)
        && /^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : null;
    } catch { return null; }
  }
  const expectedId = videoId(videoURL);

  function listen(target, type, handler, capture = false) {
    target.addEventListener(type, handler, capture);
    listeners.push(() => target.removeEventListener(type, handler, capture));
  }

  function finish(result) {
    if (!active) return;
    active = false;
    clearTimeout(checkTimer);
    clearTimeout(deadlineTimer);
    for (const remove of listeners) remove();
    // In-flight play promises cannot be cancelled; their handlers check active.
    try { onResult(result); } catch { /* A consumer callback must not restart us. */ }
  }

  function stop() {
    finish({ status: 'cancelled' });
  }

  function samePage() {
    if (videoId(location.href) === expectedId) return true;
    stop();
    return false;
  }

  function findVideo() {
    const usable = (video) => video instanceof HTMLVideoElement && !video.closest('[hidden]');
    return [...document.querySelectorAll('#movie_player video.html5-main-video')].find(usable)
      || [...document.querySelectorAll('#movie_player video')].find(usable) || null;
  }

  function stateFor(video) {
    let state = states.get(video);
    if (!state) {
      state = { pending: false, retryAt: 0, blocked: false, source: null, ad: null,
        previousTime: null, sampledAt: 0, progressed: 0 };
      states.set(video, state);
    }
    return state;
  }

  function resetEvidence(state) {
    state.previousTime = null;
    state.sampledAt = 0;
    state.progressed = 0;
  }

  function ensureMuted(video) {
    if (!forceElementMute || !active) return;
    if (!video.muted) video.muted = true;
    if (!muteNotified) {
      muteNotified = true;
      try { onNeedsMute(); } catch { /* The element itself is already muted. */ }
    }
  }

  function wake(delay = 0) {
    if (!active) return;
    if (checkTimer !== null) {
      if (delay) return;
      clearTimeout(checkTimer);
    }
    checkTimer = setTimeout(() => { checkTimer = null; check(); }, delay);
  }

  function attemptPlay(video, state) {
    if (state.pending || state.blocked || Date.now() < state.retryAt) return;
    if (attempts >= MAX_ATTEMPTS) {
      finish({ status: 'failed', reason: 'play-attempt-limit' });
      return;
    }
    ensureMuted(video);
    if (!active) return;
    state.pending = true;
    state.retryAt = Date.now() + RETRY_MS;
    attempts += 1;

    function settled(error) {
      state.pending = false;
      // A replacement can start immediately, even while this old promise waits.
      if (!active || selected !== video || !video.isConnected || !samePage()) return;
      if (error?.name === 'NotAllowedError') {
        if (!forceElementMute) {
          forceElementMute = true;
          ensureMuted(video);
          state.retryAt = 0;
        } else if (document.visibilityState === 'hidden') {
          state.blocked = true; // Retry on visibility/source change, not a loop.
        } else {
          finish({ status: 'failed', reason: 'autoplay-blocked' });
          return;
        }
      } else if (error && error.name !== 'AbortError') {
        finish({ status: 'failed', reason: `play-error:${error.name || 'Error'}` });
        return;
      } else if (error) {
        state.retryAt = Date.now() + RETRY_MS;
      }
      wake();
    }

    try {
      Promise.resolve(video.play()).then(() => settled(null), settled);
    } catch (error) {
      settled(error);
    }
  }

  function check() {
    if (!active || !samePage()) return;
    const video = findVideo();
    if (selected !== video) {
      selected = video;
      if (video) resetEvidence(stateFor(video));
    }
    if (!video) { wake(CHECK_MS); return; }

    const state = stateFor(video);
    const player = video.closest('#movie_player');
    const source = video.currentSrc || video.getAttribute('src') || '';
    const ad = Boolean(player?.classList.contains('ad-showing') || player?.classList.contains('ad-interrupting'));
    if (source !== state.source || ad !== state.ad) {
      state.source = source;
      state.ad = ad;
      state.blocked = false;
      state.retryAt = 0;
      resetEvidence(state);
    }
    ensureMuted(video);
    if (!active) return;
    if (video.error) {
      finish({ status: 'failed', reason: `media-error:${video.error.code || 'unknown'}` });
      return;
    }

    const time = video.currentTime;
    const now = Date.now();
    if (ad || video.paused || video.ended || video.seeking || video.readyState < 2 || !Number.isFinite(time)) {
      resetEvidence(state);
    } else {
      if (state.previousTime !== null) {
        const elapsed = (now - state.sampledAt) / 1000;
        const delta = time - state.previousTime;
        const rate = Number.isFinite(video.playbackRate) ? Math.abs(video.playbackRate) : 1;
        // Seeking events reset the sample; also reject unexplained large jumps
        // so a restored position cannot masquerade as real playback progress.
        if (elapsed < 0 || delta < 0 || delta > Math.max(0.75, elapsed * rate * 2 + 0.25)) {
          resetEvidence(state);
        } else {
          state.progressed += delta;
          if (state.progressed >= 0.25) {
            finish({ status: 'playing' });
            return;
          }
        }
      }
      state.previousTime = time;
      state.sampledAt = now;
    }

    if (video.ended && !ad) {
      finish({ status: 'failed', reason: 'video-ended-before-confirmation' });
      return;
    }
    if (video.paused && !video.ended && (source || video.readyState >= 1)) attemptPlay(video, state);
    wake(CHECK_MS);
  }

  function onMedia(event) {
    if (!active || !samePage()) return;
    const video = event.target;
    if (!(video instanceof HTMLVideoElement) || !video.closest('#movie_player')) return;
    if (video !== findVideo()) return;
    const state = stateFor(video);
    if (['seeking', 'seeked', 'loadstart', 'emptied'].includes(event.type)) resetEvidence(state);
    if (event.type === 'loadstart' || event.type === 'emptied') {
      state.source = null;
      state.blocked = false;
    }
    ensureMuted(video);
    wake();
  }

  function onInteraction(event) {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const target = event.target;
    if (event.type === 'keydown') {
      if (event.ctrlKey || event.metaKey || event.altKey
        || target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
      const key = String(event.key || '').toLowerCase();
      const globalShortcut = [' ', 'spacebar', 'k', 'm', 'j', 'l'].includes(key) || /^[0-9]$/.test(key);
      const playerShortcut = target.closest('#movie_player')
        && ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'home', 'end'].includes(key);
      if (globalShortcut || playerShortcut) stop();
    } else if ((event.button === undefined || event.button === 0) && target.closest('#movie_player')
      && target.closest('video, .ytp-play-button, .ytp-large-play-button, .ytp-cued-thumbnail-overlay, '
        + '.ytp-progress-bar-container, .ytp-progress-bar, .ytp-scrubber-container, .ytp-mute-button, .ytp-volume-panel')) {
      stop();
    }
  }

  if (!expectedId) {
    finish({ status: 'failed', reason: 'invalid-video-url' });
    return stop;
  }
  const mediaEvents = ['loadedmetadata', 'canplay', 'playing', 'timeupdate', 'seeking', 'seeked',
    'loadstart', 'emptied', 'pause', 'error', 'volumechange'];
  mediaEvents.forEach((type) => listen(document, type, onMedia, true));
  ['pointerdown', 'click', 'keydown'].forEach((type) => listen(document, type, onInteraction, true));
  ['yt-navigate-finish', 'yt-page-data-updated'].forEach((type) => listen(document, type, () => { if (samePage()) wake(); }));
  listen(window, 'popstate', () => { if (samePage()) wake(); });
  listen(window, 'pagehide', stop);
  listen(document, 'visibilitychange', () => {
    if (selected && document.visibilityState !== 'hidden') {
      const state = stateFor(selected);
      state.blocked = false;
      state.retryAt = 0;
    }
    wake();
  });
  deadlineTimer = setTimeout(() => finish({ status: 'failed', reason: 'timeout' }), DEADLINE_MS);
  check();
  return stop;
}
