// Bộ nhớ bản dịch lâu dài (IndexedDB của extension, dùng chung cho service worker và trang Cài đặt).
// Khoá = SHA-256(URL trang + nguồn bản dịch + cặp ngôn ngữ + nội dung đoạn): mỗi trang có bản dịch riêng;
// đoạn nào đổi chữ thì có hash mới và được dịch lại; đoạn không đổi lấy thẳng từ đây, không gọi API.
// Bản ghi hết hạn sau N ngày kể từ lúc tạo (cài đặt cacheTtlDays): khi đọc coi như chưa có, và được
// service worker xoá hẳn định kỳ (chrome.alarms).
const DB_NAME = 'translator-tool';
const STORE = 'translations';
const MAX_ENTRIES = 200000; // vượt thì xoá bớt bản cũ nhất

let dbPromise;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: 'hash' });
      store.createIndex('createdAt', 'createdAt');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

const encoder = new TextEncoder();
export async function hashKey(site, cacheId, sourceLang, targetLang, text) {
  const data = encoder.encode([site, cacheId, sourceLang, targetLang, text].join('\u0000'));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// -> Map(hash -> entry) cho các hash đã có và chưa hết hạn
export async function getMany(hashes, { maxAgeMs = Infinity } = {}) {
  const tx = (await db()).transaction(STORE, 'readonly');
  const store = tx.objectStore(STORE);
  const found = new Map();
  const minCreatedAt = Date.now() - maxAgeMs;
  for (const hash of new Set(hashes)) {
    store.get(hash).onsuccess = (e) => {
      const entry = e.target.result;
      if (entry && entry.createdAt >= minCreatedAt) found.set(hash, entry);
    };
  }
  await done(tx);
  return found;
}

// entries: [{ hash, site, engine, sourceLang, targetLang, source, translation, transliteration?, dict? }]
export async function putMany(entries) {
  if (!entries.length) return;
  const tx = (await db()).transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const now = Date.now();
  for (const entry of entries) store.put({ ...entry, createdAt: now });
  await done(tx);
  if (Math.random() < 0.05) prune().catch(() => {}); // thỉnh thoảng dọn, không cần mỗi lần ghi
}

export async function count() {
  const tx = (await db()).transaction(STORE, 'readonly');
  const req = tx.objectStore(STORE).count();
  await done(tx);
  return req.result;
}

export async function clear() {
  const tx = (await db()).transaction(STORE, 'readwrite');
  tx.objectStore(STORE).clear();
  await done(tx);
}

// Một trang của bộ nhớ, mới nhất trước. query: lọc theo bản gốc/bản dịch/site (không phân biệt hoa thường).
// -> { rows, total }
export async function listPage({ offset = 0, limit = 50, query = '' } = {}) {
  const q = query.trim().toLowerCase();
  const tx = (await db()).transaction(STORE, 'readonly');
  const rows = [];
  let total = 0;

  if (!q) {
    const countReq = tx.objectStore(STORE).count();
    let skipped = offset === 0;
    tx.objectStore(STORE).index('createdAt').openCursor(null, 'prev').onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) return;
      if (!skipped) {
        skipped = true;
        cursor.advance(offset);
        return;
      }
      rows.push(cursor.value);
      if (rows.length < limit) cursor.continue();
    };
    await done(tx);
    return { rows, total: countReq.result };
  }

  // Có từ khoá: duyệt hết rồi lọc (đủ nhanh với vài trăm nghìn bản ghi).
  tx.objectStore(STORE).index('createdAt').openCursor(null, 'prev').onsuccess = (e) => {
    const cursor = e.target.result;
    if (!cursor) return;
    const { source = '', translation = '', site = '' } = cursor.value;
    if ([source, translation, site].some((v) => v.toLowerCase().includes(q))) {
      if (total >= offset && rows.length < limit) rows.push(cursor.value);
      total++;
    }
    cursor.continue();
  };
  await done(tx);
  return { rows, total };
}

// Xoá bản ghi tạo trước `cutoff` (ms). -> số bản đã xoá
export async function deleteOlderThan(cutoff) {
  const tx = (await db()).transaction(STORE, 'readwrite');
  let deleted = 0;
  tx.objectStore(STORE).index('createdAt').openCursor(IDBKeyRange.upperBound(cutoff, true)).onsuccess = (e) => {
    const cursor = e.target.result;
    if (!cursor) return;
    cursor.delete();
    deleted++;
    cursor.continue();
  };
  await done(tx);
  return deleted;
}

async function prune() {
  let excess = (await count()) - MAX_ENTRIES;
  if (excess <= 0) return;
  const tx = (await db()).transaction(STORE, 'readwrite');
  tx.objectStore(STORE).index('createdAt').openCursor().onsuccess = (e) => {
    const cursor = e.target.result;
    if (!cursor || excess-- <= 0) return;
    cursor.delete();
    cursor.continue();
  };
  await done(tx);
}
