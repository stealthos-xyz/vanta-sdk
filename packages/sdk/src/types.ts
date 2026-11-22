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

// ============== NOTE TYPES ==============

/**
 * Private note (UTXO) - one leaf of the shielded pool's Merkle tree.
 *
 * The leaf is exactly Poseidon(npk, tokenHash, value); the pool, the circuit
 * (base-decider/src/joinsplit.rs) and the wallet all agree on that and nothing
 * else about a note is on chain. `random` is the only secret needed to
 * re-derive `npk` from the owner's master public key, so it is spend-capable
 * material and must never leave the client.
 */
export interface Note {
  // Public (on-chain as the tree leaf)
  commitment: string; // Poseidon(npk, tokenHash, value), 0x-prefixed
  leafIndex?: number; // Position in Merkle tree; required to nullify

  // Note public key: Poseidon(masterPublicKey, random)
  npk: string;

  // Tree-scoped token domain computed by ShieldedPoolJoinSplit
  tokenHash: string;

  // Value in the token's base units
  value: bigint;

  // Private blinding factor (canonical BN254 field element, 0x-prefixed)
  random: string;

  // Token address the tokenHash was derived for (0x0 for ETH)
  token: string;
}

/**
 * Encrypted note for storage/transmission
 * SECURITY: Only recipient can decrypt using viewing key
 *
 * The payload is a fixed-length record, so ciphertext length reveals nothing
 * about the value. Version, both public keys, the commitment and the timestamp
 * are bound as GCM associated data, so none of them can be rewritten in
 * transit and a ciphertext cannot be replayed against another commitment.
 */
export interface EncryptedNote {
  // Envelope format version, authenticated via AAD
  version: number;

  // ECDH ephemeral public key (sender's one-time key)
  ephemeralPubKey: string; // 32 bytes hex

  // Sender's static X25519 viewing public key. The KDF absorbs the static
  // sender-recipient shared secret, so a decryptable envelope proves the
  // sender held the matching private key.
  senderPubKey: string; // 32 bytes hex

  // AES-256-GCM encrypted payload
  iv: string; // 12 bytes hex
  ciphertext: string; // Fixed length hex
  authTag: string; // 16 bytes hex

  // Metadata (public, authenticated)
  commitment: string; // The commitment this encrypts
  timestamp: number;
}

// ============== TRANSACTION TYPES ==============

// ============== PROOF TYPES ==============

// ============== API TYPES ==============
