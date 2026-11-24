/* REMOTE research smoke：已部署的 HTTPS proxy → 真實 Fugle 日 K → 分層研究全流程。
   與 scripts/smoke-research-fugle.js 同一條研究管線，差別只在資料來源：
   這支不需要本機放 Fugle 金鑰（金鑰在 proxy runtime 裡），用 MARKET_DATA_PROXY_URL。
   成本模型啟用台股 FeeModel（Track B1），所以 promotion 結論要照實重記。
   沒有 proxy URL：BLOCKED_BY_PROXY（exit 2），絕不假造成功。 */
import { FugleProxyAdapter } from "../js/fugle-proxy-adapter.js";
import {
  evaluateWindow,
  runCostStress,
  splitIS_OOS,
  summarizeResearch,
  walkForward,
  parameterSurface,
  evaluatePromotion,
  evaluateTrendSurface,
} from "../js/research.js";
import { fugleResearchRange } from "../js/research-range.js";
import { makeTrendStrategy, BUY_HOLD_STRATEGY } from "../js/alpha.js";
import { fixedFraction } from "../js/portfolio.js";
import { createTwFeeModel, describeTwFeeModel } from "../js/tw-fee-model.js";

const baseUrl = (process.env.MARKET_DATA_PROXY_URL ?? "").replace(/\/+$/, "");
if (!baseUrl) {
  console.log("REMOTE_RESEARCH_SMOKE=BLOCKED_BY_PROXY (set MARKET_DATA_PROXY_URL to the deployed proxy URL)");
  process.exit(2);
}

function warmupTail(bars, warmup) {
  const n = Math.max(0, Math.floor(warmup) || 0);
  if (!n || !Array.isArray(bars)) return [];
  return bars.slice(-Math.min(n, bars.length));
}

const symbol = process.argv[2] ?? "2330";
const to = new Date().toISOString().slice(0, 10);
const { from } = fugleResearchRange({ to });
const feeModel = createTwFeeModel({ commissionRate: 0.001425, minCommission: 20 });

try {
  const adapter = new FugleProxyAdapter({ baseUrl, timeoutMs: 20_000, maxAttempts: 2 });
  const { envelope } = await adapter.getBarsAsync(symbol, { from, to });
  if (envelope.meta.provider !== "FUGLE") throw new Error("provenance 非 FUGLE");
  const bars = envelope.data;
  if (!Array.isArray(bars) || bars.length < 150) throw new Error(`歷史不足：${bars?.length ?? 0} 根`);

  const def = makeTrendStrategy({});
  const base = {
    symbol, strategy: def, allocate: fixedFraction(0.25),
    commissionRate: 0.001425, slippageBps: 5, initialCapital: 1_000_000, feeModel,
  };
  const split = splitIS_OOS(bars, 0.4);
  const oos = evaluateWindow({ ...base, contextBars: warmupTail(split.is, def.warmup), evalBars: split.oos });
  const oosS = summarizeResearch(oos, {});
  const buyOOS = summarizeResearch(evaluateWindow({ ...base, strategy: BUY_HOLD_STRATEGY, allocate: fixedFraction(1), contextBars: [], evalBars: split.oos }), {});
  const wf = walkForward(bars, { folds: 3, minWindow: 30 }).filter((w) => w.train.length >= def.warmup);
  if (!wf.length) throw new Error("walk-forward 視窗不足");
  const oosWindows = wf.map((w) => summarizeResearch(evaluateWindow({ ...base, contextBars: warmupTail(w.train, def.warmup), evalBars: w.test }), {}));
  const stress = runCostStress({ ...base, bars }, (r) => summarizeResearch(r, {}), [1, 2]);
  const surfaceCells = evaluateTrendSurface({
    symbol, bars, shorts: [10, 20, 30], evalLength: 60,
    makeVariant: (short) => makeTrendStrategy({ id: `t${short}`, short }),
    allocate: fixedFraction(0.25), commissionRate: 0.001425, slippageBps: 5, initialCapital: 1_000_000, feeModel,
  });
  const surface = parameterSurface(surfaceCells.map(({ params, value }) => ({ params, value })));
  const gate = evaluatePromotion({
    strategyId: def.id,
    isSummary: summarizeResearch(evaluateWindow({ ...base, contextBars: [], evalBars: split.is }), {}),
    oosSummaries: oosWindows,
    costStress: stress,
    surfaceFlag: surface.overfitRisk ? "OVERFIT_RISK" : "STABLE",
    correctnessFindings: [],
  });
  const fee = describeTwFeeModel(feeModel);
  console.log(
    `REMOTE_RESEARCH_SMOKE=PASS symbol=${symbol} bars=${bars.length} range=${from}->${to}`
    + ` oosTrades=${oosS.tradeCount} oosReturn=${Math.round(oosS.netProfit)}`
    + ` benchmarkOosReturn=${Math.round(buyOOS.netProfit)}`
    + ` totalFees=${Math.round(oosS.totalFees ?? 0)}`
    + ` commission=${(fee.effectiveCommissionRate * 100).toFixed(4)}% min=${fee.minCommission}`
    + ` sellTaxStock=${(fee.sellTaxRateByInstrument.stock * 100).toFixed(2)}%`
    + ` promotion=${gate.pass ? "PASS" : "FAIL"}`,
  );
} catch (error) {
  console.log(`REMOTE_RESEARCH_SMOKE=FAILED: ${error?.code ?? "unknown"} ${(error?.message ?? "").slice(0, 160)}`);
  process.exit(1);
}
