/* TWSE 市場休市日（官方快照，不是推測出來的）。
   Source：臺灣證券交易所「市場開休市日期」開放資料
   https://www.twse.com.tw/rwd/zh/holidaySchedule/holidaySchedule?response=json&queryYear=2026
   Accessed：2026-10-22
   Covers：2026-01-01 ～ 2026-12-31（TWSE 當年度公告；涵蓋範圍外的日期退回
   weekday 規則，policy 會明講，不假裝涵蓋）。
   只收「市場無交易」日；官方清單裡的「最後交易日／開始交易日」是交易日，不收。
   週末落在休市清單者仍收錄（來源忠實），但 weekday 規則本來就會擋掉。 */
"use strict";

export const TW_MARKET_HOLIDAYS = Object.freeze({
  source: "https://www.twse.com.tw/rwd/zh/holidaySchedule/holidaySchedule?response=json&queryYear=2026",
  accessed: "2026-10-22",
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  days: Object.freeze({
    "2026-01-01": "中華民國開國紀念日",
    "2026-02-12": "市場無交易（僅辦理結算交割作業）",
    "2026-02-13": "市場無交易（僅辦理結算交割作業）",
    "2026-02-15": "農曆除夕及春節",
    "2026-02-16": "農曆除夕及春節",
    "2026-02-17": "農曆除夕及春節",
    "2026-02-18": "農曆除夕及春節",
    "2026-02-19": "農曆除夕及春節",
    "2026-02-20": "農曆除夕及春節（補假）",
    "2026-02-27": "和平紀念日（補假）",
    "2026-02-28": "和平紀念日",
    "2026-04-03": "兒童節及民族掃墓節（補假）",
    "2026-04-04": "兒童節及民族掃墓節",
    "2026-04-05": "兒童節及民族掃墓節",
    "2026-04-06": "兒童節及民族掃墓節（補假）",
    "2026-05-01": "勞動節",
    "2026-06-19": "端午節",
    "2026-09-25": "中秋節",
    "2026-09-28": "孔子誕辰紀念日／教師節",
    "2026-10-09": "國慶日（補假）",
    "2026-10-10": "國慶日",
    "2026-10-25": "臺灣光復暨金門古寧頭大捷紀念日",
    "2026-10-26": "臺灣光復暨金門古寧頭大捷紀念日（補假）",
    "2026-12-25": "行憲紀念日",
  }),
});

export function isCoveredDate(dateKey) {
  return dateKey >= TW_MARKET_HOLIDAYS.effectiveFrom && dateKey <= TW_MARKET_HOLIDAYS.effectiveTo;
}
