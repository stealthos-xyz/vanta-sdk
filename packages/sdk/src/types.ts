/**
 * StealthOS B2B SDK - Core Types
 *
 * SECURITY: These types define the data structures for private transactions.
 * All sensitive data (secrets, nullifiers, keys) MUST remain on the client.
 */

// ============== KEY TYPES ==============

/**
 * Master wallet keys derived from seed
 * SECURITY: These keys MUST NEVER leave the client device
 */
export interface StealthKeys {
  // Master seed (from mnemonic OR wallet signature)
  masterSeed: Uint8Array;

  // Spending key - authorizes transactions (BabyJubJub for circuit compatibility)
  spendingPrivateKey: Uint8Array;

  // Baby Jubjub scalar `a` with spendingPublicKey == a * Base8. The joinsplit
  // circuit proves knowledge of exactly this value, so it is the spend
  // authority itself: never log, persist unencrypted, or transmit it.
  spendSecretScalar: bigint;

  spendingPublicKey: [bigint, bigint];

  // Viewing key - decrypts notes (X25519 for ECDH)
  viewingPrivateKey: Uint8Array;
  viewingPublicKey: Uint8Array;

  // Nullifying key - computes nullifiers (Poseidon derived)
  nullifyingKey: bigint;

  // Master public key - identifies user (Poseidon hash)
  masterPublicKey: bigint;

  // Stealth address - shareable address (Bech32m encoded: 0zk1...)
  stealthAddress: string;
}

/**
 * Public address data (safe to share)
 */
export interface AddressData {
  masterPublicKey: bigint;
  viewingPublicKey: Uint8Array;
  chain?: ChainData;
  version?: number;
}

/**
 * Chain identifier
 */
interface ChainData {
  type: number; // 0 = EVM
  id: number; // Chain ID
}
