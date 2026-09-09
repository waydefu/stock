# Research Ledger

此表是 implementation 會依賴的外部規則／設計證據索引。[91][64][70] 完整 URL 與引用編號由 citation ledger 維護；本表只記「哪個 claim 影響哪個 implementation」。

| Claim | Source | Authority | Applies to | Time-sensitive | Implementation impact |
|---|---|---|---|---|---|
| 一般文字 AA 對比至少 4.5:1；focus／non-text 有獨立要求 | [91][92][93] | W3C WCAG 2.2 | UI tokens、focus、controls、charts | Stable standard，但版本需追 | 不接受只看色票；以 foreground/background pair 驗證 |
| layout 要適應視窗／文字尺寸／安全區；motion 要有目的且可減弱 | [64][65][66] | Apple HIG | responsive、typography、motion | Updated guidance | P0/P2 UI acceptance criteria |
| high-contrast colors、semantic scales、materials、grid、component states | [67][68][69] | Vercel Geist | design tokens、surfaces、grid | Product system may evolve | 用 semantic tokens 取代 inline values |
| contextual views、components、loading／empty／status patterns | [70][71][72] | Stripe Apps docs | workflow states、contextual research UI | Docs version-sensitive | 狀態元件與工作流邊界 |
| 降低 chrome 噪音、提升 hierarchy/density、漸進 rollout | [73][74] | Linear design posts | navigation、density、redesign rollout | Product-specific | 不用新增卡片解決 hierarchy；改成可驗證 rollout |
| data table toolbar、search、filter、sort、row actions、empty/error state | [79][80] | IBM Carbon | table system | Component guidance evolves | sticky header、sort、empty/error acceptance |
| focused／pressed／disabled states、transition／empty state semantics | [81][82][83] | Material Design | interaction states、motion | Version-sensitive | all controls need state matrix |
| chart／screener／paper／strategy tester／broker context in one workflow | [6] | TradingView official features | trading UX | Product version-sensitive | preserve selected-symbol context |
| dashboard and multi-asset market context | [86] | Koyfin official features | market overview | Data coverage changes | market-first dashboard |
| heatmap market breadth and visual market maps | [4] | Finviz official | heatmap／screener | Product feature changes | size/color must have data semantics |
| customizable multi-asset workspace, orders, risk, PaperTrader | [88] | IBKR official | order／risk workspace | Product/API version-sensitive | stateful execution view |
| desktop/web/mobile and paperMoney continuity | [89] | Schwab official | responsive / paper flow | Product version-sensitive | mobile is a workflow, not a shrunk desktop |
| API-first paper/live separation and simulator limitations | [36] | Alpaca official docs | broker boundary | Provider policy changes | paper-only adapter and explicit mode |
| Taiwanese quant flow and provider API boundary | [26][30] | XQ／Fugle official | TW research／adapter | Highly time-sensitive | verify rules, rate limits, corporate actions before integration |
| GitHub Actions secure use：least privilege、secret handling、workflow security | [94] | GitHub official secure-use reference | CI／supply chain | Security guidance evolves | permissions read-only；action refs immutable；Dependabot 更新 pinned refs。 |
## Evidence policy

- Government／exchange／regulator > official broker/API docs > official design system > primary repo > secondary comparison。
- 金融規則、API limits、paper/live semantics 每次 implementation 前重新查官方頁。
- Benchmark claim 不等於本 repo requirement；落地前要建立 local test／browser evidence。
- 沒有來源或只看到搜尋片段的 claim，標成 Needs verification，不當成 invariant。

## Current unverified external work

- TWSE 最新交易規則、tick schedule、odd-lot、corporate-action effective dates。
- Fugle／Shioaji／Alpaca／IBKR 當前 adapter limits 與 paper 行為。
- GitHub Actions immutable SHA／Dependabot／security feature policy。

## Sources

[4] https://finviz.com/blog/the-finviz-matrix-market-breadth-visualized
[6] https://www.tradingview.com/features
[26] https://www.xq.com.tw
[30] https://developer.fugle.tw/docs/trading/intro
[36] https://docs.alpaca.markets/us/docs/paper-trading
[64] https://developer.apple.com/design/human-interface-guidelines/layout
[65] https://developer.apple.com/design/human-interface-guidelines/motion
[66] https://developer.apple.com/design/human-interface-guidelines/accessibility
[67] https://vercel.com/geist/introduction
[68] https://vercel.com/geist/colors
[69] https://vercel.com/geist/grid
[70] https://docs.stripe.com/stripe-apps/design
[71] https://docs.stripe.com/stripe-apps/components
[72] https://docs.stripe.com/stripe-apps/patterns
[73] https://linear.app/now/behind-the-latest-design-refresh
[74] https://linear.app/changelog/2024-03-20-new-linear-ui
[79] https://carbondesignsystem.com/components/data-table/usage
[80] https://preview.carbondesignsystem.com/building-blocks/core/patterns/empty-states
[81] https://m3.material.io/foundations/interaction/states/applying-states
[82] https://m1.material.io/patterns/empty-states.html
[83] https://m3.material.io/styles/motion/transitions/applying-transitions
[86] https://www.koyfin.com/features/market-dashboards
[88] https://www.interactivebrokers.ca/en/trading/tws.php
[89] https://www.schwab.com/trading/thinkorswim
[91] https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum
[92] https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
[93] https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance
[94] https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions
