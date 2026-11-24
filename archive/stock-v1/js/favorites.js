/* 自選清單：本機持久化的標的收藏，不影響帳本與風控。 */
"use strict";

const FAVORITES_KEY = "tw-us-stock-favorites-v1";

export function loadFavorites(storage) {
  try {
    if (!storage) return [];
    const raw = storage.getItem(FAVORITES_KEY);
    if (!raw) return [];
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((code) => typeof code === "string") : [];
  } catch {
    return [];
  }
}

export function toggleFavorite(storage, code) {
  const next = new Set(loadFavorites(storage));
  const key = String(code);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  const list = [...next];
  try {
    storage?.setItem(FAVORITES_KEY, JSON.stringify(list));
  } catch {
    // 本機展示偏好寫入失敗不影響交易主流程
  }
  return list;
}

export { FAVORITES_KEY };
