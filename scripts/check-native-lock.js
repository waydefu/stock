import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import assert from "node:assert/strict";
const actual=createHash("sha256").update(readFileSync("src-tauri/Cargo.lock")).digest("hex");
const expected=readFileSync("src-tauri/Cargo.lock.sha256","utf8").trim();
assert.match(expected,/^[0-9a-f]{64}$/);
assert.equal(actual,expected,"Cargo dependency resolution drift; import reviewed exact lockfile before changing digest");
console.log("Cargo resolution matches reviewed native build");
