/**
 * Baby Jubjub group operations, in circomlib's coordinate representation.
 *
 * The joinsplit circuit proves knowledge of the EdDSA secret scalar `a` behind
 * a note's public key: `A == a * Base8` (base-decider/src/joinsplit.rs). A
 * spending public key that is not a real curve point can therefore never be
 * spent, so every point this module returns is checked to be on the curve and
 * in the prime-order subgroup before it leaves.
 */

import { BABYJUBJUB_SUBORDER } from "./field.js";

let babyJubInstance: any = null;
let babyJubPromise: Promise<any> | null = null;

async function getBabyJub(): Promise<any> {
  if (babyJubInstance) return babyJubInstance;
  if (!babyJubPromise) {
    babyJubPromise = (async () => {
      const circomlibjs = await import("circomlibjs");
      const build =
        (circomlibjs as any)?.buildBabyjub ??
        (circomlibjs as any)?.default?.buildBabyjub;
      if (typeof build !== "function") {
        throw new Error("circomlibjs does not expose buildBabyjub");
      }
      babyJubInstance = await build();
      return babyJubInstance;
    })();
  }
  return babyJubPromise;
}

/** Affine Baby Jubjub point as BN254 field elements. */
export type BabyJubjubPoint = [bigint, bigint];

/**
 * Bit width the circuit range-checks the spend secret to
 * (babyjubjub::SPEND_SCALAR_BIT_LEN). circomlibjs derives EdDSA scalars as
 * `prune(blake512(prv)) >> 3`, which can exceed the subgroup order but never
 * 2^252; double-and-add over those bits still computes
 * `(a mod subOrder) * Base8`, so the circuit accepts the wider range.
 */
const SPEND_SCALAR_BOUND = 1n << 252n;

/**
 * `scalar * Base8`, the only correct way to obtain a spending public key.
 *
 * The scalar must be provable in-circuit, so it is held to the same 252-bit
 * bound the circuit enforces, and it must not reduce to zero — that yields the
 * identity, which is an unspendable key.
 */
export async function scalarMultBase8(
  scalar: bigint
): Promise<BabyJubjubPoint> {
  if (scalar <= 0n || scalar >= SPEND_SCALAR_BOUND) {
    throw new Error(
      "Baby Jubjub scalar must be nonzero and below the 252-bit circuit bound"
    );
  }
  if (scalar % BABYJUBJUB_SUBORDER === 0n) {
    throw new Error("Baby Jubjub scalar reduces to the identity");
  }
  const babyJub = await getBabyJub();
  const point = babyJub.mulPointEscalar(babyJub.Base8, scalar);
  if (!babyJub.inCurve(point) || !babyJub.inSubgroup(point)) {
    throw new Error("Derived Baby Jubjub point is not in the prime-order subgroup");
  }
  return [babyJub.F.toObject(point[0]), babyJub.F.toObject(point[1])];
}
