import { CHANNEL, REQUEST_TYPE, createGroupHandler } from './groups.mjs';
import { PLAYBACK_READY, PLAYBACK_STATUS, createPlaybackManager } from './playback-session.mjs';

const playback = createPlaybackManager(chrome);
const handle = createGroupHandler(chrome, { preparePlayback: playback.prepare });

chrome.tabs.onActivated.addListener((info) => { playback.onActivated(info).catch(console.warn); });
chrome.tabs.onRemoved.addListener((tabId) => { playback.onRemoved(tabId).catch(console.warn); });

// This is an internal content-script channel, never an external extension API.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.channel !== CHANNEL) return;
  const handler = message.type === REQUEST_TYPE ? handle
    : [PLAYBACK_READY, PLAYBACK_STATUS].includes(message.type) ? playback.handle : null;
  if (!handler) return;
  handler(message, sender).then(
    (value) => respond({ ok: true, value }),
    (error) => respond({ ok: false, error: error?.message || String(error) }),
  );
  return true;
});
