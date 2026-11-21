export const CHANNEL = 'yt-chatgpt-groups';
export const REQUEST_TYPE = 'OPEN_GROUP';
export const PLAYBACK_FLAG = 'yt_chatgpt_group_play';

const ORIGINS = new Set(['https://www.youtube.com', 'https://youtube.com']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VIDEO_URL = /^https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})$/;
const isId = (value) => Number.isInteger(value) && value >= 0;

export function validateGroupRequest(message, sender, extensionId) {
  let origin;
  try { origin = new URL(sender?.url).origin; } catch { /* Invalid sender. */ }
  if (!extensionId || sender?.id !== extensionId || sender.frameId !== 0
    || !ORIGINS.has(origin) || !isId(sender.tab?.id) || !isId(sender.tab?.windowId)) {
    throw new Error('Solo se admiten solicitudes de la página principal de YouTube.');
  }
  if (message?.channel !== CHANNEL || message.type !== REQUEST_TYPE
    || typeof message.requestId !== 'string' || !UUID.test(message.requestId)
    || typeof message.videoURL !== 'string' || !VIDEO_URL.test(message.videoURL)
    || typeof message.title !== 'string' || message.title.length > 120
    || typeof message.background !== 'boolean') {
    throw new Error('La solicitud de grupo no es válida.');
  }

  // Rebuild both destinations; a page cannot supply an arbitrary target URL.
  const videoId = message.videoURL.match(VIDEO_URL)[1];
  const videoURL = `https://www.youtube.com/watch?v=${videoId}`;
  return {
    requestId: message.requestId,
    videoURL,
    chatgptURL: `https://chatgpt.com/?q=${encodeURIComponent(`Resume ${videoURL}`)}`,
    title: message.title.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
      || 'YouTube + ChatGPT',
    background: message.background,
    sourceTabId: sender.tab.id,
    windowId: sender.tab.windowId,
  };
}

async function removeOwnBlankTabs(api, created, navigationStarted) {
  if (typeof api.tabs.get !== 'function' || typeof api.tabs.remove !== 'function') return;
  for (const id of created) {
    if (navigationStarted.has(id)) continue;
    try {
      const tab = await api.tabs.get(id);
      // Without broad "tabs" permission the URL may be omitted. Preserve unknown
      // or user-navigated tabs rather than risk closing something the user opened.
      if (tab.url === 'about:blank' && (!tab.pendingUrl || tab.pendingUrl === 'about:blank')) {
        await api.tabs.remove(id);
      }
    } catch { /* The user may have closed this new tab already. */ }
  }
}

async function openGroup(api, request, preparePlayback) {
  const created = [];
  const navigationStarted = new Set();
  const createBlank = async () => {
    const tab = await api.tabs.create({
      url: 'about:blank', active: false, windowId: request.windowId,
      openerTabId: request.sourceTabId,
    });
    if (!isId(tab?.id)) throw new Error('El navegador no devolvió la pestaña creada.');
    created.push(tab.id);
    return tab.id;
  };

  try {
    const videoTabId = await createBlank();
    await api.tabs.update(videoTabId, { muted: true });
    const chatgptTabId = await createBlank();
    // Omitting groupId deliberately creates a new native group for this request.
    const groupId = await api.tabs.group({
      tabIds: [videoTabId, chatgptTabId], createProperties: { windowId: request.windowId },
    });
    if (!isId(groupId)) throw new Error('El navegador no devolvió el grupo creado.');
    await api.tabGroups.update(groupId, { title: request.title, color: 'blue', collapsed: false });

    await preparePlayback({
      requestId: request.requestId, videoURL: request.videoURL,
      videoTabId, chatgptTabId, groupId, windowId: request.windowId,
      focusChat: !request.background,
    });

    // Mute and grouping are complete before either destination starts loading.
    // Mark navigation before the API call: a rejected update can be ambiguous.
    navigationStarted.add(chatgptTabId);
    await api.tabs.update(chatgptTabId, { url: request.chatgptURL, active: false });
    const playbackURL = new URL(request.videoURL);
    playbackURL.searchParams.set(PLAYBACK_FLAG, request.requestId);
    navigationStarted.add(videoTabId);
    // A normal click shows the muted video until playback is confirmed. The
    // playback manager then selects ChatGPT; modified clicks stay background.
    await api.tabs.update(videoTabId, { url: playbackURL.href, active: !request.background });
    return { groupId, videoTabId, chatgptTabId };
  } catch (error) {
    await removeOwnBlankTabs(api, created, navigationStarted);
    throw error;
  }
}

export function createGroupHandler(api, {
  now = () => Date.now(), ttlMs = 60000, maxRequests = 100, preparePlayback = async () => {},
} = {}) {
  if (!Number.isFinite(ttlMs) || ttlMs < 0 || !Number.isInteger(maxRequests) || maxRequests < 1) {
    throw new Error('Invalid request-cache limits.');
  }
  // Bounded, worker-local deduplication also caches failures. Neither the bridge
  // nor the worker retries an accepted action. Pending entries are never evicted.
  const requests = new Map();
  return function handle(message, sender) {
    try {
      const request = validateGroupRequest(message, sender, api.runtime?.id);
      if (typeof api.tabs?.create !== 'function' || typeof api.tabs.update !== 'function'
        || typeof api.tabs.group !== 'function' || typeof api.tabGroups?.update !== 'function') {
        throw new Error('Este navegador no ofrece la API necesaria para agrupar pestañas.');
      }
      for (const [key, entry] of requests) {
        if (entry.settled && entry.expiresAt <= now()) requests.delete(key);
      }
      const key = `${request.sourceTabId}:${request.requestId}`;
      const signature = JSON.stringify([request.videoURL, request.title, request.background, request.windowId]);
      const previous = requests.get(key);
      if (previous) {
        if (previous.signature !== signature) throw new Error('El identificador ya pertenece a otra solicitud.');
        return previous.promise;
      }
      if (requests.size >= maxRequests) {
        throw new Error('Hay demasiadas solicitudes recientes. Espera un momento antes de abrir otro grupo.');
      }
      const entry = { signature, settled: false, expiresAt: Infinity, promise: null };
      entry.promise = openGroup(api, request, preparePlayback).then(
        (result) => { entry.settled = true; entry.expiresAt = now() + ttlMs; return result; },
        (error) => { entry.settled = true; entry.expiresAt = now() + ttlMs; throw error; },
      );
      requests.set(key, entry);
      return entry.promise;
    } catch (error) {
      return Promise.reject(error);
    }
  };
}
