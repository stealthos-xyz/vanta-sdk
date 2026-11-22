/** Internal candidate interfaces. No production package export. */
export interface FamilyNoteDomain {
  readonly schema: "vanta-family-note-domain-v1";
  readonly safeForFunds: false;
  readonly familyTag: string;
  readonly chainId: 6281971;
  readonly genesisHash: string;
  readonly generationId: string;
  readonly setupId: string;
  readonly pool: string;
  readonly asset: string;
  readonly poolCodehash: string;
  readonly nativeGlueSha256: string;
  readonly nativeWasmSha256: string;
}
export interface FamilyNoteOpening {
  readonly schema: "vanta-family-note-opening-v1";
  readonly npk: string;
  readonly commitment: string;
  readonly random: string;
  readonly token_hash: string;
  readonly amount_units: string;
  readonly nonspendable: boolean;
  readonly chain_id: 6281971;
  readonly family_tag: string;
  readonly research_only: true;
  readonly safe_for_funds: false;
}
export interface FamilyNoteRecipient {
  readonly schema: "vanta-family-note-recipient-v1";
  readonly familyTag: string;
  readonly chainId: 6281971;
  readonly genesisHash: string;
  readonly generationId: string;
  readonly setupId: string;
  readonly pool: string;
  readonly asset: string;
  readonly masterPublicKey: string;
  readonly viewingPublicKey: string;
}
export interface FamilyNoteWallet {
  /** The local adapter validates the existing wallet's opaque private result. */
  privateWalletKeys(): Promise<unknown>;
}
export interface FamilyNoteEngine {
  readonly glueSha256: string;
  readonly wasmSha256: string;
  createVantaFamilyOwnedNote(request: unknown): string;
  createVantaFamilyRecipientNote(request: unknown): string;
  verifyVantaFamilyOwnedNote(request: unknown): string;
  verifyVantaFamilyRecipientNote(request: unknown): string;
}
export interface FamilyOwnedNoteVerification {
  readonly commitment: string;
  readonly masterPublicKey: string;
  readonly nullifier: string | null;
  readonly nonspendable: boolean;
}
export const FAMILY_PRIVATE_MEMO_MAX_BYTES:80;
export function normalizeFamilyPrivateMemo(value?:string):string|undefined;
export class FamilyNoteDeliveryError extends Error { readonly code: string; }
export function validateFamilyNoteDomain(raw: FamilyNoteDomain): Readonly<FamilyNoteDomain>;
export function familyNoteTokenHash(raw: FamilyNoteDomain): string;
export function createFamilyNoteDelivery(input: { domain: FamilyNoteDomain; engine: FamilyNoteEngine }): Readonly<{
  context: Readonly<FamilyNoteDomain>;
  tokenHash: string;
  walletRecipient(wallet: FamilyNoteWallet): Promise<Readonly<FamilyNoteRecipient>>;
  createOwnedNote(input: { wallet: FamilyNoteWallet; amountAtomic: string }): Promise<Readonly<FamilyNoteOpening>>;
  createRecipientNote(input: { recipient: FamilyNoteRecipient; amountAtomic: string }): Readonly<FamilyNoteOpening>;
  verifyRecipientNote(input: { recipient: FamilyNoteRecipient; note: FamilyNoteOpening }): Readonly<FamilyNoteOpening>;
  verifyOwnedNote(input: { wallet: FamilyNoteWallet; note: FamilyNoteOpening }): Promise<Readonly<FamilyOwnedNoteVerification>>;
  encrypt(input: { recipient: FamilyNoteRecipient; note: FamilyNoteOpening; memo?:string }): Promise<string>;
  decrypt(input: { wallet: FamilyNoteWallet; envelope: string; commitment: string }): Promise<Readonly<{
    note: Readonly<FamilyNoteOpening>; verification: Readonly<FamilyOwnedNoteVerification>; memo?:string;
  }> | null>;
}>;
