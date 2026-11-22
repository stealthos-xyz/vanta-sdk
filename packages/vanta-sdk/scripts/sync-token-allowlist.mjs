import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const canonical = resolve(root, "../sdk/src/vanta/token-allowlist.json");
const data = JSON.parse(await readFile(canonical, "utf8"));
const addr = /^0x[0-9a-fA-F]{40}$/;
const chains = new Set();
if (data.schema !== "stealthos-vanta-token-allowlist-v1" || !Number.isSafeInteger(data.version) || data.version < 1 ||
    !Array.isArray(data.networks) || !data.networks.length)
  throw Error("Invalid canonical Vanta token allowlist.");
for (const network of data.networks) {
  if (!Number.isSafeInteger(network.chainId) || network.chainId <= 0 ||
      chains.has(network.chainId) || !Array.isArray(network.tokens) || !network.tokens.length)
    throw Error("Invalid or duplicate Vanta allowlist network.");
  chains.add(network.chainId);
  const ids = new Set(), addresses = new Set();
  for (const token of network.tokens) {
    if (typeof token.id !== "string" || !/^[a-z][a-z0-9-]{1,63}$/.test(token.id) ||
        !["native", "erc20"].includes(token.kind) || !addr.test(token.tokenAddress) ||
        typeof token.symbol !== "string" || !/^[A-Z0-9-]{1,16}$/.test(token.symbol) ||
        !Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 36 ||
        ids.has(token.id) || addresses.has(token.tokenAddress.toLowerCase()) ||
        ((token.tokenAddress.toLowerCase() === "0x" + "0".repeat(40)) !== (token.kind === "native")))
      throw Error("Invalid or duplicate Vanta allowlist token.");
    ids.add(token.id); addresses.add(token.tokenAddress.toLowerCase());
  }
}
const json = JSON.stringify(data, null, 2) + "\n";
const generated = "// Generated from token-allowlist.json by the standalone SDK sync script.\n" +
  "export const VANTA_TOKEN_ALLOWLIST_DATA = " + JSON.stringify(data, null, 2) + " as const;\n";
const outputs = [
  [resolve(root, "../sdk/src/vanta/token-allowlist-data.ts"), generated],
  [resolve(root, "token-allowlist.json"), json],
];
for (const [filename, contents] of outputs) {
  if (process.argv.includes("--check")) {
    if (await readFile(filename, "utf8") !== contents)
      throw Error("Stale Vanta allowlist snapshot; run npm run sync:token-allowlist.");
  } else await writeFile(filename, contents);
}
console.log("Vanta token allowlist SHA-256: " + createHash("sha256").update(json).digest("hex"));
