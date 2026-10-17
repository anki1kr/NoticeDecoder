// Right-click a selected notice -> "Decode with Notice Decoder". The text is parked in session storage and the popup
// (which does the work) opens on it. Nothing is sent anywhere.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'nd-decode', title: 'Decode with Notice Decoder', contexts: ['selection'] });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== 'nd-decode' || !info.selectionText) return;
  await chrome.storage.session.set({ pending: info.selectionText });
  try {
    await chrome.action.openPopup();
  } catch {
    // Popup could not open from here: leave a badge, the text waits for the next toolbar click.
    chrome.action.setBadgeText({ text: '1' });
  }
});
