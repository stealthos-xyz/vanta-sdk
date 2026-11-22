/**
 * BN254 scalar-field helpers shared by every value that reaches the circuit.
 *
 * SECURITY CRITICAL: the circuit, the pool and Poseidon all work modulo the
 * BN254 scalar field. A value handed in above the modulus is silently reduced,
 * so the bytes an owner stored stop matching the field element their note was
 * actually committed to — the note becomes unopenable. Everything canonical is
 * enforced here rather than at each call site.
 */

import { randomBytes } from "@noble/hashes/utils";

export const BN254_FR_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** Order of Baby Jubjub's prime-order subgroup, in circomlib's parameters. */
export const BABYJUBJUB_SUBORDER =
  2736030358979909402780800718157159386076813972158567259200215660948447373041n;

/** BN254's modulus is 254 bits, so a 254-bit draw needs the fewest retries. */
const FIELD_SAMPLE_BITS = 254n;
const FIELD_SAMPLE_MASK = (1n << FIELD_SAMPLE_BITS) - 1n;

/**
 * Bound on rejection-sampling retries. Acceptance is ~76% per draw, so 64
 * consecutive failures cannot happen with a working CSPRNG; if it does, the
 * entropy source is broken and returning a value anyway would be worse.
 */
const MAX_SAMPLE_ATTEMPTS = 64;

export function isCanonicalField(value: bigint): boolean {
  return value >= 0n && value < BN254_FR_MODULUS;
}

export function assertCanonicalField(value: bigint, label: string): bigint {
  if (!isCanonicalField(value)) {
    throw new Error(`${label} is outside the BN254 scalar field`);
  }
  return value;
}

/**
 * Assert the platform exposes a CSPRNG before any secret is drawn.
 *
 * @noble/hashes throws when `crypto.getRandomValues` is missing rather than
 * degrading to `Math.random`, so this is a clearer failure, not a new one.
 */
export function assertCsprngAvailable(): void {
  // Structurally typed: the package targets ES2020 without the DOM lib, so it
  // must not depend on the ambient `Crypto` interface being declared.
  const webCrypto = (globalThis as { crypto?: { getRandomValues?: unknown } })
    .crypto;
  if (!webCrypto || typeof webCrypto.getRandomValues !== "function") {
    throw new Error(
      "No cryptographically secure RNG available: crypto.getRandomValues is required"
    );
  }
}

/**
 * Draw a uniform nonzero BN254 field element from the platform CSPRNG.
 *
 * Rejection sampling, not `randomBytes(32) % r`: a 32-byte draw covers about
 * 5.3 copies of the field, so ~81% of raw draws exceed the modulus and get
 * silently folded. Masking to 254 bits first raises acceptance to ~76% per
 * attempt and keeps the distribution flat.
 */
export function randomFieldElement(): bigint {
  assertCsprngAvailable();
  for (let attempt = 0; attempt < MAX_SAMPLE_ATTEMPTS; attempt += 1) {
    const candidate = bytesToBigIntBE(randomBytes(32)) & FIELD_SAMPLE_MASK;
    if (candidate !== 0n && candidate < BN254_FR_MODULUS) return candidate;
  }
  throw new Error("Failed to sample a canonical field element from the CSPRNG");
}

/** Big-endian byte decoding, matching how the SDK hexlifies field elements. */
export function bytesToBigIntBE(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}

/**
 * Reduce wide key-derivation output into a nonzero residue mod `modulus`.
 *
 * Callers must pass at least 128 extra bits over the modulus so the modulo
 * bias is negligible; a 32-byte input would bias the low fifth of the field.
 */
export function reduceToNonzeroResidue(
  wide: Uint8Array,
  modulus: bigint,
  label: string
): bigint {
  if (wide.length < 48) {
    throw new Error(`${label} needs at least 48 bytes of entropy to reduce`);
  }
  const reduced = bytesToBigIntBE(wide) % modulus;
  if (reduced === 0n) throw new Error(`${label} reduced to zero`);
  return reduced;
}
