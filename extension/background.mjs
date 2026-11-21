import { CHANNEL, REQUEST_TYPE, createGroupHandler } from './groups.mjs';

const handle = createGroupHandler(chrome);

// This is an internal content-script channel, never an external extension API.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.channel !== CHANNEL || message.type !== REQUEST_TYPE) return;
  handle(message, sender).then(
    (value) => respond({ ok: true, value }),
    (error) => respond({ ok: false, error: error?.message || String(error) }),
  );
  return true;
});
