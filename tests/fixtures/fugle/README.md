# Fugle fixtures（公開文件範例，零秘密）

來源（查驗 2026-09-11，均為 Fugle 官方公開文件）：

- `quote-success.json`：verbatim `GET /intraday/quote/2330` Response Body
 （https://developer.fugle.tw/docs/data/http-api/intraday/quote，頁面更新 2026-01-09）。
- `historical-success.json`：結構取自 `GET /historical/candles/0050` Response Body
 （https://developer.fugle.tw/docs/data/http-api/historical/candles）；
  數值為同文件欄位語義內的示意值（官方範例僅完整列出首根），shape 忠於文件。
- `rate-limit.json`：HTTP 429 語義取自官方錯誤代碼頁
 （https://developer.fugle.tw/docs/data/error_codes，2026-01-09）；
  Retry-After 為傳輸層劇本值（官方未承諾此 header，本 repo 解析後優先使用、缺席則退回 backoff）。
- `malformed-response.json`：本 repo 自造的 schema-drift 劇本（非官方）。

时间戳单位（sourced conversion）：intraday `*Time`／`lastUpdated` 為 16 位數微秒
（例 1685338200000000），mapper 以 `Math.floor(us / 1000)` 轉毫秒，不靠猜。
