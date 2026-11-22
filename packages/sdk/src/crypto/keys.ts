/**
 * StealthOS B2B SDK - Key Management
 *
 * SECURITY CRITICAL: This module handles all key derivation.
 * - Keys NEVER leave the client
 * - All derivation uses HKDF with domain separation
 * - Constant-time operations where possible
 */

import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { x25519 } from "@noble/curves/ed25519";
import { randomBytes } from "@noble/hashes/utils";
import { ByteUtils, ByteLength } from "./bytes.js";
import { poseidonAsync } from "./poseidon.js";
import { scalarMultBase8 } from "./babyjubjub.js";
import {
  BABYJUBJUB_SUBORDER,
  BN254_FR_MODULUS,
  assertCanonicalField,
  assertCsprngAvailable,
  reduceToNonzeroResidue,
} from "./field.js";
import { StealthKeys, AddressData } from "../types.js";

// Domain separation constants for HKDF
const DOMAIN_SPENDING = "stealthos-spending-key-v1";
const DOMAIN_SPEND_SCALAR = "stealthos-spend-scalar-v1";
const DOMAIN_VIEWING = "stealthos-viewing-key-v1";
const DOMAIN_NULLIFYING = "stealthos-nullifying-key-v1";

/** Wide enough that reducing into either group order carries no usable bias. */
const WIDE_DERIVATION_BYTES = 64;

/**
 * Generate cryptographically secure random bytes
 * SECURITY: Uses system CSPRNG
 */
export function secureRandomBytes(length: number): Uint8Array {
  assertCsprngAvailable();
  return randomBytes(length);
}

function expand(
  secret: Uint8Array,
  domain: string,
  length: number
): Uint8Array {
  return hkdf(
    sha256,
    secret,
    new Uint8Array(0), // no salt for determinism
    new TextEncoder().encode(domain),
    length
  );
}

/**
 * Generate random hex string
 *
 * Raw bytes only. Never use this for a value that will be interpreted as a
 * BN254 field element — a 32-byte draw exceeds the modulus ~81% of the time and
 * is then silently reduced. Use `randomFieldElement` for note secrets.
 */
export function secureRandomHex(byteLength: number): string {
  return ByteUtils.fastBytesToHex(secureRandomBytes(byteLength));
}

/**
 * Derive stealth keys from master seed
 *
 * Key Hierarchy:
 * masterSeed (32 bytes)
 *   ├── spendingKey    = HKDF(masterSeed, "stealthos-spending-key-v1")
 *   │     └── spendSecretScalar = HKDF(spendingKey, "stealthos-spend-scalar-v1") mod l
 *   │           └── spendingPubKey = spendSecretScalar * Base8   (Baby Jubjub)
 *   ├── viewingKey     = HKDF(masterSeed, "stealthos-viewing-key-v1")
 *   └── nullifyingKey  = HKDF(masterSeed, "stealthos-nullifying-key-v1") mod r
 *
 * masterPublicKey = Poseidon(spendingPubKey[0], spendingPubKey[1], nullifyingKey)
 *
 * @param masterSeed - 32-byte master seed
 * @returns StealthKeys object with all derived keys
 */
export async function deriveKeysFromSeed(
  masterSeed: Uint8Array
): Promise<StealthKeys> {
  if (masterSeed.length !== 32) {
    throw new Error("Master seed must be 32 bytes");
  }

  // Derive spending private key using HKDF
  const spendingPrivateKey = expand(masterSeed, DOMAIN_SPENDING, 32);

  // Derive viewing private key using HKDF
  const viewingPrivateKey = expand(masterSeed, DOMAIN_VIEWING, 32);

  // Derive viewing public key (X25519)
  const viewingPublicKey = x25519.getPublicKey(viewingPrivateKey);

  // The circuit proves A == a * Base8 for the note's public key, so `a` is the
  // spending authority and A must be a real curve point. Hashing the private
  // key into a pair of field elements produces coordinates off the curve, and
  // every note addressed to them is unspendable.
  const spendSecretScalar = reduceToNonzeroResidue(
    expand(spendingPrivateKey, DOMAIN_SPEND_SCALAR, WIDE_DERIVATION_BYTES),
    BABYJUBJUB_SUBORDER,
    "spend secret scalar"
  );
  const spendingPublicKey = await scalarMultBase8(spendSecretScalar);

  // Nullifying key gets its own path: it must stay out of a shared viewing key,
  // because nk plus a leaf index is exactly what links a note to its spend.
  const nullifyingKey = reduceToNonzeroResidue(
    expand(masterSeed, DOMAIN_NULLIFYING, WIDE_DERIVATION_BYTES),
    BN254_FR_MODULUS,
    "nullifying key"
  );

  // Compute master public key = Poseidon(spendingPubKey[0], spendingPubKey[1], nullifyingKey)
  const masterPublicKey = await poseidonAsync([
    spendingPublicKey[0],
    spendingPublicKey[1],
    nullifyingKey,
  ]);

  // Encode stealth address
  const addressData: AddressData = {
    masterPublicKey,
    viewingPublicKey,
  };
  const stealthAddress = encodeStealthAddress(addressData);

  return {
    masterSeed,
    spendingPrivateKey,
    spendSecretScalar,
    spendingPublicKey,
    viewingPrivateKey,
    viewingPublicKey,
    nullifyingKey,
    masterPublicKey,
    stealthAddress,
  };
}

/**
 * Derive keys from an Ethereum wallet signature
 * This allows users to use their existing wallet without a separate mnemonic
 *
 * @param signature - Signature of a fixed message
 * @returns StealthKeys object
 */
export async function deriveKeysFromSignature(
  signature: string
): Promise<StealthKeys> {
  // Hash the signature to get 32 bytes of entropy
  const signatureBytes = ByteUtils.hexStringToBytes(
    ByteUtils.strip0x(signature)
  );
  const masterSeed = sha256(signatureBytes);

  return deriveKeysFromSeed(masterSeed);
}

/**
 * Message to sign for key derivation
 * SECURITY: This message must be unique and clearly identify the purpose
 */
export const KEY_DERIVATION_MESSAGE = `StealthOS Wallet Derivation

Sign this message to generate your private StealthOS wallet.

This signature will be used to derive your:
- Stealth address (for receiving private transfers)
- Viewing key (for decrypting notes meant for you)
- Spending key (for authorizing transfers)

⚠️ NEVER share this signature with anyone!
⚠️ Only sign this on stealthos.xyz

Domain: stealthos.xyz
Version: 1`;

// ============== STEALTH ADDRESS ENCODING ==============

import { bech32m } from "@scure/base";

const ADDRESS_PREFIX = "0zk";
const ADDRESS_VERSION = 1;
const ADDRESS_LENGTH_LIMIT = 127;
const ALL_CHAINS_NETWORK_ID = "ffffffffffffffff";

/**
 * Encode stealth address to Bech32m string
 * Format: 0zk1[version][masterPublicKey][networkID][viewingPublicKey]
 */
export function encodeStealthAddress(addressData: AddressData): string {
  const masterPublicKey = ByteUtils.nToHex(
    addressData.masterPublicKey,
    ByteLength.UINT_256,
    false
  );
  const viewingPublicKey = ByteUtils.formatToByteLength(
    addressData.viewingPublicKey,
    ByteLength.UINT_256
  );

  const networkID = addressData.chain
    ? getChainNetworkID(addressData.chain)
    : ALL_CHAINS_NETWORK_ID;

  const version = "01";

  // Build address string
  const addressString = `${version}${masterPublicKey}${networkID}${viewingPublicKey}`;
  const addressBuffer = ByteUtils.hexStringToBytes(addressString);

  return bech32m.encode(
    ADDRESS_PREFIX,
    bech32m.toWords(addressBuffer),
    ADDRESS_LENGTH_LIMIT
  );
}

/**
 * Decode Bech32m stealth address
 */
export function decodeStealthAddress(address: string): AddressData {
  if (!address || !address.startsWith(ADDRESS_PREFIX)) {
    throw new Error("Invalid stealth address: must start with 0zk");
  }

  const decoded = bech32m.decode(
    address as `${string}1${string}`,
    ADDRESS_LENGTH_LIMIT
  );

  if (decoded.prefix !== ADDRESS_PREFIX) {
    throw new Error(`Invalid address prefix: expected ${ADDRESS_PREFIX}`);
  }

  const data = ByteUtils.hexlify(bech32m.fromWords(decoded.words));

  // Parse components
  const version = parseInt(data.slice(0, 2), 16);
  const masterPublicKey = ByteUtils.hexToBigInt(data.slice(2, 66));
  const networkID = data.slice(66, 82);
  const viewingPublicKey = ByteUtils.hexStringToBytes(data.slice(82, 146));

  if (version !== ADDRESS_VERSION) {
    throw new Error(`Unsupported address version: ${version}`);
  }
  // A master public key at or above the modulus is not the key the sender
  // thinks it is: Poseidon would reduce it, so the note would be addressed to
  // a different key than the address names.
  assertCanonicalField(masterPublicKey, "Stealth address master public key");
  if (masterPublicKey === 0n) {
    throw new Error("Stealth address master public key must be nonzero");
  }
  if (viewingPublicKey.length !== 32) {
    throw new Error("Stealth address viewing public key must be 32 bytes");
  }

  return {
    masterPublicKey,
    viewingPublicKey,
    version,
    chain:
      networkID !== ALL_CHAINS_NETWORK_ID
        ? parseNetworkID(networkID)
        : undefined,
  };
}

/**
 * Validate stealth address format
 */
export function isValidStealthAddress(address: string): boolean {
  try {
    decodeStealthAddress(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Format stealth address for display (shortened)
 */
export function formatStealthAddress(address: string): string {
  if (address.length < 20) return address;
  return `${address.slice(0, 11)}...${address.slice(-6)}`;
}

// Helper functions
function getChainNetworkID(chain: { type: number; id: number }): string {
  const typeHex = chain.type.toString(16).padStart(2, "0");
  const idHex = chain.id.toString(16).padStart(14, "0");
  return `${typeHex}${idHex}`;
}

function parseNetworkID(networkID: string): { type: number; id: number } {
  return {
    type: parseInt(networkID.slice(0, 2), 16),
    id: parseInt(networkID.slice(2, 16), 16),
  };
}
