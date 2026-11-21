import { CHANNEL } from './groups.mjs';

export const PLAYBACK_READY = 'PLAYBACK_READY';
export const PLAYBACK_STATUS = 'PLAYBACK_STATUS';
const PREFIX = 'yt-chatgpt-playback:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VIDEO_URL = /^https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})$/;

// Session storage survives service-worker suspension, without exposing this
// temporary tab mapping to page scripts or syncing it to another browser.
export function createPlaybackManager(api, { now = () => Date.now() } = {}) {
  let queue = Promise.resolve();
  const serial = (action) => {
    const result = queue.then(action);
    queue = result.catch(() => {});
    return result;
  };
  const storage = () => {
    if (!api.storage?.session) throw new Error('El complemento necesita el permiso storage.');
    return api.storage.session;
  };
  async function records() {
    const entries = Object.entries(await storage().get(null))
      .filter(([key]) => key.startsWith(PREFIX));
    const expired = entries.filter(([, value]) => value.expiresAt <= now()).map(([key]) => key);
    if (expired.length) await storage().remove(expired);
    return entries.filter(([, value]) => value.expiresAt > now());
  }

  const prepare = (record) => serial(async () => {
    if ((await records()).length >= 100) throw new Error('Hay demasiados vídeos pendientes de iniciar.');
    await storage().set({
      [PREFIX + record.videoTabId]: { ...record, started: false, expiresAt: now() + 120000 },
    });
  });

  function validate(message, sender) {
    let url;
    try { url = new URL(sender?.url); } catch { /* Rejected below. */ }
    if (sender?.id !== api.runtime?.id || !api.runtime?.id || sender.frameId !== 0
      || !Number.isInteger(sender.tab?.id) || sender.tab.id < 0
      || !Number.isInteger(sender.tab.windowId) || sender.tab.windowId < 0
      || !url || !['https://www.youtube.com', 'https://youtube.com'].includes(url.origin)
      || url.pathname !== '/watch' || message?.channel !== CHANNEL
      || ![PLAYBACK_READY, PLAYBACK_STATUS].includes(message.type)
      || typeof message.requestId !== 'string' || !UUID.test(message.requestId)
      || typeof message.videoURL !== 'string' || !VIDEO_URL.test(message.videoURL)
      || url.searchParams.get('v') !== message.videoURL.match(VIDEO_URL)[1]
      || (message.type === PLAYBACK_STATUS && !['playing', 'failed', 'cancelled'].includes(message.status))) {
      throw new Error('La confirmación de reproducción no es válida.');
    }
  }

  const handle = (message, sender) => serial(async () => {
    validate(message, sender);
    const key = PREFIX + sender.tab.id;
    const record = (await records()).find(([name]) => name === key)?.[1];
    if (!record || record.requestId !== message.requestId || record.videoURL !== message.videoURL
      || record.windowId !== sender.tab.windowId) {
      throw new Error('Esta pestaña no tiene un arranque de vídeo pendiente.');
    }

    if (message.type === PLAYBACK_READY) {
      if (record.started) throw new Error('El arranque de este vídeo ya está en curso.');
      const video = await api.tabs.get(record.videoTabId);
      if (video.groupId !== record.groupId || video.windowId !== record.windowId) {
        await storage().remove(key);
        throw new Error('El vídeo ya no está en el grupo creado.');
      }
      await storage().set({ [key]: { ...record, started: true } });
      return { nativeMuted: video.mutedInfo?.muted === true };
    }

    if (!record.started) throw new Error('El vídeo todavía no ha solicitado iniciar la reproducción.');
    await storage().remove(key);
    if (message.status !== 'playing' || !record.focusChat) return { focused: false };

    try {
      const [video, chat] = await Promise.all([
        api.tabs.get(record.videoTabId), api.tabs.get(record.chatgptTabId),
      ]);
      // Never take focus back after the user selects another tab, moves the
      // pair elsewhere, closes one, or explicitly requests background tabs.
      if (!video.active || video.windowId !== record.windowId || chat.windowId !== record.windowId
        || video.groupId !== record.groupId || chat.groupId !== record.groupId) {
        return { focused: false };
      }
      await api.tabs.update(record.chatgptTabId, { active: true });
      return { focused: true };
    } catch { return { focused: false }; }
  });

  const onActivated = (info) => serial(async () => {
    const changed = {};
    for (const [key, record] of await records()) {
      if (record.focusChat && record.windowId === info.windowId && record.videoTabId !== info.tabId) {
        changed[key] = { ...record, focusChat: false };
      }
    }
    if (Object.keys(changed).length) await storage().set(changed);
  });

  const onRemoved = (tabId) => serial(async () => {
    const keys = (await records()).filter(([, record]) =>
      record.videoTabId === tabId || record.chatgptTabId === tabId).map(([key]) => key);
    if (keys.length) await storage().remove(keys);
  });

  return { prepare, handle, onActivated, onRemoved };
}
