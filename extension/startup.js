(() => {
  'use strict';

  const CHANNEL = 'yt-chatgpt-groups';
  const MARKER = 'yt_chatgpt_group_play';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const STARTED = '__ytChatGPTPlaybackStartup';
  const FAILURE = 'No se pudo iniciar el vídeo automáticamente. Pulsa Reproducir en esta pestaña.';
  const REPORT_FAILURE = 'El vídeo está reproduciéndose. Abre la pestaña de ChatGPT del grupo.';

  function canonicalVideoURL(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || !['www.youtube.com', 'youtube.com'].includes(url.hostname)
        || url.pathname !== '/watch') return null;
      const id = url.searchParams.get('v');
      return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? `https://www.youtube.com/watch?v=${id}` : null;
    } catch { return null; }
  }

  const url = new URL(location.href);
  const videoURL = canonicalVideoURL(url.href);
  const requestId = url.searchParams.get(MARKER);
  if (!videoURL || !UUID.test(requestId || '') || globalThis[STARTED]) return;
  globalThis[STARTED] = true;

  // Consume only our marker. The userscript has a separate marker for its fallback.
  url.searchParams.delete(MARKER);
  try { history.replaceState(history.state, '', url.href); } catch { /* Playback can continue. */ }

  const isSameVideo = () => canonicalVideoURL(location.href) === videoURL;
  let settled = false;

  function showNotice(message = FAILURE) {
    const mount = () => {
      if (!isSameVideo()) return;
      const parent = document.body || document.documentElement;
      if (!parent) {
        document.addEventListener('DOMContentLoaded', mount, { once: true });
        return;
      }
      const notice = document.createElement('div');
      notice.setAttribute('role', 'alert');
      notice.textContent = message;
      notice.style.cssText = 'position:fixed;bottom:24px;left:24px;right:24px;max-width:540px;'
        + 'padding:14px 18px;border-radius:10px;background:#202124;color:#fff;'
        + 'font:14px/1.5 Arial,sans-serif;box-shadow:0 4px 20px #0005;z-index:2147483647;';
      parent.append(notice);
      setTimeout(() => notice.remove(), 15000);
    };
    mount();
  }

  function reportResult(result) {
    if (settled || !['playing', 'failed', 'cancelled'].includes(result?.status)) return;
    settled = true;
    if (result.status === 'failed') showNotice();
    const reportFailed = () => {
      if (result.status === 'playing') showNotice(REPORT_FAILURE);
    };
    // Reporting failure must never open another tab or restart the player.
    try {
      Promise.resolve(chrome.runtime.sendMessage({
        channel: CHANNEL, type: 'PLAYBACK_STATUS', requestId, videoURL, status: result.status,
      })).then((reply) => {
        if (reply?.ok !== true) reportFailed();
      }).catch(reportFailed);
    } catch { reportFailed(); /* The extension may have been reloaded. */ }
  }

  async function start() {
    let timer;
    let reply;
    try {
      reply = await Promise.race([
        chrome.runtime.sendMessage({ channel: CHANNEL, type: 'PLAYBACK_READY', requestId, videoURL }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Playback authorization timed out.')), 10000);
        }),
      ]);
    } catch { /* The failure notice below also covers unavailable extension workers. */ }
    finally { clearTimeout(timer); }

    if (reply?.ok !== true || typeof reply.value?.nativeMuted !== 'boolean') {
      settled = true;
      showNotice();
      return;
    }
    if (!isSameVideo()) {
      reportResult({ status: 'cancelled' });
      return;
    }
    try {
      startYouTubePlayback({ videoURL, nativeMuted: reply.value.nativeMuted, onResult: reportResult });
    } catch { reportResult({ status: 'failed' }); }
  }

  // A marker alone cannot authorize playback: the worker verifies the created tab.
  void start().catch(() => {
    if (!settled) {
      settled = true;
      showNotice();
    }
  });
})();
