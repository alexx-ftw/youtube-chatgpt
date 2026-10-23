// ==UserScript==
// @name         YouTube: abrir vídeo en ChatGPT
// @namespace    eros.youtube.chatgpt
// @version      1.0.2
// @description  Añade un botón que abre ChatGPT con la URL del vídeo en el parámetro q.
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

  const CARD = 'ytd-rich-item-renderer';
  const BUTTON = 'yt-chatgpt-open';
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
  `;
  (document.head || document.documentElement).append(style);

  function getVideoURL(card) {
    for (const selector of VIDEO_LINKS) {
      const source = card.querySelector(selector);
      if (!source) continue;
      try {
        const url = new URL(source.getAttribute('href'), location.origin);
        if (!['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(url.hostname)) continue;
        const id = url.pathname === '/watch' ? url.searchParams.get('v') : null;
        if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) {
          return `https://www.youtube.com/watch?v=${id}`;
        }
      } catch { /* Ignora enlaces incompletos mientras se carga la tarjeta. */ }
    }
    return null;
  }

  function setDestination(link, videoURL) {
    const destination = `https://chatgpt.com/?q=${encodeURIComponent(videoURL)}`;
    if (link.getAttribute('href') !== destination) link.href = destination;
  }

  function updateCard(card) {
    if (!card.isConnected) return;
    let link = card.querySelector(`a.${BUTTON}`);
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

    if (!link) {
      link = document.createElement('a');
      link.className = BUTTON;
      link.textContent = 'ChatGPT ↗';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.title = 'Abrir URL del vídeo en ChatGPT (nueva pestaña)';
      link.setAttribute('aria-label', link.title);

      // Lee la URL actual también al pulsar, por si YouTube recicla la tarjeta.
      const refresh = (event) => {
        event.stopPropagation();
        const currentURL = getVideoURL(card);
        if (currentURL) {
          setDestination(link, currentURL);
        } else {
          event.preventDefault();
          link.parentElement?.classList.remove(INLINE_HOST);
          link.remove();
        }
      };
      for (const type of ['pointerdown', 'click', 'auxclick', 'contextmenu']) {
        link.addEventListener(type, refresh);
      }
    }

    setDestination(link, videoURL);
    if (link.parentElement !== container) {
      link.parentElement?.classList.remove(INLINE_HOST);
      container.append(link);
    }
    container.classList.add(INLINE_HOST);
  }

  const pending = new Set();
  let scheduled = false;

  function queue(card) {
    if (!card || !card.isConnected) return;
    pending.add(card);
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const cards = [...pending];
      pending.clear();
      cards.forEach(updateCard);
    });
  }

  function collect(node) {
    if (!(node instanceof Element) || node.closest(`a.${BUTTON}`)) return;
    const card = node.closest(CARD);
    if (card) queue(card);
    else node.querySelectorAll(CARD).forEach(queue);
  }

  // Procesa las tarjetas afectadas, sin sondeos periódicos de toda la página.
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      const target = mutation.target;
      if (!(target instanceof Element) || target.closest(`a.${BUTTON}`)) continue;
      queue(target.closest(CARD));
      for (const node of mutation.addedNodes) collect(node);
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['href'],
  });

  const scan = () => document.querySelectorAll(CARD).forEach(queue);
  document.addEventListener('yt-navigate-finish', scan);
  scan();
})();
