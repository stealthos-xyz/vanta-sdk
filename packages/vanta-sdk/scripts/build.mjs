import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const canonical = resolve(root, "../sdk/src");
const staged = resolve(root, ".build-src");
// Compile only the canonical modules consumed by the delivered fresh SDK.
// The wallet bundle resolves its selected crypto imports directly from source.
const sources = [
  "vanta/token-allowlist.ts",
  "vanta/token-allowlist-data.ts",
  "vanta/token-policy.ts",
];

const allowlistCheck = spawnSync(process.execPath, [resolve(root, "scripts/sync-token-allowlist.mjs"), "--check"], { stdio: "inherit" });
if (allowlistCheck.error || allowlistCheck.status !== 0)
  throw Error("Canonical Vanta token allowlist snapshots must be synchronized before build.");

await rm(staged, { recursive: true, force: true });
// Never package stale privileged operator modules from a previous build.
await rm(resolve(root, "dist"), { recursive: true, force: true });
try {
  for (const source of sources) {
    const target = resolve(staged, source);
    await mkdir(dirname(target), { recursive: true });
    await cp(resolve(canonical, source), target, { recursive: true });
  }
  // Resolve through Node ESM so npm-workspace hoisting does not break the build.
  const tsc = fileURLToPath(import.meta.resolve("typescript/bin/tsc"));
  const result = spawnSync(process.execPath, [tsc, "-p", "tsconfig.json"], {
    cwd: root, stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  else {
    await import("./build-runtime.mjs");
    await import("./build-family-proof-driver.mjs");
    await import("./build-fresh-wallet.mjs");
    await import("./build-browser.mjs");
    // Recovery is delivered only through its fresh, bundled entry point. Do
    // not leave generic recovery or the erased type dependency callable in dist.
    for (const name of ["canonical-recovery", "fresh-rpc-recovery", "fee-authorization"]) {
      for (const extension of [".js", ".js.map", ".d.ts", ".d.ts.map"])
        await rm(resolve(root, "dist/vanta", name + extension), { force: true });
    }
  }
} finally {
  await rm(staged, { recursive: true, force: true });
}
