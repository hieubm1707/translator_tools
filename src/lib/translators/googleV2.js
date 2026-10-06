// RPC nội bộ của trang translate.google.com (batchexecute, rpcid "MkEWBc").
// Cần token lấy từ HTML trang chủ; cache 1 giờ.
const HOME_URL = 'https://translate.google.com';
const RPC_URL = 'https://translate.google.com/_/TranslateWebserverUi/data/batchexecute';
const TOKEN_TTL = 60 * 60 * 1000;

let token;

async function getToken() {
  if (token && Date.now() - token.time < TOKEN_TTL) return token;
  const html = await (await fetch(HOME_URL)).text();
  const sid = html.match(/"FdrFJe":"(.*?)"/)?.[1];
  const bl = html.match(/"cfb2h":"(.*?)"/)?.[1];
  if (!sid || !bl) throw new Error('Cannot read translate.google.com token');
  token = { sid, bl, at: html.match(/"SNlM0e":"(.*?)"/)?.[1] ?? '', time: Date.now() };
  return token;
}

export default {
  label: 'Google (V2)',
  async translate(text, sourceLang, targetLang) {
    const { sid, bl, at } = await getToken();
    const freq = JSON.stringify([[['MkEWBc', JSON.stringify([[text, sourceLang, targetLang, true], [null]]), null, 'generic']]]);
    const params = new URLSearchParams({
      rpcids: 'MkEWBc', 'source-path': '/', 'f.sid': sid, bl, hl: 'en',
      'soc-app': '1', 'soc-platform': '1', 'soc-device': '1',
      _reqid: String(Math.floor(10000 + 10000 * Math.random())), rt: 'c',
    });

    const res = await fetch(`${RPC_URL}?${params}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams({ 'f.req': freq, at }),
    });
    if (!res.ok) {
      token = undefined; // token có thể đã hết hạn
      throw new Error(`HTTP ${res.status}`);
    }

    // Body dạng ")]}'\n<len>\n[[\"wrb.fr\",\"MkEWBc\",\"<json lồng>\",...]]"
    const envelope = JSON.parse(/\[.*\]/.exec(await res.text())[0]);
    const json = JSON.parse(envelope[0][2]);
    // chunk = [bản dịch, , cầnDấuCáchPhíaTrước, ...]; cờ này false với ngôn ngữ không dùng dấu cách (ja, zh...)
    const text_ = json[1][0][0][5]
      .filter((chunk) => chunk?.[0])
      .map((chunk) => (chunk[2] ? ' ' : '') + chunk[0])
      .join('');
    if (!text_) throw new Error('Empty response');

    return { text: text_, detectedLang: json[0][2] ?? sourceLang, transliteration: json[1][0][0][1] ?? '' };
  },
};
