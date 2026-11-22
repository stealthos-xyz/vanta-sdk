/** Public routing hints only. Callers must compare these with compiled pins;
 * this module never accepts a URL, credential, artifact or deployment manifest. */
export const FAMILY_ROUTING_HEADERS = Object.freeze([
  'X-StealthOS-Network', 'X-StealthOS-Generation', 'X-StealthOS-Pool',
]);
export function readFamilyRelayRouting(input) {
  const headers = new Headers(input), values = FAMILY_ROUTING_HEADERS.map(name => headers.get(name));
  if (values.every(value => value === null)) return null;
  const [networkId, generationId, pool] = values;
  if (!/^eip155:[1-9][0-9]*$/u.test(networkId ?? '') || !/^0x[0-9a-f]{64}$/u.test(generationId ?? '') ||
      !/^0x[0-9a-fA-F]{40}$/u.test(pool ?? '') || BigInt(pool) === 0n)
    throw Error('Invalid family relay context.');
  return Object.freeze({networkId, generationId, pool: pool.toLowerCase()});
}
export function familyRelayRoutingHeaders(context) {
  const headers = Object.fromEntries(FAMILY_ROUTING_HEADERS.map((name, i) =>
    [name, [context?.networkId, context?.generationId, context?.pool][i]]));
  readFamilyRelayRouting(headers);
  return headers;
}
export function assertFamilyRelayContext(routing, context) {
  if (!routing || routing.networkId !== context?.networkId || routing.generationId !== context?.generationId ||
      routing.pool !== context?.pool?.toLowerCase()) throw Error('Family relay context changed.');
  return routing;
}
