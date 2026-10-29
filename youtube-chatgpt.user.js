// ==UserScript==
// @name         YouTube: abrir vídeo en ChatGPT
// @namespace    eros.youtube.chatgpt
// @version      1.0.4
// @description  Botón ChatGPT en tarjetas y junto a Compartir: abre «Resume» seguido de la URL del vídeo.
// @homepageURL  https://github.com/alexx-ftw/youtube-chatgpt
// @supportURL   https://github.com/alexx-ftw/youtube-chatgpt/issues
// @updateURL    https://raw.githubusercontent.com/alexx-ftw/youtube-chatgpt/main/youtube-chatgpt.user.js
// @downloadURL  https://raw.githubusercontent.com/alexx-ftw/youtube-chatgpt/main/youtube-chatgpt.user.js
// @match        https://www.youtube.com/*
// @match        https://youtube.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  'use strict';

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

  if (document.getElementById(STYLE_ID)) return;

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
  `;
  (document.head || document.documentElement).append(style);

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
    link.title = 'Resumir vídeo en ChatGPT (nueva pestaña)';
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
    };
    for (const type of ['pointerdown', 'click', 'auxclick', 'contextmenu']) {
      link.addEventListener(type, refresh);
    }
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
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['href', 'hidden'],
  });

  const scan = () => {
    document.querySelectorAll(CARD).forEach(queue);
    queueWatch();
  };
  document.addEventListener('yt-navigate-finish', scan);
  document.addEventListener('yt-page-data-updated', queueWatch);
  window.addEventListener('popstate', queueWatch);
  scan();
})();

