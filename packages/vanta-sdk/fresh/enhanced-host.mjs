/** Public wallet/agent host. No caller-provided readiness or enabled override. */
import { assertFreshPayoutExecutionReady } from "./payouts.mjs";
import { createEnhancedWithdrawalHostCore, EnhancedWithdrawalHostError, enhancedExact,
  isEnhancedWithdrawalHost } from "./enhanced-host-core.mjs";

export { EnhancedWithdrawalHostError };

export function createEnhancedWithdrawalHost(options) {
  // Enhanced production artifacts are not frozen/activated. The existing
  // compiled gate stays closed regardless of runtime callbacks or tool input.
  return createEnhancedWithdrawalHostCore(options, () => assertFreshPayoutExecutionReady());
}

const freeze = value => {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const object = properties => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const identifier = { type: "string", pattern: "^[A-Za-z0-9_-]{1,128}$" };
const definitions = [
  ["enhanced.availability", null, "Read this authenticated host's enhanced withdrawal availability.", object({})],
  ["enhanced.prepare", "prepare", "Prepare a private exact net withdrawal review within delegated limits. Does not authorize spending.",
    object({ amountAtomic: { type: "string", pattern: "^[1-9][0-9]{0,36}$" }, destination: { type: "string" } })],
  ["enhanced.authorize", "authorize", "Authorize one previously reviewed exact intent. This is the only user authorization; claims need no further signature.", object({ intentId: identifier })],
  ["enhanced.monitor", "monitor", "Read current verified progress for an owned private transaction.", object({ transactionId: identifier })],
  ["enhanced.list", "monitor", "List only this authenticated subject's durable transaction history.", object({})],
  ["enhanced.recover", "recover", "Recover the original fixed payment obligations without another user signature.", object({ transactionId: identifier })],
];

/** Transport-neutral MCP shape. Only application bootstrap may select the
 * host and tool permissions. Models cannot choose a pool, key, signer, URL,
 * arbitrary transaction, readiness flag or another account's journal. */
export function createEnhancedWithdrawalAgentTools(options) {
  enhancedExact(options, ["host", "permissions"]);
  const { host, permissions } = options;
  if (!isEnhancedWithdrawalHost(host) || !Array.isArray(permissions) ||
      permissions.some(value => !["prepare", "authorize", "monitor", "recover"].includes(value)) ||
      new Set(permissions).size !== permissions.length || Reflect.ownKeys(permissions).length !== permissions.length + 1)
    throw new EnhancedWithdrawalHostError("INVALID_ARGUMENT");
  const allowed = new Set(permissions);
  return Object.freeze({ tools: freeze(definitions.filter(([, permission]) => permission === null || allowed.has(permission))
    .map(([name, , description, inputSchema]) => ({ name, description, inputSchema }))),
  async invoke(name, input) {
    try {
      const definition = definitions.find(value => value[0] === name);
      if (!definition || (definition[1] !== null && !allowed.has(definition[1])))
        throw new EnhancedWithdrawalHostError("PERMISSION_DENIED");
      let result;
      if (name === "enhanced.availability") { enhancedExact(input, []); result = host.getAvailability(); }
      else if (name === "enhanced.list") { enhancedExact(input, []); result = await host.list(); }
      else result = await host[name.slice("enhanced.".length)](input);
      return freeze({ isError: false, content: [{ type: "text", text: JSON.stringify(result) }] });
    } catch (error) {
      const code = error instanceof EnhancedWithdrawalHostError ? error.code : "RUNTIME_UNAVAILABLE";
      return freeze({ isError: true, content: [{ type: "text", text: JSON.stringify({ status: "rejected", code, retryable: false }) }] });
    }
  } });
}
