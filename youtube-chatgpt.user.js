// ==UserScript==
// @name         YouTube: abrir vídeo en ChatGPT
// @namespace    eros.youtube.chatgpt
// @version      1.3.0
// @description  Reproduce el vídeo silenciado y abre su resumen en ChatGPT, agrupados con el complemento.
// @homepageURL  https://github.com/alexx-ftw/youtube-chatgpt
// @supportURL   https://github.com/alexx-ftw/youtube-chatgpt/issues
// @updateURL    https://raw.githubusercontent.com/alexx-ftw/youtube-chatgpt/main/youtube-chatgpt.user.js
// @downloadURL  https://raw.githubusercontent.com/alexx-ftw/youtube-chatgpt/main/youtube-chatgpt.user.js
// @match        https://www.youtube.com/*
// @match        https://youtube.com/*
// @run-at       document-start
// @grant        GM_openInTab
// @grant        GM_audio
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  const MUTE_FLAG = 'yt_chatgpt_mute';

  // Se ejecuta antes de esperar al DOM, solo en la pestaña de vídeo recién abierta.
  startMutedTab();

  function startMutedTab() {
    const url = new URL(location.href);
    const videoURL = canonicalVideoURL(url.href);
    if (!videoURL || url.searchParams.get(MUTE_FLAG) !== '1') return;

    url.searchParams.delete(MUTE_FLAG);
    try {
      history.replaceState(history.state, '', url.href);
    } catch { /* El silenciado sigue funcionando aunque no se pueda limpiar la URL. */ }

    let fallbackStarted = false;
    let playbackStarted = false;
    const fallback = () => {
      if (fallbackStarted || canonicalVideoURL(location.href) !== videoURL) return;
      fallbackStarted = true;
      startPlayerMuteFallback(videoURL);
    };
    const beginPlayback = (nativeMuted) => {
      if (playbackStarted || canonicalVideoURL(location.href) !== videoURL) return;
      playbackStarted = true;
      clearTimeout(muteTimeout);
      startYouTubePlayback({
        videoURL, nativeMuted, onNeedsMute: fallback,
        onResult: (result) => {
          if (result.status !== 'failed') return;
          const notice = document.createElement('div');
          notice.textContent = 'No se pudo iniciar el vídeo automáticamente. Pulsa Reproducir en esta pestaña.';
          notice.setAttribute('role', 'alert');
          notice.style.cssText = 'position:fixed;bottom:24px;left:24px;z-index:2147483647;'
            + 'max-width:440px;padding:12px 16px;border-radius:8px;background:#202124;'
            + 'color:#fff;font:14px/1.5 Arial,sans-serif;box-shadow:0 2px 10px #0005;';
          (document.body || document.documentElement)?.append(notice);
          setTimeout(() => notice.remove(), 15000);
        },
      });
    };
    // Do not wait forever for a manager that ignores GM_audio's callback.
    // No play() call happens until native mute is confirmed or DOM mute is set.
    const muteTimeout = setTimeout(() => beginPlayback(false), 500);

    try {
      if (typeof GM_audio !== 'undefined' && typeof GM_audio.setMute === 'function') {
        const result = GM_audio.setMute({ isMuted: true }, (error) => {
          if (error) fallback();
          beginPlayback(!error);
        });
        result?.catch?.(() => { fallback(); beginPlayback(false); });
        return;
      }
    } catch { /* Gestores sin soporte de silenciado de pestañas. */ }
    beginPlayback(false);
  }

  // Violentmonkey y otros gestores: silencia el vídeo sin cambiar su volumen.
  function startPlayerMuteFallback(videoURL) {
    let active = true;
    const mediaEvents = ['loadstart', 'play', 'volumechange'];
    const navigationEvents = ['yt-navigate-finish', 'yt-page-data-updated'];
    const isSameVideo = () => canonicalVideoURL(location.href) === videoURL;

    function stop() {
      if (!active) return;
      active = false;
      observer.disconnect();
      mediaEvents.forEach((type) => document.removeEventListener(type, onMedia, true));
      navigationEvents.forEach((type) => document.removeEventListener(type, onNavigation));
      document.removeEventListener('pointerdown', onVolumeControl, true);
      document.removeEventListener('keydown', onVolumeControl, true);
      window.removeEventListener('popstate', onNavigation);
    }

    function mute(video) {
      if (!active) return;
      if (!isSameVideo()) {
        stop();
        return;
      }
      if (video instanceof HTMLVideoElement && video.closest('#movie_player') && !video.muted) video.muted = true;
    }

    function collectVideo(node) {
      if (!(node instanceof Element)) return;
      if (node.matches('video')) mute(node);
      node.querySelectorAll('video').forEach(mute);
    }

    function onMedia(event) {
      mute(event.target);
    }

    function onNavigation() {
      if (!isSameVideo()) stop();
    }

    function onVolumeControl(event) {
      if (!event.isTrusted || !(event.target instanceof Element)) return;
      const target = event.target;
      const volumeControl = target.closest('.ytp-mute-button, .ytp-volume-panel');
      const muteShortcut = event.type === 'keydown' && event.key?.toLowerCase() === 'm'
        && !event.ctrlKey && !event.metaKey && !event.altKey
        && !target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]');
      // Libera el control antes de que YouTube procese el gesto de desmutear.
      if (volumeControl || muteShortcut) stop();
    }

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) collectVideo(node);
      }
    });
    observer.observe(document, { childList: true, subtree: true });
    mediaEvents.forEach((type) => document.addEventListener(type, onMedia, true));
    navigationEvents.forEach((type) => document.addEventListener(type, onNavigation));
    document.addEventListener('pointerdown', onVolumeControl, true);
    document.addEventListener('keydown', onVolumeControl, true);
    window.addEventListener('popstate', onNavigation);
    document.querySelectorAll('video').forEach(mute);
  }

  // BEGIN SHARED PLAYBACK — generated by scripts/sync_userscript.py
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
  // END SHARED PLAYBACK

  const CARD = 'ytd-rich-item-renderer, yt-lockup-view-model';
  const BUTTON = 'yt-chatgpt-open';
  const WATCH_BUTTON = 'yt-chatgpt-watch-action';
  const WATCH_ROOT = 'ytd-watch-metadata, #actions.ytd-watch-metadata';
  const WATCH_ACTIONS = 'ytd-watch-metadata #actions #top-level-buttons-computed, '
    + '#actions.ytd-watch-metadata #top-level-buttons-computed';
  const INLINE_HOST = 'yt-chatgpt-inline-metadata';
  const STYLE_ID = 'yt-chatgpt-open-style';
  const VIDEO_LINKS = [
    'a.ytLockupMetadataViewModelTitle[href]',
    'a.ytLockupViewModelContentImage[href]',
    'a#video-title-link[href]',
    'a#video-title[href]',
    'a#thumbnail[href]',
  ];

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .${INLINE_HOST} {
      display: grid !important;
      grid-template-columns: minmax(0, 1fr) max-content;
      column-gap: 8px;
      align-items: start;
      min-width: 0;
    }
    .${INLINE_HOST} > * {
      grid-column: 1;
      min-width: 0;
    }
    .${INLINE_HOST} > h3 {
      grid-column: 1 / -1;
      grid-row: 1;
    }
    a.${BUTTON} {
      grid-column: 2;
      grid-row: 2;
      display: inline-flex;
      align-items: center;
      align-self: flex-start;
      justify-content: center;
      box-sizing: border-box;
      width: max-content;
      max-width: 100%;
      min-height: 22px;
      margin: 0;
      padding: 2px 8px;
      border: 1px solid var(--yt-spec-10-percent-layer, #ddd);
      border-radius: 999px;
      background: var(--yt-spec-badge-chip-background, #f2f2f2);
      color: var(--yt-spec-text-primary, #0f0f0f);
      font: 500 12px/1.3 Roboto, Arial, sans-serif;
      text-decoration: none;
      white-space: nowrap;
      cursor: pointer;
    }
    a.${BUTTON}:hover {
      background: var(--yt-spec-mono-tonal-hover, #e5e5e5);
    }
    a.${BUTTON}:focus-visible {
      outline: 2px solid var(--yt-spec-call-to-action, #065fd4);
      outline-offset: 3px;
    }
    a.${BUTTON}.${WATCH_BUTTON} {
      grid-column: auto;
      grid-row: auto;
      align-self: center;
      flex: 0 0 auto;
      min-height: 36px;
      margin-inline-start: 8px;
      padding: 0 12px;
      font-size: 14px;
    }
    /* Comparte una sola fila con las acciones nativas y otros userscripts. */
    #actions.ytd-watch-metadata:has(a.${WATCH_BUTTON}) {
      min-width: 0 !important;
      max-width: 100%;
    }
    #actions.ytd-watch-metadata #actions-inner:has(a.${WATCH_BUTTON}) {
      display: flex !important;
      flex-flow: row nowrap !important;
      align-items: center;
      justify-content: flex-start !important;
      gap: 8px;
      min-width: 0;
      max-width: 100%;
      overflow-x: auto;
      scrollbar-width: thin;
    }
    #actions.ytd-watch-metadata #actions-inner:has(a.${WATCH_BUTTON}) > * {
      flex: 0 0 auto !important;
    }
    #actions.ytd-watch-metadata #actions-inner:has(a.${WATCH_BUTTON}) > #menu {
      min-width: max-content !important;
      max-width: none !important;
    }
  `;
  // Un lockup dentro de una tarjeta rich comparte su mismo botón.
  function getCardRoot(node) {
    if (!(node instanceof Element)) return null;
    const card = node.closest(CARD);
    return card?.closest('ytd-rich-item-renderer') || card;
  }

  function canonicalVideoURL(value) {
    if (!value) return null;
    try {
      const url = new URL(value, location.origin);
      if (!['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(url.hostname)) return null;
      const id = url.pathname === '/watch' ? url.searchParams.get('v') : null;
      if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) {
        return `https://www.youtube.com/watch?v=${id}`;
      }
    } catch { /* Ignora enlaces incompletos mientras se carga la página. */ }
    return null;
  }

  function getVideoURL(card) {
    if (!card) return null;
    for (const selector of VIDEO_LINKS) {
      const source = card.querySelector(selector);
      const videoURL = canonicalVideoURL(source?.getAttribute('href'));
      if (videoURL) return videoURL;
    }
    return null;
  }

  function getCurrentVideoURL() {
    return canonicalVideoURL(location.href);
  }

  function setDestination(link, videoURL) {
    const prompt = `Resume ${videoURL}`;
    const destination = `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`;
    if (link.getAttribute('href') !== destination) link.href = destination;
  }

  function requestTabGroup(link, videoURL, title) {
    const requestId = crypto.randomUUID();
    const requestAttribute = 'data-yt-chatgpt-group-request';
    const acceptedAttribute = 'data-yt-chatgpt-group-accepted';
    link.removeAttribute(acceptedAttribute);
    link.setAttribute(requestAttribute, JSON.stringify({ requestId, videoURL, title }));
    try {
      // Atributos de texto para compartir el mensaje entre los entornos aislados.
      // El complemento solo acepta una solicitud por activación real del usuario.
      link.dispatchEvent(new Event('yt-chatgpt-open-group', { bubbles: true }));
      return link.getAttribute(acceptedAttribute) === requestId;
    } finally {
      link.removeAttribute(requestAttribute);
      link.removeAttribute(acceptedAttribute);
    }
  }

  function removeLink(link) {
    link.parentElement?.classList.remove(INLINE_HOST);
    link.remove();
  }

  function createLink(isWatch = false) {
    const link = document.createElement('a');
    link.className = BUTTON;
    if (isWatch) link.classList.add(WATCH_BUTTON);
    link.textContent = 'ChatGPT ↗';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = 'Reproducir vídeo silenciado y abrir ChatGPT (en un grupo con el complemento instalado)';
    link.setAttribute('aria-label', link.title);

    // Relee la URL al pulsar: la tarjeta o la página pueden cambiar de vídeo.
    const refresh = (event) => {
      event.stopPropagation();
      const videoURL = isWatch
        ? getCurrentVideoURL()
        : getVideoURL(getCardRoot(link));
      if (videoURL) {
        setDestination(link, videoURL);
      } else {
        event.preventDefault();
        removeLink(link);
      }
      return videoURL;
    };
    for (const type of ['pointerdown', 'contextmenu']) {
      link.addEventListener(type, refresh);
    }

    const activate = (event) => {
      const videoURL = refresh(event);
      const primaryClick = event.type === 'click' && event.button === 0;
      const middleClick = event.type === 'auxclick' && event.button === 1;
      if (!videoURL || (!primaryClick && !middleClick)) return;

      event.preventDefault();
      const mutedURL = new URL(videoURL);
      mutedURL.searchParams.set(MUTE_FLAG, '1');
      const background = middleClick || event.ctrlKey || event.metaKey;
      const heading = isWatch
        ? document.querySelector('ytd-watch-metadata h1')
        : getCardRoot(link)?.querySelector('h3');
      const title = (heading?.textContent || 'YouTube + ChatGPT')
        .replace(/\s+/g, ' ').trim().slice(0, 120);
      if (requestTabGroup(link, videoURL, title)) return;
      GM_openInTab(mutedURL.href, { active: false, insert: true });
      GM_openInTab(link.href, { active: !background, insert: true });
    };
    link.addEventListener('click', activate);
    link.addEventListener('auxclick', activate);
    return link;
  }

  function updateCard(card) {
    if (!card.isConnected) return;
    let link = card.querySelector(`a.${BUTTON}:not(.${WATCH_BUTTON})`);
    const videoURL = getVideoURL(card);
    // Conserva el título a todo el ancho y comparte la fila de metadatos.
    const container = [
      card.querySelector('.ytLockupMetadataViewModelTextContainer'),
      card.querySelector('#meta'),
      card.querySelector('#details'),
    ].find((node) => node?.querySelector(':scope > h3') && node.querySelector(
      ':scope > .ytLockupMetadataViewModelMetadata, :scope > ytd-video-meta-block, '
      + ':scope > #metadata, :scope > #metadata-line'
    ));

    if (!videoURL || !container) {
      card.querySelectorAll(`.${INLINE_HOST}`).forEach((node) => {
        node.classList.remove(INLINE_HOST);
      });
      link?.remove();
      return;
    }

    if (!link) link = createLink();

    setDestination(link, videoURL);
    if (link.parentElement !== container) {
      link.parentElement?.classList.remove(INLINE_HOST);
      container.append(link);
    }
    container.classList.add(INLINE_HOST);
  }

  function updateWatchButton() {
    const videoURL = getCurrentVideoURL();
    const container = [...document.querySelectorAll(WATCH_ACTIONS)]
      .find((node) => !node.closest('[hidden]'));
    const links = [...document.querySelectorAll(`a.${WATCH_BUTTON}`)];

    if (!videoURL || !container) {
      links.forEach(removeLink);
      return;
    }

    // Solo una acción, incluso si YouTube conserva barras antiguas en el DOM.
    const link = links.find((node) => node.parentElement === container)
      || links[0] || createLink(true);
    links.filter((node) => node !== link).forEach(removeLink);
    setDestination(link, videoURL);
    if (link.parentElement !== container) container.append(link);
  }

  const pending = new Set();
  let pendingWatch = false;
  let scheduled = false;

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const cards = [...pending];
      const refreshWatch = pendingWatch;
      pending.clear();
      pendingWatch = false;
      cards.forEach(updateCard);
      if (refreshWatch) updateWatchButton();
    });
  }

  function queue(node) {
    const card = getCardRoot(node);
    if (!card || !card.isConnected) return;
    pending.add(card);
    schedule();
  }

  function queueWatch() {
    pendingWatch = true;
    schedule();
  }

  function collect(node) {
    if (!(node instanceof Element) || node.closest(`a.${BUTTON}`)) return;
    const card = getCardRoot(node);
    if (card) queue(card);
    else node.querySelectorAll(CARD).forEach(queue);
    if (node.closest(WATCH_ROOT) || node.querySelector(WATCH_ROOT)) queueWatch();
  }

  // Procesa las tarjetas afectadas, sin sondeos periódicos de toda la página.
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      const target = mutation.target;
      if (!(target instanceof Element) || target.closest(`a.${BUTTON}`)) continue;
      queue(target);
      if (target.closest(WATCH_ROOT)
        || (mutation.attributeName === 'hidden' && target.querySelector(WATCH_ROOT))) {
        queueWatch();
      }
      for (const node of mutation.addedNodes) collect(node);
    }
  });
  const scan = () => {
    document.querySelectorAll(CARD).forEach(queue);
    queueWatch();
  };
  function startUI() {
    if (document.getElementById(STYLE_ID)) return;
    (document.head || document.documentElement).append(style);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href', 'hidden'],
    });
    document.addEventListener('yt-navigate-finish', scan);
    document.addEventListener('yt-page-data-updated', queueWatch);
    window.addEventListener('popstate', queueWatch);
    scan();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startUI, { once: true });
  } else {
    startUI();
  }
})();


