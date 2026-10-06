// Host LLM được xin lúc runtime (optional_host_permissions) thay vì khai báo <all_urls>.
// Match pattern bỏ qua port nên http://localhost:11434 -> "http://localhost/*".
export function originPattern(endpoint) {
  const url = new URL(endpoint);
  return `${url.protocol}//${url.hostname}/*`;
}

export function hasOriginPermission(endpoint) {
  return chrome.permissions.contains({ origins: [originPattern(endpoint)] });
}

// Phải gọi trực tiếp trong handler của thao tác người dùng (click), trước mọi await.
export function requestOriginPermission(endpoint) {
  return chrome.permissions.request({ origins: [originPattern(endpoint)] });
}
