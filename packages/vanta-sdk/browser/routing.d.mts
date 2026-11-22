export interface FamilyRelayRouting {readonly networkId: 'eip155:6281971'; readonly generationId: string; readonly pool: string;}
export const FAMILY_ROUTING_HEADERS: readonly string[];
export function readFamilyRelayRouting(input?: HeadersInit): FamilyRelayRouting | null;
export function familyRelayRoutingHeaders(context: {networkId: string; generationId: string; pool: string}): Record<string, string>;
export function assertFamilyRelayContext(routing: FamilyRelayRouting | null, context: {networkId: string; generationId: string; pool: string} | null): FamilyRelayRouting;
