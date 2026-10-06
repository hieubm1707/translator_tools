// Bật/tắt Translate All cho một tab: hỏi trạng thái ở frame chính rồi báo cho mọi frame (kể cả iframe nhúng).
export async function toggleTranslateAll(tabId) {
  const state = await chrome.tabs.sendMessage(tabId, { type: 'TRANSLATE_ALL_STATE' }, { frameId: 0 });
  const on = !state?.on;
  await chrome.tabs.sendMessage(tabId, { type: 'TRANSLATE_ALL_SET', on });
  return { on };
}
