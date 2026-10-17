# Notice Decoder: Chrome extension

Select a notice on any page (Gmail, a college portal, WhatsApp Web), click the toolbar icon or right-click ->
**Decode with Notice Decoder**. The popup shows the events, the clashes and a **Download .ics** button. It runs the same
rules engine as the web app (`engine.js` is `dist/notice-engine.js`), on your device; nothing is uploaded.

Review rule kept: if any field is amber (uncertain), the .ics button and the Google Calendar links stay locked and
**Fix amber fields in the app** opens the web app on that notice.

## Install (unpacked, for judges)

1. Open `chrome://extensions`, switch on **Developer mode**.
2. **Load unpacked** -> pick this `extension/` folder.
3. Select any notice text on a page and click the Notice Decoder icon.

## After changing the engine

```bash
node tools/bundle-engine.mjs && node tools/sync-extension.mjs
```

Permissions: `activeTab` + `scripting` (read the text you selected, only when you click), `contextMenus`, `storage`
(session only, to hand the right-click text to the popup). No host permissions, no network calls.
