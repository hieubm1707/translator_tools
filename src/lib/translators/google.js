// Endpoint công khai (không chính thức) mà Google Translate dùng cho client "gtx".
// dj=1 -> JSON có tên trường; dt=t bản dịch, dt=rm phiên âm, dt=bd từ điển.
const API_URL = 'https://translate.googleapis.com/translate_a/single';

export default {
  label: 'Google',
  async translate(text, sourceLang, targetLang) {
    const params = new URLSearchParams({ client: 'gtx', dj: '1', sl: sourceLang, tl: targetLang, hl: targetLang, q: text });
    for (const dt of ['t', 'rm', 'bd']) params.append('dt', dt);

    const res = await fetch(`${API_URL}?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // Mỗi câu đã kèm khoảng trắng/xuống dòng ở cuối nên nối bằng "".
    const text_ = data.sentences?.map((s) => s.trans).filter(Boolean).join('').replace(/\n /g, '\n');
    if (!text_) throw new Error('Empty response');

    return {
      text: text_,
      detectedLang: data.src,
      transliteration: data.sentences?.map((s) => s.src_translit).filter(Boolean).join(' ').trim(),
      dict: data.dict?.map((d) => `${d.pos}: ${d.terms.slice(0, 3).join(', ')}`).join('\n'),
    };
  },
};
