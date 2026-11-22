/**
 * Byte manipulation utilities
 * Adapted from Railgun engine
 */

import { ethers } from "ethers";

export enum ByteLength {
  UINT_8 = 1,
  UINT_56 = 7,
  Address = 20,
  UINT_120 = 15,
  UINT_128 = 16,
  UINT_192 = 24,
  UINT_256 = 32,
}

export const FULL_32_BITS = 0xffffffff;

export class ByteUtils {
  /**
   * Convert hex string to bytes
   */
  static hexStringToBytes(hex: string): Uint8Array {
    const stripped = ByteUtils.strip0x(hex);
    const bytes = new Uint8Array(stripped.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(stripped.substring(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }

  /**
   * Convert bytes to hex string (no 0x prefix)
   */
  static fastBytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  /**
   * Strip 0x prefix from hex string
   */
  static strip0x(hex: string): string {
    return hex.startsWith("0x") ? hex.slice(2) : hex;
  }

  /**
   * Add 0x prefix to hex string
   */
  static hexlify(
    data: string | Uint8Array | number,
    prefix: boolean = false
  ): string {
    if (typeof data === "number") {
      const hex = data.toString(16);
      return prefix ? `0x${hex}` : hex;
    }
    if (data instanceof Uint8Array) {
      const hex = ByteUtils.fastBytesToHex(data);
      return prefix ? `0x${hex}` : hex;
    }
    const stripped = ByteUtils.strip0x(data);
    return prefix ? `0x${stripped}` : stripped;
  }

  /**
   * Convert bigint to hex string
   */
  static nToHex(
    n: bigint,
    byteLength: ByteLength,
    prefix: boolean = false
  ): string {
    const hexLength = byteLength * 2;
    let hex = n.toString(16);
    if (hex.length > hexLength) {
      throw new Error(`Number ${n} exceeds ${byteLength} bytes`);
    }
    hex = hex.padStart(hexLength, "0");
    return prefix ? `0x${hex}` : hex;
  }

  /**
   * Convert bigint to bytes
   */
  static nToBytes(n: bigint, byteLength: number): Uint8Array {
    const hex = ByteUtils.nToHex(n, byteLength as ByteLength);
    return ByteUtils.hexStringToBytes(hex);
  }

  /**
   * Convert hex string to bigint
   */
  static hexToBigInt(hex: string): bigint {
    const stripped = ByteUtils.strip0x(hex);
    if (stripped.length === 0) return 0n;
    return BigInt(`0x${stripped}`);
  }

  /**
   * Convert bytes to bigint
   */
  static bytesToN(bytes: Uint8Array): bigint {
    return ByteUtils.hexToBigInt(ByteUtils.fastBytesToHex(bytes));
  }

  /**
   * Pad hex string to byte length
   */
  static padToLength(data: string | number, byteLength: ByteLength): string {
    if (typeof data === "number") {
      return data.toString(16).padStart(byteLength * 2, "0");
    }
    const stripped = ByteUtils.strip0x(data);
    return stripped.padStart(byteLength * 2, "0");
  }

  /**
   * Format to byte length
   */
  static formatToByteLength(
    data: string | Uint8Array,
    byteLength: ByteLength,
    prefix: boolean = false
  ): string {
    let hex: string;
    if (data instanceof Uint8Array) {
      hex = ByteUtils.fastBytesToHex(data);
    } else {
      hex = ByteUtils.strip0x(data);
    }
    const padded = hex.padStart(byteLength * 2, "0");
    return prefix ? `0x${padded}` : padded;
  }

  /**
   * Generate random hex string
   */
  static randomHex(byteLength: number): string {
    const bytes = ethers.randomBytes(byteLength);
    return ByteUtils.fastBytesToHex(bytes);
  }

  /**
   * Combine hex strings
   */
  static combine(hexStrings: string[]): string {
    return hexStrings.map((h) => ByteUtils.strip0x(h)).join("");
  }

  /**
   * Convert to ethers-compatible bytes
   */
  static arrayify(data: string | Uint8Array): Uint8Array {
    if (data instanceof Uint8Array) return data;
    return ByteUtils.hexStringToBytes(data);
  }

  /**
   * Convert UTF-8 string to hex
   */
  static fromUTF8String(str: string): string {
    return ByteUtils.fastBytesToHex(new TextEncoder().encode(str));
  }
}
