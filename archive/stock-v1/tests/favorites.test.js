import assert from "node:assert/strict";
import test from "node:test";
import { MemoryStorage } from "../js/paper.js";
import { loadFavorites, toggleFavorite } from "../js/favorites.js";

test("favorites toggle adds and removes a symbol", () => {
  const storage = new MemoryStorage();
  assert.deepEqual(loadFavorites(storage), []);
  assert.deepEqual(toggleFavorite(storage, "2330"), ["2330"]);
  assert.deepEqual(toggleFavorite(storage, "2330"), []);
});

test("favorites survive reload and discard malformed data", () => {
  const storage = new MemoryStorage();
  toggleFavorite(storage, "AAPL");
  assert.deepEqual(loadFavorites(storage), ["AAPL"]);
  storage.setItem("tw-us-stock-favorites-v1", "malformed");
  assert.deepEqual(loadFavorites(storage), []);
  storage.setItem("tw-us-stock-favorites-v1", JSON.stringify({ not: "a list" }));
  assert.deepEqual(loadFavorites(storage), []);
});
