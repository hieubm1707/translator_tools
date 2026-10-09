# Translator Tool — Chrome Extension (Manifest V3)

Bôi đen văn bản trên trang web → chuột phải "Dịch …" hoặc `Alt+T` → hiện bản dịch ngay cạnh đoạn chọn.

## Chạy thử
1. Mở `chrome://extensions`, bật **Developer mode**.
2. **Load unpacked** → chọn thư mục này.
3. Sửa code xong → bấm nút ↻ trên thẻ extension, rồi reload trang web đang test.

## Ngôn ngữ giao diện (English / Tiếng Việt)
- Mặc định **English**. Đổi trong Cài đặt → **Interface → Display language** (lưu ngay, không cần bấm Save).
- Áp dụng cho popup, trang Cài đặt, trang Bộ nhớ, khung Split, menu chuột phải, bong bóng/tooltip/badge trong trang,
  thông báo phụ đề Coursera và thông báo lỗi của engine. Trang đang mở tự cập nhật ngay.
- Chuỗi nằm trong `src/lib/i18n-messages.js` (một file dùng chung: content script nạp qua manifest,
  trang + service worker import qua `src/lib/i18n.js`). HTML dùng `data-i18n`, `data-i18n-html`, `data-i18n-title`,
  `data-i18n-placeholder`. Thêm ngôn ngữ: thêm object mới + một dòng trong `LANGS`.
- Tên/mô tả extension và mô tả phím tắt trong `chrome://extensions` dùng `_locales/` (en mặc định, vi) — phần này
  Chrome chọn theo ngôn ngữ trình duyệt, không theo cài đặt trong extension.

## Split & Translate
Bấm **Split & Translate** trong popup (hoặc chuột phải vào trang → "Split & Translate (bật/tắt)"):
- Tab hiện tại được chia đôi ngay trong trang: bài đọc bên trái (mặc định 4/5), khung dịch bên phải (1/5).
- Kéo thanh chia ở giữa để đổi tỉ lệ; tỉ lệ được nhớ cho lần sau. Đóng bằng nút ✕ hoặc bấm Split & Translate lần nữa.
- Toàn bộ text hiển thị được tách theo phần tử block (p, li, h1, div…) và dịch theo lô.
- Rê chuột vào đoạn gốc → chữ của đoạn đó và bản dịch tương ứng cùng tô vàng, bản dịch tự cuộn vào giữa.
  Tô vàng dùng CSS Custom Highlight API nên không sửa DOM của trang.
- Hỗ trợ nội dung trong iframe (vd. bài đọc Coursera nhúng từ `storage.googleapis.com`): content script chạy ở mọi frame,
  khung dịch chia nhóm "Trang chính" / "Nội dung nhúng" (bấm tiêu đề nhóm để thu gọn).
- Nội dung đổi mà không tải lại trang (sang bài kế tiếp trong iframe, SPA…) → bấm ↻ để dịch lại.
- Trang đã mở trước khi cài/reload extension cần reload lại để content script chạy.

## Translate All
Bấm **Translate All** trong popup (hoặc chuột phải → "Translate All … (bật/tắt)"):
- Quét và dịch trước toàn bộ trang chính + mọi iframe nhúng (đoạn đang thấy trên màn hình được dịch trước).
- Ô nhỏ góc dưới phải mỗi frame báo tiến độ.
- Dịch xong, rê chuột vào đoạn gốc → đoạn được tô vàng và tooltip bản dịch hiện ngay (lấy từ bộ nhớ, không gọi API).
- Split & Translate và Translate All dùng chung danh sách đoạn nên chỉ bật một chế độ tại một thời điểm.
- **Giữ chế độ khi chuyển trang**: chế độ đang bật (Split hoặc Translate All) được nhớ theo tab; sang trang khác
  **cùng domain** trong tab đó thì tự bật lại (chờ trang render xong rồi mới quét), trang SPA đổi URL thì quét lại.
  Sang domain khác, bấm tắt, hoặc đóng tab → tắt. Đoạn lặp lại (thanh điều hướng…) lấy từ bộ nhớ bản dịch.
- Nội dung đổi mà URL không đổi (sang bài khác trong iframe…) → tắt rồi bật lại Translate All.

## Phụ đề song ngữ video Coursera
Mở bài giảng video (`coursera.org/learn/<khoá>/lecture/<id>`) → dưới video hiện phụ đề 1 hoặc 2 dòng (phụ đề 2 màu vàng).
Cài đặt trong popup, mục **Phụ đề video Coursera** (mục này chỉ hiện khi tab đang mở là `coursera.org` / `www.coursera.org`): bật/tắt, **Phụ đề 1**, **Phụ đề 2** (hoặc "Không hiển thị" để chỉ hiện 1 dòng),
**Cỡ chữ** (Small / Medium / Large / Extra large). Đổi là áp dụng ngay, không cần reload trang.
- **Danh sách ngôn ngữ lấy từ Coursera**: popup hỏi content script các track phụ đề (`<track srclang label>`) của video
  ở tab hiện tại. Ngoài trang bài giảng thì dropdown bị khoá.
- **Không gọi engine dịch nào** (Google/Gemini…): mỗi dòng là file WebVTT của chính Coursera.
- Lựa chọn được lưu theo mã ngôn ngữ và áp dụng cho mọi video. Video không có ngôn ngữ đã chọn thì:
  phụ đề 1 dùng tiếng Anh, nếu không có thì dùng track mặc định; phụ đề 2 bỏ trống. Dưới phụ đề hiện thông báo vài giây.
- Lớp phụ đề được chèn vào **khung player** (phần tử cha của `<video>`), vì `<video>` không vẽ phần tử con.
  Player đưa chính khung này lên fullscreen nên phụ đề vẫn hiện khi fullscreen.
- **Kiểu hiển thị** (popup): chọn tab Phụ đề 1 / Phụ đề 2 rồi chỉnh **màu chữ**, **màu nền** (ô màu có sẵn) và
  **độ đậm nền** (0–100%); khung xem trước cập nhật ngay, phụ đề trên video đổi theo không cần reload.
  **Khôi phục mặc định** đưa cả 2 dòng về chữ trắng / vàng trên nền đen 75%. Không dùng `<input type="color">`
  vì trên macOS bảng chọn màu hệ thống làm popup tự đóng.
- **Kéo thả phụ đề tự do** (popup): bỏ ghim vị trí mặc định, kéo khối phụ đề tới chỗ bất kỳ trong khung video.
  Vị trí lưu theo tỉ lệ của khung nên vẫn đúng chỗ khi resize/fullscreen, và được nhớ cho các video sau.
  Nhấp đúp vào phụ đề → về vị trí mặc định. Tắt công tắc → phụ đề ghim lại ở vị trí mặc định.
- Cỡ chữ tính theo cạnh ngắn của khung player (container query `cqmin`) → tự to/nhỏ khi fullscreen hoặc thu nhỏ cửa sổ.
- Khi bật, phụ đề gốc của Coursera bị ẩn để không chồng hai lớp; tắt trong popup là hiện lại.
- Đổi bài giảng không cần tải lại trang (script kiểm tra video/track mỗi giây).
- Không hiện khi chỉ riêng thẻ `<video>` được fullscreen hoặc khi xem Picture-in-Picture.

## Gemini + bộ nhớ bản dịch
- Cài đặt → **Gemini**: nhập API key (tạo tại https://aistudio.google.com/apikey — gói Google AI Plus không kèm quota API),
  bấm "Kiểm tra key & tải model" để chọn model (mặc định `gemini-flash-latest`).
- Cài đặt → **Dịch cả trang**: chọn Gemini để Split & Translate / Translate All dùng Gemini; dịch nhanh trong popup vẫn có thể dùng Google.
- Gemini dịch theo lô: gửi mảng JSON các đoạn của trang và ép trả về mảng JSON cùng độ dài (model thấy ngữ cảnh cả trang).
  Lỗi 429 (vượt quota/phút) tự chờ theo `retryDelay` rồi thử lại; trả thiếu/thừa phần tử thì tự chia nhỏ lô.
- **Model dự phòng**: Cài đặt → "Model dự phòng khi hết quota ngày" (cách nhau dấu phẩy). Model hết quota NGÀY
  (429 có `quotaId` chứa `PerDay`) được bỏ qua tới nửa đêm giờ Pacific và chuyển ngay sang model kế tiếp.
- Bộ nhớ bản dịch của Gemini **dùng chung cho mọi model** (engine lưu là "Gemini"): đổi model không dịch lại trang đã dịch.
- **Bộ nhớ bản dịch** (IndexedDB, `src/lib/translationCache.js`): mỗi đoạn lưu theo
  `SHA-256(domain trang, nguồn bản dịch, ngôn ngữ nguồn, ngôn ngữ đích, nội dung đoạn)`. Đoạn đã có hash → lấy ngay, không gọi API;
  trang đổi chữ → chỉ đoạn đổi có hash mới và được dịch. Đổi model/ngôn ngữ → hash mới.
  - **Theo domain**: hash dùng origin của trang chính (vd. `https://www.coursera.org`), nên đoạn lặp lại giữa các trang
    cùng domain (thanh điều hướng, menu…) chỉ dịch một lần; nội dung trong iframe (vd. bài giảng Coursera) tính theo trang chính.
    Bản ghi vẫn lưu URL đầy đủ (bỏ `#anchor`) của trang dịch lần đầu để hiển thị. Popup dùng chung (site rỗng).
  - **Hết hạn**: Cài đặt → "Tự xoá bản dịch sau" (1 / 7 / 30 ngày / không bao giờ, mặc định 7), tính từ lúc tạo.
    Bản quá hạn bị bỏ qua khi đọc; `chrome.alarms` dọn hẳn mỗi ngày.
  - **Mỗi lần cập nhật extension** (kể cả bấm Reload bản unpacked) bộ nhớ bị xoá toàn bộ.
  Cài đặt hiển thị số đoạn đã lưu; **Xem tất cả** mở trang `src/memory/` (bảng STT / Engine / Bản gốc / Bản dịch,
  tìm kiếm, phân trang 50 dòng, xoá bộ nhớ).

## Engine dịch

| Engine | Endpoint | Quyền host |
|---|---|---|
| `google` (mặc định) | `translate.googleapis.com/translate_a/single` (client=gtx) | khai báo sẵn |
| `googleGTX` | `translate.googleapis.com/translate_a/t` (client=te_lib + token `tk`) | khai báo sẵn |
| `googleV2` | `translate.google.com/_/TranslateWebserverUi/data/batchexecute` | khai báo sẵn |
| `gemini` | `generativelanguage.googleapis.com` (Gemini API chính thức, cần API key từ Google AI Studio) | khai báo sẵn |
| `llm` *(đang tạm ẩn)* | endpoint của provider (OpenAI, Claude, Gemini, Grok, Groq, OpenRouter, GitHub Models, Ollama, LM Studio, custom) | xin lúc runtime khi bấm **Lưu** trong Cài đặt (cần thêm lại `optional_host_permissions`) |

- **LLM đang tạm ẩn**: code giữ nguyên, bật lại bằng `FEATURES.llm = true` trong `src/lib/translators/index.js`
  (cài đặt cũ đang chọn LLM sẽ tự dùng Google). Manifest hiện **không** khai báo `optional_host_permissions`
  (bớt quyền khi lên Chrome Web Store); bật lại LLM thì thêm lại `"optional_host_permissions": ["https://*/*"]`,
  và `http://localhost/*`, `http://127.0.0.1/*` nếu dùng Ollama/LM Studio.
- Đổi ngôn ngữ/engine nhanh ngay trên popup (3 dropdown, lưu ngay khi đổi).
- Ba engine Google là endpoint **không chính thức**, có thể bị rate-limit (HTTP 429) hoặc đổi bất cứ lúc nào. Bật "tự thử engine Google khác" trong Cài đặt để có fallback.
- LLM **không** fallback sang Google, để văn bản không bị gửi tới nơi bạn không chọn.
- Claude gọi native Messages API (`/v1/messages`); các provider còn lại dùng chuẩn OpenAI `/chat/completions`.
- Ollama/LM Studio: nếu bị 403, cho phép origin của extension (vd. `OLLAMA_ORIGINS=chrome-extension://*`, hoặc bật CORS trong LM Studio).

## Cấu trúc
```
manifest.json
src/background/service-worker.js     # context menu, phím tắt, nhận message TRANSLATE
src/content/                         # bubble dịch vùng chọn; chia tab, tách đoạn, tô vàng khi hover
src/content/dualSubs.js, .css        # phụ đề song ngữ cho video bài giảng Coursera
src/popup/                           # ô dịch nhanh + nút Split & Translate
src/split/                           # trang trong khung dịch (iframe chèn vào tab)
src/options/                         # chọn engine, ngôn ngữ, Gemini key
src/memory/                          # trang xem bộ nhớ bản dịch (bảng)
src/lib/translate.js                 # điều phối: cache + fallback giữa engine Google
src/lib/translateMany.js             # dịch nhiều đoạn: gộp lô theo byte, lệch dòng thì dịch từng đoạn
src/lib/splitToggle.js, translateAllToggle.js  # bật/tắt hai chế độ cho mọi frame của tab
src/lib/translators/                 # google.js, googleGTX.js, googleV2.js, llm/
src/lib/permissions.js               # xin quyền host cho endpoint LLM
src/lib/settings.js, langs.js
src/lib/i18n-messages.js, i18n.js     # chuỗi giao diện en/vi + helper dịch DOM
_locales/                            # tên/mô tả extension cho chrome://extensions
```

## Luồng dữ liệu
```
content.js / popup.js ──sendMessage({type:'TRANSLATE'})──▶ service-worker.js ─▶ lib/translate.js ─▶ translators/*
          ▲                                                       │
          └──────────────── sendResponse({ok, text, engine}) ─────┘
```

## Debug
- Service worker: `chrome://extensions` → "Inspect views: service worker".
- Content script: DevTools của trang web → Console.
- Popup: chuột phải vào popup → Inspect.

## Ghi công
Logic của googleGTX/googleV2 chuyển thể từ [MouseTooltipTranslator](https://github.com/ttop32/MouseTooltipTranslator) (MIT).

## Ủng hộ
Nếu thấy extension hữu ích, bạn có thể mời tác giả một ly cà phê:

<a href="https://www.buymeacoffee.com/hieubm"><img src="https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20coffee&emoji=&slug=hieubm&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff" /></a>
