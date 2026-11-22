/**
 * Poseidon hash function wrapper
 * Uses circomlibjs for compatibility with circuits
 */

import { ByteLength, ByteUtils } from "./bytes.js";

// Poseidon instance (lazy initialized)
let poseidonInstance: any = null;
let poseidonPromise: Promise<any> | null = null;
let externalPoseidonBuilder: (() => Promise<any>) | null = null;

/**
 * Set external Poseidon builder (for browser environments)
 * Call this with circomlibjs.buildPoseidon before using the SDK
 */
export function setPoseidonBuilder(builder: () => Promise<any>): void {
  externalPoseidonBuilder = builder;
  // Reset promise so it uses the new builder
  poseidonPromise = null;
  poseidonInstance = null;
}

/**
 * Set a pre-built Poseidon instance directly
 */
export function setPoseidonInstance(instance: any): void {
  poseidonInstance = instance;
  poseidonPromise = Promise.resolve(instance);
}

/**
 * Find buildPoseidon function from circomlibjs module
 */
function findBuildPoseidon(mod: any): (() => Promise<any>) | null {
  // Try various ways the function might be exported
  if (typeof mod === "function") return mod;
  if (typeof mod?.buildPoseidon === "function") return mod.buildPoseidon;
  if (typeof mod?.default === "function") return mod.default;
  if (typeof mod?.default?.buildPoseidon === "function")
    return mod.default.buildPoseidon;

  // Check if it's a named export
  for (const key of Object.keys(mod || {})) {
    if (
      key.toLowerCase().includes("poseidon") &&
      typeof mod[key] === "function"
    ) {
      return mod[key];
    }
  }

  return null;
}

/**
 * Initialize and get Poseidon instance
 */
async function getPoseidon(): Promise<any> {
  if (poseidonInstance) {
    return poseidonInstance;
  }

  if (!poseidonPromise) {
    poseidonPromise = (async () => {
      // Method 0: Use externally provided builder (browser)
      if (externalPoseidonBuilder) {
        try {
          poseidonInstance = await externalPoseidonBuilder();
          return poseidonInstance;
        } catch (e) {
          console.warn("External Poseidon builder failed:", e);
        }
      }

      let lastError: Error | null = null;

      // Method 1: Dynamic import
      try {
        const circomlibjs = await import("circomlibjs");
        const buildPoseidon = findBuildPoseidon(circomlibjs);

        if (buildPoseidon) {
          poseidonInstance = await buildPoseidon();
          return poseidonInstance;
        }
      } catch (e) {
        lastError = e as Error;
      }

      // Method 2: Check if already loaded globally (browser)
      try {
        if (typeof (globalThis as any).circomlibjs !== "undefined") {
          const buildPoseidon = findBuildPoseidon(
            (globalThis as any).circomlibjs
          );
          if (buildPoseidon) {
            poseidonInstance = await buildPoseidon();
            return poseidonInstance;
          }
        }
      } catch (e) {
        lastError = e as Error;
      }

      throw new Error(
        `Failed to load circomlibjs: ${
          lastError?.message || "Unknown error"
        }. In browser, call setPoseidonBuilder() first.`
      );
    })();
  }

  return poseidonPromise;
}

/**
 * Initialize Poseidon (call when ready)
 * This is lazy - it doesn't run until accessed
 */
let _initPoseidonPromise: Promise<any> | null = null;

export function getInitPoseidonPromise(): Promise<any> {
  if (!_initPoseidonPromise) {
    _initPoseidonPromise = getPoseidon();
  }
  return _initPoseidonPromise;
}

// For backwards compatibility - but lazy now
export const initPoseidonPromise: Promise<any> = {
  then: (resolve: any, reject: any) =>
    getInitPoseidonPromise().then(resolve, reject),
  catch: (reject: any) => getInitPoseidonPromise().catch(reject),
  finally: (callback: any) => getInitPoseidonPromise().finally(callback),
} as Promise<any>;

/**
 * Poseidon hash function for bigint inputs
 * @param args Array of bigint values to hash
 * @returns Poseidon hash as bigint
 */
export async function poseidonAsync(args: bigint[]): Promise<bigint> {
  const poseidon = await getPoseidon();
  const hash = poseidon(args);
  return poseidon.F.toObject(hash);
}

/**
 * Synchronous Poseidon hash (requires prior initialization)
 */
export function poseidon(args: bigint[]): bigint {
  if (!poseidonInstance) {
    throw new Error(
      "Poseidon not initialized. Call initPoseidonPromise first."
    );
  }
  const hash = poseidonInstance(args);
  return poseidonInstance.F.toObject(hash);
}

/**
 * Poseidon hash for hex string inputs
 * @param args Array of hex strings (with or without 0x prefix)
 * @returns Poseidon hash as hex string (no prefix)
 */
export async function poseidonHexAsync(args: string[]): Promise<string> {
  const bigintArgs = args.map((x) => ByteUtils.hexToBigInt(x));
  const result = await poseidonAsync(bigintArgs);
  return ByteUtils.nToHex(result, ByteLength.UINT_256, true); // Include 0x prefix
}

/**
 * Synchronous Poseidon hash for hex strings
 */
export function poseidonHex(args: string[]): string {
  const bigintArgs = args.map((x) => ByteUtils.hexToBigInt(x));
  const result = poseidon(bigintArgs);
  return ByteUtils.nToHex(result, ByteLength.UINT_256, true); // Include 0x prefix
}

/**
 * Get the raw Poseidon instance for direct use with EdDSA
 */
export async function getPoseidonInstance(): Promise<any> {
  return getPoseidon();
}
