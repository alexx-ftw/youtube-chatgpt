(() => {
  'use strict';
  if (globalThis.__ytChatgptGroupsBridge) return;
  globalThis.__ytChatgptGroupsBridge = true;

  const BUTTON = 'a.yt-chatgpt-open';
  const REQUEST_ATTR = 'data-yt-chatgpt-group-request';
  const ACCEPTED_ATTR = 'data-yt-chatgpt-group-accepted';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const VIDEO_URL = /^https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})$/;
  const authorized = new WeakMap();
  let notice, noticeTimer;

  // Capture the real click before the userscript's target listener runs. A DOM
  // request is allowed once, for this exact anchor, for at most one second.
  function authorize(event) {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const primary = event.type === 'click' && event.button === 0;
    const middle = event.type === 'auxclick' && event.button === 1;
    if (!primary && !middle) return;
    const anchor = event.target.closest(BUTTON);
    if (!anchor) return;
    authorized.set(anchor, {
      expiresAt: Date.now() + 1000,
      background: middle || event.ctrlKey || event.metaKey,
    });
  }

  function showError(error) {
    clearTimeout(noticeTimer);
    if (!notice?.isConnected) {
      notice = document.createElement('div');
      notice.setAttribute('role', 'alert');
      notice.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;'
        + 'max-width:min(460px,calc(100vw - 40px));box-sizing:border-box;padding:14px 18px;'
        + 'border-radius:12px;background:#292929;color:#fff;box-shadow:0 4px 18px #0006;'
        + 'font:14px/1.45 Arial,sans-serif;white-space:pre-wrap;';
      (document.body || document.documentElement).append(notice);
    }
    const explanation = String(error?.message || error || 'No se recibió respuesta del complemento.').slice(0, 400);
    notice.textContent = `No se pudo completar el grupo de pestañas: ${explanation}`;
    noticeTimer = setTimeout(() => notice?.remove(), 10000);
  }

  document.addEventListener('click', authorize, true);
  document.addEventListener('auxclick', authorize, true);
  document.addEventListener('yt-chatgpt-open-group', (event) => {
    const anchor = event.target;
    if (!(anchor instanceof Element) || !anchor.matches(BUTTON)) return;
    const authorization = authorized.get(anchor);
    authorized.delete(anchor);
    if (!authorization || authorization.expiresAt < Date.now()) return;

    let request;
    try {
      const raw = anchor.getAttribute(REQUEST_ATTR);
      if (!raw || raw.length > 1024) return;
      request = JSON.parse(raw);
      if (!request || typeof request.requestId !== 'string' || !UUID.test(request.requestId)
        || typeof request.videoURL !== 'string' || !VIDEO_URL.test(request.videoURL)
        || typeof request.title !== 'string' || request.title.length > 120) return;
    } catch { return; }

    // Another installed copy can share this DOM while using a different world.
    if (anchor.getAttribute(ACCEPTED_ATTR) === request.requestId) return;

    // Synchronous acknowledgement is the contract with the userscript. It clears
    // these attributes immediately after dispatchEvent returns. After acceptance,
    // never fall back or retry: a late error must not open a second pair of tabs.
    anchor.setAttribute(ACCEPTED_ATTR, request.requestId);
    const message = {
      channel: 'yt-chatgpt-groups', type: 'OPEN_GROUP',
      requestId: request.requestId, videoURL: request.videoURL, title: request.title,
      background: Boolean(authorization.background),
    };
    try {
      Promise.resolve(chrome.runtime.sendMessage(message)).then((response) => {
        if (!response?.ok) showError(response?.error);
      }, showError);
    } catch (error) {
      showError(error);
    }
  }, true);
})();
