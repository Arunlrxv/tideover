// Builds the contracts as small as they go, because on NEAR every byte of code locks
// storage: about 0.01 NEAR per kilobyte. This takes the fund from 479 KB to 340 KB.
//
//   npm run build:contracts
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROOT, WASM_DIR, log } from "./lib.mjs";

const CONTRACTS = ["tideover-fund", "tideover-factory", "tideover-test-usd"];
const target = process.env.CARGO_TARGET_DIR ?? join(ROOT, "target");
const built = join(target, "wasm32-unknown-unknown", "contract");
const wasmOpt = join(ROOT, "web", "node_modules", "binaryen", "bin", "wasm-opt");
// The features rustc turns on by default, and NEAR accepts from protocol 84.
const FEATURES = ["bulk-memory", "sign-ext", "reference-types", "mutable-globals", "nontrapping-float-to-int", "multivalue"];

execFileSync("cargo", ["build", "--profile", "contract", "--target", "wasm32-unknown-unknown", ...CONTRACTS.flatMap((c) => ["-p", c])], {
  cwd: ROOT,
  stdio: "inherit",
});

mkdirSync(WASM_DIR, { recursive: true });
for (const contract of CONTRACTS) {
  const file = `${contract.replaceAll("-", "_")}.wasm`;
  const out = join(WASM_DIR, file);
  execFileSync(
    process.execPath,
    [wasmOpt, "-Oz", ...FEATURES.map((f) => `--enable-${f}`), "--strip-debug", "--strip-producers", "-o", out, join(built, file)],
    { stdio: "inherit" },
  );
  log(file, `${Math.round(statSync(out).size / 1024)} KiB`);
}
