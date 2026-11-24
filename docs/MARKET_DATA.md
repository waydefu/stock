# M1 #64｜公開行情資料契約（REST 首批）
來源：Binance Spot 官方 https://developers.binance.com/en/docs/products/spot/rest-api 、 https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints 。僅固定公開 data-api.binance.vision GET /api/v3/time 和 /api/v3/aggTrades；aggregate trade 的 T 為毫秒事件時間、a 為 aggregate ID、p/q 為十進位字串。最新成交不是可成交報價或買賣盤，不應用作成交保證。
架構：server/market/contract.js 純資料驗證與 sequence 判斷；application.js 協調公開 port 與時鐘；binance-rest.js 固定 GET 來源、限流拒絕、timeout、128KiB body 上限；scripts/market-smoke.js 是獨立組裝入口。與 js/ 前端及 native 分離，不加入 dist、不連 AI 或交易執行。CLI 手動一次性 npm run market:smoke，失敗退出 1，禁止 fallback。
契約：schemaVersion, venue, marketType, source, kind, symbol, sequence, eventAt/observedAt/fetchedAt/expiresAt（UTC epoch ms）、quality、精確 price/quantity 字串。時間不可信、未來、過期、無效資料均拒絕；429 遵守 Retry-After（無數字採 60 秒），418 本行程禁止再請求，無自動重試；只在單一 adapter 實例序列化，未實作分散限流。REST 最新快照跳號不代表丟包；compareSequence 用於診斷，WS gap/recovery 另階段。現在未接持久資料、exchangeInfo、歷史 K 線、WS、持續服務、行情 UI 或風控執行。真實端點 smoke 需地區/網路允許，測試 mock 不代表已連線。
驗收：正確來源與 decimal 保留、非法 symbol、未來/過期、時鐘偏差、sequence 重複/回退/缺口、固定唯讀 GET、429/418、網路/JSON/大 body 失敗；實際 REST smoke 及歷史/交易規則/WS 仍待 #64。

追加稽核：批次最終評估時間加時鐘不確定性，早期已過期證據不再標 FRESH；時鐘回退即拒絕。獨立 backend module graph 及前端交付隔離反例測試；CodeQL 掃描涵蓋 server/。

大掃補強：watchlist 複製與稀疏陣列拒絕；每筆 port 回傳的 fetchedAt 須落在本地請求/收到時間區間，批次時鐘回退拒絕；到期時刻即失效；序列診斷要求合法 symbol/source、正規安全整數 ID 與有效 decimal/方向；adapter 發現本地時鐘回退後保持拒絕，取消 body 失敗不掩蓋限流結果。此處仍使用 wall clock，無法保證偵測所有向前跳時，持續服務需 monotonic clock 與重同步。
