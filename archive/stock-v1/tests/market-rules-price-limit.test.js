/* 市場規則精度測試：漲跌停整數運算、商品別跳動單位、零股限價限制。
   對應風險 R-028（漲跌停差一檔）與 R-029（商品別跳動單位未建模）。 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  TW_ETF_TICK_SCHEDULE,
  TW_STOCK_TICK_SCHEDULE,
  TW_WARRANT_TICK_SCHEDULE,
  calculatePriceLimits,
  fromMinorUnits,
  getTickSchedule,
  getTickSize,
  isOnMinorUnitGrid,
  roundToTick,
  toMinorUnits,
  validateOrderTypeInSession,
  validateTick,
} from "../js/market-rules.js";

// ─────────────────────────────────────────────────────────────────────────────
// Oracle A：BigInt 有理數實作的「精確整數演算法」
// 與正式實作刻意採用不同表示法（BigInt 分數 vs Number 分數）與不同分支結構，
// 目的是交叉驗證而不是複製同一段程式碼。
// ─────────────────────────────────────────────────────────────────────────────
const ORACLE_TICK_BANDS = Object.freeze([
  { minUnits: 0n, maxUnits: 1000n, tickUnits: 1n }, // 0–10 元 → 0.01
  { minUnits: 1000n, maxUnits: 5000n, tickUnits: 5n }, // 10–50 元 → 0.05
  { minUnits: 5000n, maxUnits: 10000n, tickUnits: 10n }, // 50–100 元 → 0.10
  { minUnits: 10000n, maxUnits: 50000n, tickUnits: 50n }, // 100–500 元 → 0.50
  { minUnits: 50000n, maxUnits: 100000n, tickUnits: 100n }, // 500–1000 元 → 1.00
  { minUnits: 100000n, maxUnits: null, tickUnits: 500n }, // ≥1000 元 → 5.00
]);

function oracleBand(numerator, denominator) {
  for (const band of ORACLE_TICK_BANDS) {
    const aboveMin = numerator >= band.minUnits * denominator;
    const belowMax = band.maxUnits === null ? true : numerator < band.maxUnits * denominator;
    if (aboveMin && belowMax) return band;
  }
  return ORACLE_TICK_BANDS[ORACLE_TICK_BANDS.length - 1];
}

/** 以「分」為單位的整數 oracle：回傳 { limitUpUnits, limitDownUnits } */
function oracleLimits(refUnits, pct) {
  const den = 100n;
  const upNum = BigInt(refUnits) * BigInt(100 + pct);
  const downNum = BigInt(refUnits) * BigInt(100 - pct);
  const upBand = oracleBand(upNum, den);
  const downBand = oracleBand(downNum, den);
  const upSteps = upNum / (den * upBand.tickUnits); // BigInt 整除 = floor
  const downSteps = (downNum + den * downBand.tickUnits - 1n) / (den * downBand.tickUnits); // = ceil
  return { limitUpUnits: upSteps * upBand.tickUnits, limitDownUnits: downSteps * downBand.tickUnits };
}

// ─────────────────────────────────────────────────────────────────────────────
// Oracle B：暴力列舉「價格自身價位帶是否為合法 tick 價」的獨立交叉驗證
// 與 Oracle A 走的是完全不同的路徑（列舉 vs 公式），用於抽樣複核。
// ─────────────────────────────────────────────────────────────────────────────
const BRUTE_BANDS = Object.freeze([
  { min: 0, max: 10, tick: 1 },
  { min: 10, max: 50, tick: 5 },
  { min: 50, max: 100, tick: 10 },
  { min: 100, max: 500, tick: 50 },
  { min: 500, max: 1000, tick: 100 },
  { min: 1000, max: Infinity, tick: 500 },
]);

/** 以「分」為單位判斷該價格在其自身價位帶是否為合法 tick 價 */
function isLegalTickPrice(minorUnits) {
  const price = minorUnits / 100;
  for (const band of BRUTE_BANDS) {
    if (price >= band.min && price < band.max) return minorUnits % band.tick === 0;
  }
  return minorUnits % BRUTE_BANDS[BRUTE_BANDS.length - 1].tick === 0;
}

/** 從原價往外逐分搜尋第一個合法 tick 價（不假設「以原價所在價位帶取 tick」） */
function bruteForceLimits(refUnits, pct) {
  const den = 100;
  const upRaw = (refUnits * (100 + pct)) / den;
  const downRaw = (refUnits * (100 - pct)) / den;
  let up = Math.floor(upRaw);
  while (!isLegalTickPrice(up)) up -= 1;
  let down = Math.ceil(downRaw);
  while (!isLegalTickPrice(down)) down += 1;
  return { limitUpUnits: up, limitDownUnits: down };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) 最小報價單位（minor unit）純函式
// ─────────────────────────────────────────────────────────────────────────────
test("最小報價單位換算以整數完成，不殘留浮點誤差", () => {
  assert.equal(toMinorUnits(1.21), 121);
  assert.equal(toMinorUnits(0.01), 1);
  assert.equal(toMinorUnits(3000), 300000);
  assert.equal(fromMinorUnits(121), 1.21);
  assert.equal(fromMinorUnits(1100), 11);
  assert.equal(fromMinorUnits(110000), 1100);
  assert.equal(fromMinorUnits(1), 0.01);
  assert.ok(isOnMinorUnitGrid(1.21));
  assert.ok(!isOnMinorUnitGrid(1.213));
  assert.ok(!isOnMinorUnitGrid(Number.NaN));
  // 浮點表示相近但不相等的價格，仍能正確還原
  assert.equal(fromMinorUnits(toMinorUnits(0.1 + 0.2)), 0.3);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2) 漲跌停：窮舉回歸測試（0.01–3000.00 元，步進 0.01 元 = 300,000 檔）
// ─────────────────────────────────────────────────────────────────────────────
test("calculatePriceLimits 與精確整數 oracle 在 0.01–3000.00 元全區間零差異", () => {
  const mismatches = [];
  let checked = 0;
  for (let units = 1; units <= 300000; units += 1) {
    const referencePrice = units / 100;
    const actual = calculatePriceLimits("TW", referencePrice);
    const expected = oracleLimits(units, 10);
    const expectedUp = fromMinorUnits(Number(expected.limitUpUnits));
    const expectedDown = fromMinorUnits(Number(expected.limitDownUnits));
    checked += 1;
    if (actual.limitUp !== expectedUp || actual.limitDown !== expectedDown) {
      if (mismatches.length < 20) {
        mismatches.push({ referencePrice, actual, expectedUp, expectedDown });
      }
    }
  }
  assert.equal(checked, 300000, "窮舉範圍應為 300,000 檔參考價");
  assert.deepEqual(mismatches, [], `漲跌停價與精確整數演算法不一致：${JSON.stringify(mismatches)}`);
});

test("calculatePriceLimits 對 1.10–10.50 元區間的每一檔都與精確演算法一致", () => {
  const mismatches = [];
  for (let units = 110; units <= 1050; units += 1) {
    const referencePrice = units / 100;
    const actual = calculatePriceLimits("TW", referencePrice);
    const expected = oracleLimits(units, 10);
    const expectedUp = fromMinorUnits(Number(expected.limitUpUnits));
    const expectedDown = fromMinorUnits(Number(expected.limitDownUnits));
    if (actual.limitUp !== expectedUp || actual.limitDown !== expectedDown) {
      mismatches.push({ referencePrice, actual, expectedUp, expectedDown });
    }
  }
  assert.deepEqual(mismatches, [], `1.10–10.50 元區間不一致：${JSON.stringify(mismatches)}`);
});

test("舊浮點實作的 21 檔差異已由整數演算法修正（回歸見證）", () => {
  // 這是修正前的浮點演算法（Math.floor/Math.ceil 直接作用在浮點數上），保留作為回歸見證。
  const legacyLimits = (referencePrice) => {
    const rawUp = referencePrice * 1.1;
    const rawDown = referencePrice * 0.9;
    const tickFor = (price) => {
      for (const band of [
        { min: 0, max: 10, tick: 0.01 },
        { min: 10, max: 50, tick: 0.05 },
        { min: 50, max: 100, tick: 0.1 },
        { min: 100, max: 500, tick: 0.5 },
        { min: 500, max: 1000, tick: 1 },
        { min: 1000, max: Infinity, tick: 5 },
      ]) {
        if (price >= band.min && price < band.max) return band.tick;
      }
      return 5;
    };
    const tickUp = tickFor(rawUp);
    const tickDown = tickFor(rawDown);
    return {
      limitUp: Math.round(Math.floor(rawUp / tickUp) * tickUp * 100) / 100,
      limitDown: Math.round(Math.ceil(rawDown / tickDown) * tickDown * 100) / 100,
    };
  };
  const legacyMismatches = [];
  for (let units = 1; units <= 1050; units += 1) {
    const referencePrice = units / 100;
    const legacy = legacyLimits(referencePrice);
    const expected = oracleLimits(units, 10);
    if (legacy.limitUp !== fromMinorUnits(Number(expected.limitUpUnits))
      || legacy.limitDown !== fromMinorUnits(Number(expected.limitDownUnits))) {
      legacyMismatches.push(referencePrice);
    }
  }
  assert.equal(legacyMismatches.length, 21, "舊浮點演算法在 0.01–10.50 元應有 21 檔差異");
  assert.ok(legacyMismatches.includes(1.1), "參考價 1.10 應是差異之一");
  assert.ok(legacyMismatches.includes(1.9), "參考價 1.90 應是差異之一");
  // 新實作在同樣的 1,050 檔上必須完全正確
  for (const referencePrice of legacyMismatches) {
    const actual = calculatePriceLimits("TW", referencePrice);
    const expected = oracleLimits(Math.round(referencePrice * 100), 10);
    assert.equal(actual.limitUp, fromMinorUnits(Number(expected.limitUpUnits)), `參考價 ${referencePrice} 漲停`);
    assert.equal(actual.limitDown, fromMinorUnits(Number(expected.limitDownUnits)), `參考價 ${referencePrice} 跌停`);
  }
});

test("漲跌停價必定是它自己所在價位帶的合法 tick 價", () => {
  const violations = [];
  for (let units = 1; units <= 300000; units += 1) {
    const referencePrice = units / 100;
    const { limitUp, limitDown } = calculatePriceLimits("TW", referencePrice);
    const upMinor = toMinorUnits(limitUp);
    const downMinor = toMinorUnits(limitDown);
    if (!isLegalTickPrice(upMinor) || !isLegalTickPrice(downMinor)) {
      if (violations.length < 20) violations.push({ referencePrice, limitUp, limitDown });
    }
  }
  assert.deepEqual(violations, [], `漲跌停價不是合法 tick 價：${JSON.stringify(violations)}`);
});

test("抽樣以暴力列舉 oracle 交叉驗證漲跌停結果", () => {
  const mismatches = [];
  const sample = [];
  // 0.01–10.50 元全區間
  for (let units = 1; units <= 1050; units += 1) sample.push(units);
  // 其餘價位帶每 137 檔抽樣（涵蓋 10–50 / 50–100 / 100–500 / 500–1000 / ≥1000）
  for (let units = 1051; units <= 300000; units += 137) sample.push(units);
  // 每個價位帶邊界前後各取 3 檔
  for (const edge of [1000, 5000, 10000, 50000, 100000]) {
    for (let units = edge - 3; units <= edge + 3; units += 1) {
      if (units >= 1 && units <= 300000) sample.push(units);
    }
  }
  for (const units of sample) {
    const actual = calculatePriceLimits("TW", units / 100);
    const expected = bruteForceLimits(units, 10);
    const expectedUp = fromMinorUnits(expected.limitUpUnits);
    const expectedDown = fromMinorUnits(expected.limitDownUnits);
    if (actual.limitUp !== expectedUp || actual.limitDown !== expectedDown) {
      mismatches.push({ referencePrice: units / 100, actual, expectedUp, expectedDown });
    }
  }
  assert.ok(sample.length > 3000, "抽樣數量應足以覆蓋所有價位帶");
  assert.deepEqual(mismatches, [], `與暴力列舉 oracle 不一致：${JSON.stringify(mismatches)}`);
});

test("漲跌停價的已知名詞案例符合 TWSE 官方範例", () => {
  // TWSE 集中市場交易制度介紹「每日有價證券漲跌停價格計算範例」：基準 40.60 → 漲停 44.65、跌停 36.55
  assert.deepEqual(calculatePriceLimits("TW", 40.6), { limitUp: 44.65, limitDown: 36.55 });
  // 任務指定的邊界案例
  assert.deepEqual(calculatePriceLimits("TW", 1.1), { limitUp: 1.21, limitDown: 0.99 });
  assert.deepEqual(calculatePriceLimits("TW", 1.9), { limitUp: 2.09, limitDown: 1.71 });
  assert.deepEqual(calculatePriceLimits("TW", 10), { limitUp: 11, limitDown: 9 });
  assert.deepEqual(calculatePriceLimits("TW", 100), { limitUp: 110, limitDown: 90 });
  assert.deepEqual(calculatePriceLimits("TW", 500), { limitUp: 550, limitDown: 450 });
  assert.deepEqual(calculatePriceLimits("TW", 1000), { limitUp: 1100, limitDown: 900 });
  assert.deepEqual(calculatePriceLimits("TW", 3000), { limitUp: 3300, limitDown: 2700 });
  // US 無漲跌幅限制
  assert.equal(calculatePriceLimits("US", 100), null);
});

test("漲停價不超過上限、跌停價不低於下限，且兩者落在合法 tick 上", () => {
  for (const referencePrice of [1.1, 1.9, 9.99, 10, 10.01, 49.99, 50, 99.99, 100, 499.99, 500, 999.99, 1000, 2999.99]) {
    const { limitUp, limitDown } = calculatePriceLimits("TW", referencePrice);
    const rawUp = referencePrice * 1.1;
    const rawDown = referencePrice * 0.9;
    assert.ok(limitUp <= rawUp + 1e-9, `參考價 ${referencePrice} 漲停 ${limitUp} 不可超過 ${rawUp}`);
    assert.ok(limitDown >= rawDown - 1e-9, `參考價 ${referencePrice} 跌停 ${limitDown} 不可低於 ${rawDown}`);
    assert.ok(isLegalTickPrice(toMinorUnits(limitUp)), `參考價 ${referencePrice} 漲停 ${limitUp} 需為合法 tick`);
    assert.ok(isLegalTickPrice(toMinorUnits(limitDown)), `參考價 ${referencePrice} 跌停 ${limitDown} 需為合法 tick`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3) 商品別跳動單位（ETF／受益憑證／權證）
// ─────────────────────────────────────────────────────────────────────────────
test("商品別可選擇跳動單位表，預設維持股票表（既有呼叫端相容）", () => {
  // 股票表：50–100 元帶為 0.10、100–500 元帶為 0.50
  assert.equal(getTickSize("TW", 80), 0.1);
  assert.equal(getTickSize("TW", 80, "stock"), 0.1);
  assert.equal(getTickSize("TW", 80, undefined), 0.1);
  assert.equal(getTickSize("TW", 120), 0.5);
  // 股票表沿用營業細則第62條六段
  assert.deepEqual(getTickSchedule("TW", "stock"), TW_STOCK_TICK_SCHEDULE);
  // ETF／REITs／ETN 依受益憑證買賣辦法第7條：未滿 50 元 0.01、50 元以上 0.05
  assert.deepEqual(getTickSchedule("TW", "etf"), TW_ETF_TICK_SCHEDULE);
  assert.equal(getTickSize("TW", 20, "etf"), 0.01);
  assert.equal(getTickSize("TW", 49.99, "etf"), 0.01);
  assert.equal(getTickSize("TW", 50, "etf"), 0.05);
  assert.equal(getTickSize("TW", 80, "etf"), 0.05);
  assert.equal(getTickSize("TW", 5000, "etf"), 0.05);
  // REITs 與 ETN 與 ETF 同一欄
  assert.equal(getTickSize("TW", 80, "reit"), 0.05);
  assert.equal(getTickSize("TW", 80, "etn"), 0.05);
  // 封閉型基金受益憑證準用上市股票
  assert.equal(getTickSize("TW", 80, "closedFund"), 0.1);
  // 商品別字串大小寫／分隔符不影響結果
  assert.equal(getTickSize("TW", 80, "ETF"), 0.05);
  assert.equal(getTickSize("TW", 80, "closed-fund"), 0.1);
  // 未驗證的商品別回退到股票表（相容且可預期）
  assert.equal(getTickSize("TW", 80, "bond"), 0.1);
});

test("權證跳動單位依 TWSE 集中市場升降單位總表", () => {
  assert.deepEqual(getTickSchedule("TW", "warrant"), TW_WARRANT_TICK_SCHEDULE);
  assert.equal(getTickSize("TW", 3, "warrant"), 0.01);
  assert.equal(getTickSize("TW", 4.99, "warrant"), 0.01);
  assert.equal(getTickSize("TW", 5, "warrant"), 0.05);
  assert.equal(getTickSize("TW", 9.99, "warrant"), 0.05);
  assert.equal(getTickSize("TW", 10, "warrant"), 0.1);
  assert.equal(getTickSize("TW", 49.99, "warrant"), 0.1);
  assert.equal(getTickSize("TW", 50, "warrant"), 0.5);
  assert.equal(getTickSize("TW", 100, "warrant"), 1);
  assert.equal(getTickSize("TW", 499.99, "warrant"), 1);
  assert.equal(getTickSize("TW", 500, "warrant"), 5);
  assert.equal(getTickSize("TW", 3000, "warrant"), 5);
});

test("validateTick 依商品別套用對應的跳動單位", () => {
  // 55.05 在股票表（50–100 帶 0.10）不合法，在 ETF 表（50 元以上 0.05）合法
  assert.equal(validateTick("TW", 55.05).code, "INVALID_TICK");
  assert.equal(validateTick("TW", 55.05, "etf").ok, true);
  assert.equal(validateTick("TW", 55.0, "etf").ok, true);
  assert.equal(validateTick("TW", 55.03, "etf").code, "INVALID_TICK");
  // 20.05 在股票表（10–50 帶 0.05）合法，在權證表（10–50 帶 0.10）不合法
  assert.equal(validateTick("TW", 20.05).ok, true);
  assert.equal(validateTick("TW", 20.05, "warrant").code, "INVALID_TICK");
  assert.equal(validateTick("TW", 20.1, "warrant").ok, true);
  // 7.53 在股票表（0–10 帶 0.01）合法，在權證表（5–10 帶 0.05）不合法
  assert.equal(validateTick("TW", 7.53).ok, true);
  assert.equal(validateTick("TW", 7.53, "warrant").code, "INVALID_TICK");
  assert.equal(validateTick("TW", 7.5, "warrant").ok, true);
});

test("roundToTick 依商品別對齊到合法 tick", () => {
  assert.equal(roundToTick("TW", 55.03, "etf"), 55.05);
  assert.equal(roundToTick("TW", 55.03), 55);
  assert.equal(roundToTick("TW", 149.5), 149.5);
  assert.equal(roundToTick("TW", 7.53, "warrant"), 7.55);
  assert.equal(roundToTick("TW", 7.53), 7.53);
  assert.equal(roundToTick("US", 123.456), 123.456);
});

test("ETF 的漲跌停以 ETF 跳動單位計算（與股票表結果不同）", () => {
  // 45.45 × 1.1 = 49.995：股票表（10–50 帶 0.05）→ 49.95；ETF 表（未滿 50 元 0.01）→ 49.99
  // 45.45 × 0.9 = 40.905：股票表（0.05）→ 40.95；ETF 表（0.01）→ 40.91
  assert.deepEqual(calculatePriceLimits("TW", 45.45), { limitUp: 49.95, limitDown: 40.95 });
  assert.deepEqual(calculatePriceLimits("TW", 45.45, "etf"), { limitUp: 49.99, limitDown: 40.91 });
  // ETF 50 元以上以 0.05 對齊
  assert.deepEqual(calculatePriceLimits("TW", 50, "etf"), { limitUp: 55, limitDown: 45 });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4) 零股僅接受限價單
// ─────────────────────────────────────────────────────────────────────────────
test("台股零股只接受限價單，既有呼叫端（不帶 lot）行為不變", () => {
  const monday0830 = new Date("2025-01-06T00:30:00.000Z").getTime(); // 台北 08:30 集合競價
  const monday0900 = new Date("2025-01-06T01:00:00.000Z").getTime(); // 台北 09:00 逐筆交易
  const monday1325 = new Date("2025-01-06T05:25:00.000Z").getTime(); // 台北 13:25 收盤集合競價

  // 零股 + 市價單 → 明確錯誤碼
  const oddMarket = validateOrderTypeInSession("TW", "market", monday0900, "oddLot");
  assert.equal(oddMarket.ok, false);
  assert.equal(oddMarket.code, "ODD_LOT_LIMIT_ONLY");
  assert.ok(oddMarket.reason.includes("限價"), "理由要對使用者可行動");
  assert.ok(oddMarket.reason.includes("零股"), "理由要指明是零股限制");

  // 零股 + 限價單 → 允許
  assert.equal(validateOrderTypeInSession("TW", "limit", monday0900, "oddLot").ok, true);

  // 整股 + 市價單 → 允許
  assert.equal(validateOrderTypeInSession("TW", "market", monday0900, "regular").ok, true);

  // 不帶 lot 的既有呼叫行為完全不變
  assert.equal(validateOrderTypeInSession("TW", "market", monday0900).ok, true);
  assert.equal(validateOrderTypeInSession("TW", "market", monday0900, undefined).ok, true);
  const preMarketMarket = validateOrderTypeInSession("TW", "market", monday0830);
  assert.equal(preMarketMarket.code, "ORDER_TYPE_NOT_ALLOWED");

  // 零股 + 市價單在任何時段（含集合競價）都是零股限價限制
  assert.equal(validateOrderTypeInSession("TW", "market", monday0830, "oddLot").code, "ODD_LOT_LIMIT_ONLY");
  assert.equal(validateOrderTypeInSession("TW", "market", monday1325, "oddLot").code, "ODD_LOT_LIMIT_ONLY");
  // 零股 + 限價單在集合競價時段仍受限價規則約束
  assert.equal(validateOrderTypeInSession("TW", "limit", monday0830, "oddLot").ok, true);
  assert.equal(validateOrderTypeInSession("TW", "limit", monday1325, "oddLot").ok, true);

  // 非交易時段優先回報交易時段錯誤
  const monday0800 = new Date("2025-01-06T00:00:00.000Z").getTime();
  assert.equal(validateOrderTypeInSession("TW", "market", monday0800, "oddLot").code, "OUTSIDE_TRADING_HOURS");
  // US 無交易時段
  assert.equal(validateOrderTypeInSession("US", "market", Date.now(), "oddLot").code, "OUTSIDE_TRADING_HOURS");
});
