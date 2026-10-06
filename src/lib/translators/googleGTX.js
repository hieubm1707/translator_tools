// Endpoint "te_lib" (dùng bởi widget dịch trang của Google), cần token `tk` tính từ text.
// Thuật toán token theo https://github.com/translate-tools/core (qua MouseTooltipTranslator, MIT).
const API_URL = 'https://translate.googleapis.com/translate_a/t';
const TKK = '448487.932609646';

export default {
  label: 'Google (GTX)',
  async translate(text, sourceLang, targetLang) {
    const params = new URLSearchParams({
      client: 'te_lib', sl: sourceLang, tl: targetLang, hl: targetLang,
      anno: '3', format: 'html', v: '1.0', tc: '1', sr: '1', mode: '1',
      q: text, tk: getToken(text, TKK),
    });
    const res = await fetch(`${API_URL}?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // sl=auto -> [[bản dịch, ngôn ngữ phát hiện]]; ngược lại -> [bản dịch]
    const raw = sourceLang === 'auto' ? data?.[0]?.[0] : data?.[0];
    if (!raw) throw new Error('Empty response');

    const cleaned = decodeEntities(raw)
      .replace(/<i>.+?<\/i>/gi, ' ') // te_lib chèn lại câu gốc trong <i>
      .replace(/<\/?b[^>]*>/g, ' ')
      .replace(/\s\s+/g, ' ')
      .trim();

    return { text: cleaned, detectedLang: sourceLang === 'auto' ? data[0][1] : sourceLang };
  },
};

// Service worker không có DOMParser nên tự giải mã các entity phổ biến.
function decodeEntities(str) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return str.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return named[e.toLowerCase()] ?? m;
  });
}

function shiftLeftOrRightThenSumOrXor(num, opt) {
  for (let i = 0; i < opt.length - 2; i += 3) {
    let acc = opt.charAt(i + 2);
    acc = acc >= 'a' ? acc.charCodeAt(0) - 87 : Number(acc);
    acc = opt.charAt(i + 1) === '+' ? num >>> acc : num << acc;
    num = opt.charAt(i) === '+' ? num + (acc & 4294967295) : num ^ acc;
  }
  return num;
}

function utf8Bytes(query) {
  const bytes = [];
  for (let i = 0; i < query.length; i++) {
    let c = query.charCodeAt(i);
    if (c < 128) {
      bytes.push(c);
    } else {
      if (c < 2048) {
        bytes.push((c >> 6) | 192);
      } else {
        if ((c & 64512) === 55296 && i + 1 < query.length && (query.charCodeAt(i + 1) & 64512) === 56320) {
          c = 65536 + ((c & 1023) << 10) + (query.charCodeAt(++i) & 1023);
          bytes.push((c >> 18) | 240, ((c >> 12) & 63) | 128);
        } else {
          bytes.push((c >> 12) | 224);
        }
        bytes.push(((c >> 6) & 63) | 128);
      }
      bytes.push((c & 63) | 128);
    }
  }
  return bytes;
}

function getToken(query, tkk) {
  const [index, key] = tkk.split('.').map((n) => Number(n) || 0);
  let a = index;
  for (const b of utf8Bytes(query)) {
    a = shiftLeftOrRightThenSumOrXor(a + b, '+-a^+6');
  }
  a = shiftLeftOrRightThenSumOrXor(a, '+-3^+b+-f');
  a ^= key;
  if (a <= 0) a = (a & 2147483647) + 2147483648;
  const r = a % 1000000;
  return `${r}.${r ^ index}`;
}
