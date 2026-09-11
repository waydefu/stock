/* REAL RESEARCH smoke: live Fugle bars → Multi-Horizon Trend full pipeline.
   Needs FUGLE_API_KEY in a trusted local shell (read-only market data).
   Without key: BLOCKED_BY_CREDENTIAL (exit 2). Invariants only, no prices recorded. */
import { createProxy } from "../server/market-proxy.js";
import { FugleProxyAdapter } from "../js/fugle-proxy-adapter.js";
import { evaluateWindow, runCostStress, splitIS_OOS, summarizeResearch, walkForward, parameterSurface, evaluatePromotion } from "../js/research.js";
import { fugleResearchRange } from "../js/research-range.js";
import { makeTrendStrategy, BUY_HOLD_STRATEGY } from "../js/alpha.js";
import { fixedFraction } from "../js/portfolio.js";

function warmupTail(bars, warmup) {
  const n = Math.max(0, Math.floor(warmup) || 0);
  if (!n || !Array.isArray(bars)) return [];
  return bars.slice(-Math.min(n, bars.length));
}

const key = process.env.FUGLE_API_KEY ?? "";
if (!key) {
  console.log("REAL_RESEARCH_SMOKE=BLOCKED_BY_CREDENTIAL (set FUGLE_API_KEY in a trusted local shell to run)");
  process.exit(2);
}

const symbol = process.argv[2] ?? "2330";
const to = new Date().toISOString().slice(0, 10);
const { from } = fugleResearchRange({ to });
const failures = [];
const out = {};
try {
  const proxy = createProxy({ apiKey: key });
  const running = await proxy.start(0, "127.0.0.1");
  try {
    const adapter = new FugleProxyAdapter({ baseUrl: running.url, timeoutMs: 20_000, maxAttempts: 2 });
    const { envelope } = await adapter.getBarsAsync(symbol, { from, to });
    if (envelope.meta.provider !== "FUGLE") failures.push("provenance");
    const bars = envelope.data;
    out.bars = bars.length;
    out.range = `${from}->${to}`;
    if (!Array.isArray(bars) || bars.length < 150) failures.push(`history:${bars?.length ?? 0}`);
    if (failures.length) throw new Error("insufficient history");
    const def = makeTrendStrategy({});
    const base = { symbol, strategy: def, allocate: fixedFraction(0.25), commissionRate: 0.001425, slippageBps: 5, initialCapital: 1_000_000 };
    const split = splitIS_OOS(bars, 0.4);
    const oos = evaluateWindow({ ...base, contextBars: warmupTail(split.is, def.warmup), evalBars: split.oos });
    const oosS = summarizeResearch(oos, {});
    const buyOOS = summarizeResearch(evaluateWindow({ ...base, strategy: BUY_HOLD_STRATEGY, allocate: fixedFraction(1), contextBars: [], evalBars: split.oos }), {});
    const wf = walkForward(bars, { folds: 3, minWindow: 30 }).filter((w) => w.train.length >= def.warmup);
    if (!wf.length) failures.push("walk-forward windows");
    const oosWindows = wf.map((w) => summarizeResearch(evaluateWindow({ ...base, contextBars: warmupTail(w.train, def.warmup), evalBars: w.test }), {}));
    const stress = runCostStress({ ...base, bars }, (r) => summarizeResearch(r, {}), [1, 2]);
    const surface = parameterSurface([10, 20, 30].map((short) => {
      const v = makeTrendStrategy({ id: `t${short}`, short });
      const tail = bars.slice(-60);
      const r = evaluateWindow({ ...base, strategy: v, allocate: fixedFraction(0.25), contextBars: bars.slice(-60 - short, -60), evalBars: tail });
      return { params: { short }, value: summarizeResearch(r, {}).netProfit };
    }));
    const gate = evaluatePromotion({ strategyId: def.id, isSummary: summarizeResearch(evaluateWindow({ ...base, contextBars: [], evalBars: split.is }), {}), oosSummaries: oosWindows, costStress: stress, surfaceFlag: surface.overfitRisk ? "OVERFIT_RISK" : "STABLE", correctnessFindings: [] });
    const last = def.generateSignal({ bars, index: bars.length - 1, symbol });
    Object.assign(out, {
      latestScore: last.score, latestConfidence: last.confidence, latestReason: last.reasonCodes?.[0] ?? "unknown",
      oosTrades: oosS.tradeCount, oosReturn: oosS.netProfit, benchmarkOosReturn: buyOOS.netProfit,
      promotion: gate.pass ? "PASS" : "FAIL",
    });
  } finally {
    await running.close();
  }
} catch (error) {
  failures.push(`thrown ${error?.code ?? "unknown"}`);
}

if (failures.length) {
  console.log(`REAL_RESEARCH_SMOKE=FAILED: ${failures.join("; ")}`);
  process.exit(1);
}
console.log(`REAL_RESEARCH_SMOKE=PASS provider=FUGLE symbol=${symbol} bars=${out.bars} range=${out.range} latestScore=${out.latestScore} latestConfidence=${out.latestConfidence} latestReason=${out.latestReason} oosTrades=${out.oosTrades} oosReturn=${out.oosReturn} benchmarkOosReturn=${out.benchmarkOosReturn} promotion=${out.promotion}`);
