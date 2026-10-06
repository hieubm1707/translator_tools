// Bật/tắt khung dịch của một tab. Khung nằm ở frame chính (frameId 0); khi tắt thì báo cho mọi frame
// (kể cả iframe nhúng) để gỡ trạng thái hover/highlight.
export async function toggleSplit(tabId) {
  const res = await chrome.tabs.sendMessage(tabId, { type: 'SPLIT_TOGGLE', tabId }, { frameId: 0 });
  if (!res?.open) await chrome.tabs.sendMessage(tabId, { type: 'SPLIT_CLOSE' }).catch(() => {});
  return res;
}
