// fresh/transaction-confirmations.mjs
var SDK_TRANSACTION_CONFIRMATIONS = 2;
var SDK_SETTLEMENT_POLICY = Object.freeze({
  mode: "confirmations",
  confirmations: SDK_TRANSACTION_CONFIRMATIONS,
  consensusFinality: false
});

// fresh/partner-policy-kzg.mjs
import { AbiCoder, Interface, concat, getAddress, hexlify, keccak256, sha256, toUtf8Bytes } from "ethers";
import { bn254 } from "@noble/curves/bn254";
var POLICY_FR = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
var N = 65536;
var FIRST = 32;
var CORPUS_BYTES = N * 192;
var coder = AbiCoder.defaultAbiCoder();
var Point = bn254.G1.Point;
var SCHEME = keccak256(toUtf8Bytes("VANTA_FAMILY_KZG_POLICY_TABLE_V1"));
var CHECKPOINT = keccak256(toUtf8Bytes("VANTA_FAMILY_KZG_POLICY_CHECKPOINT_V1"));
var hash = (value2, label) => {
  if (typeof value2 !== "string" || !/^0x[0-9a-f]{64}$/iu.test(value2) || BigInt(value2) === 0n)
    throw Error("Unpinned KZG policy " + label + ".");
  return value2.toLowerCase();
};
var exact = (value2, names, label) => {
  if (!value2 || typeof value2 !== "object" || Array.isArray(value2) || Object.keys(value2).length !== names.length || names.some((k) => !Object.hasOwn(value2, k)))
    throw Error("Invalid KZG policy " + label + " shape.");
  return value2;
};
var policyField = (value2, label = "field", zero = false) => {
  if (typeof value2 === "number" && !Number.isSafeInteger(value2))
    throw Error("Invalid KZG policy " + label + ": number must be a safe integer.");
  const n = BigInt(value2);
  if (n < 0n || n >= POLICY_FR || !zero && n === 0n)
    throw Error("Invalid KZG policy " + label + ".");
  return n;
};
function resource(value2, label) {
  exact(value2, ["path", "sha256", "bytes"], label);
  if (typeof value2.path !== "string" || !value2.path || value2.path.startsWith("/") || /[\\?#:]/u.test(value2.path) || value2.path.split("/").some((p) => !p || p === ".." || p === ".") || !Number.isSafeInteger(value2.bytes) || value2.bytes <= 0)
    throw Error("Invalid KZG policy " + label + " resource.");
  return Object.freeze({ path: value2.path, sha256: hash(value2.sha256, label), bytes: value2.bytes });
}
function verifier(value2, label) {
  exact(value2, ["address", "codehash"], label);
  const address = getAddress(value2.address);
  if (BigInt(address) === 0n) throw Error("Zero KZG policy verifier.");
  return Object.freeze({ address, codehash: hash(value2.codehash, label) });
}
function validateVantaPartnerPolicyKzgProfile(value2) {
  const p = exact(value2, [
    "schema",
    "chainId",
    "setupId",
    "generationId",
    "familyTag",
    "genesisHash",
    "tableSize",
    "reservedRows",
    "acceptedUpdateKeyRoot",
    "corpus",
    "corpusMetadata",
    "lookupKeys",
    "verifiers"
  ], "profile");
  if (p.schema !== "vanta-kzg-partner-policy-table-v1" || !Number.isSafeInteger(p.chainId) || p.chainId <= 0 || p.tableSize !== N || p.reservedRows !== FIRST)
    throw Error("Unsupported KZG partner policy profile.");
  const familyTag2 = hash(p.familyTag, "family");
  policyField(familyTag2, "family");
  const corpus = resource(p.corpus, "corpus");
  if (corpus.bytes !== CORPUS_BYTES) throw Error("KZG policy corpus must cover all 65,536 rows.");
  const v = exact(p.verifiers, ["combined", "enhanced"], "verifiers");
  exact(p.lookupKeys, ["combined", "enhanced"], "lookup keys");
  return Object.freeze({
    schema: p.schema,
    chainId: p.chainId,
    tableSize: N,
    reservedRows: FIRST,
    setupId: hash(p.setupId, "setup"),
    generationId: hash(p.generationId, "generation"),
    familyTag: familyTag2,
    genesisHash: hash(p.genesisHash, "genesis"),
    acceptedUpdateKeyRoot: hash(p.acceptedUpdateKeyRoot, "update key root"),
    corpus,
    corpusMetadata: resource(p.corpusMetadata, "corpus metadata"),
    lookupKeys: Object.freeze({
      combined: resource(p.lookupKeys.combined, "combined lookup key"),
      enhanced: resource(p.lookupKeys.enhanced, "enhanced lookup key")
    }),
    verifiers: Object.freeze({
      combined: verifier(v.combined, "combined verifier"),
      enhanced: verifier(v.enhanced, "enhanced verifier")
    })
  });
}
var VANTA_POLICY_REGISTRY_ABI = new Interface([
  "function REGISTRY_SCHEME() view returns(bytes32)",
  "function acceptedUpdateKeyRoot() view returns(bytes32)",
  "function releaseSetupId() view returns(bytes32)",
  "function releaseGenerationId() view returns(bytes32)",
  "function releaseFamilyTag() view returns(bytes32)",
  "function releaseChainId() view returns(uint256)",
  "function administrator() view returns(address)",
  "function activePoolForAsset(address) view returns(address)",
  "function poolState(address) view returns(address asset,uint256 root,uint32 nextSlot,bool approved)",
  "function poolCommitment(address) view returns(uint256 x,uint256 y,uint64 revision)",
  "function poolPolicyContext(address) view returns(uint256)",
  "function partnerSlot(address,bytes32) view returns(bool found,uint16 slot)",
  "function partnerAt(address,uint16) view returns(tuple(bytes32 partnerId,uint64 version,uint256 receiverCommitment,uint16 feeBps,uint128 feeMinimum,uint128 feeMaximum,uint256 authorizationKey,bool active,uint256 leaf))",
  "function operationPartnerId(uint256,uint8) view returns(bytes32)",
  "function partnerLeaf(address,uint256,uint8,uint64,uint256,uint16,uint128,uint128,uint256) view returns(uint256)",
  "event PartnerVersionChanged(address indexed pool,bytes32 indexed partnerId,uint16 slot,uint64 version,uint256 receiverCommitment,uint16 feeBps,uint128 feeMinimum,uint128 feeMaximum,bool active,uint256 root)"
]);
function vantaPolicyOwnerAction({
  kind,
  profile,
  registrar,
  registry,
  pools,
  checkpoints,
  handleId,
  authorizationCommitment,
  receiverCommitment,
  routingCommitment,
  salt,
  fees,
  revision,
  deadline,
  assetIndex
}) {
  const p = validateVantaPartnerPolicyKzgProfile(profile);
  if (!Array.isArray(pools) || pools.length < 2 || pools.length > 8 || new Set(pools.map((p2) => getAddress(p2).toLowerCase())).size !== pools.length || !Array.isArray(checkpoints) || checkpoints.length !== pools.length)
    throw Error("Owner policy action requires every canonical pool checkpoint.");
  if (assetIndex !== void 0) {
    if (!Number.isInteger(assetIndex) || assetIndex < 0 || assetIndex >= pools.length || typeof revision !== "bigint" || revision < 1n || revision >= 1n << 64n)
      throw Error("Invalid owner-authorized asset or revision.");
    const name = { register: "REGISTER", update: "UPDATE", revoke: "REVOKE" }[kind];
    if (!name) throw Error("Invalid owner asset action.");
    const types2 = ["bytes32", "uint256", "address", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32", "uint256"];
    const values2 = [
      keccak256(toUtf8Bytes("VANTA_PARTNER_KZG_" + name + "_ASSET_PROOF_V3")),
      p.chainId,
      registrar,
      p.setupId,
      p.generationId,
      p.familyTag,
      p.genesisHash,
      handleId,
      authorizationCommitment
    ];
    if (kind === "register") {
      types2.push("uint256", "bytes32", "bytes32");
      values2.push(receiverCommitment, routingCommitment, salt);
    }
    if (kind !== "revoke") {
      types2.push("bytes32");
      values2.push(keccak256(coder.encode([
        "tuple(uint16 feeBps,uint128 minimumFee,uint128 maximumFee)[6]"
      ], [fees])));
    }
    types2.push("uint8", "address", "address", "uint256", "uint64", "uint64");
    values2.push(assetIndex, registry, pools[assetIndex], policyField(checkpoints[assetIndex], "checkpoint"), revision, deadline);
    return policyField(BigInt(keccak256(coder.encode(types2, values2))) % POLICY_FR, "owner asset action");
  }
  const snapshot = keccak256(coder.encode(
    ["address", "address[]", "uint256[]"],
    [registry, pools, checkpoints.map((x) => policyField(x, "checkpoint"))]
  ));
  const names = { register: "REGISTER", update: "UPDATE", revoke: "REVOKE" };
  if (!names[kind]) throw Error("Invalid owner policy action.");
  const types = ["bytes32", "uint256", "address", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32", "uint256"];
  const values = [
    keccak256(toUtf8Bytes("VANTA_PARTNER_KZG_" + names[kind] + "_PROOF_V2")),
    p.chainId,
    registrar,
    p.setupId,
    p.generationId,
    p.familyTag,
    p.genesisHash,
    handleId,
    authorizationCommitment
  ];
  if (kind === "register") {
    types.push("uint256", "bytes32", "bytes32");
    values.push(receiverCommitment, routingCommitment, salt);
  }
  if (kind !== "revoke") {
    types.push("bytes32");
    values.push(keccak256(coder.encode(
      [
        "tuple(uint16 feeBps,uint128 minimumFee,uint128 maximumFee)[6]"
      ],
      [fees.map((f) => [f.feeBps, f.minimumFee, f.maximumFee])]
    )));
  }
  if (kind !== "register") {
    types.push("uint64");
    values.push(revision);
  }
  types.push("bytes32", "uint64");
  values.push(snapshot, deadline);
  return policyField(BigInt(keccak256(coder.encode(types, values))) % POLICY_FR, "owner action");
}

// fresh/wallet-entry.ts
import {
  AbiCoder as AbiCoder3,
  HDNodeWallet,
  Interface as Interface3,
  Wallet,
  concat as concat2,
  getAddress as getAddress7,
  getBytes as getBytes4,
  hexlify as hexlify3,
  keccak256 as keccak2567,
  toUtf8Bytes as toUtf8Bytes7
} from "ethers";

// ../../../../../../ceremony-kzg/packages/sdk/src/crypto/keys.ts
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 as sha2562 } from "@noble/hashes/sha256";
import { x25519 } from "@noble/curves/ed25519";
import { randomBytes as randomBytes2 } from "@noble/hashes/utils";

// ../../../../../../ceremony-kzg/packages/sdk/src/crypto/bytes.ts
import { ethers } from "ethers";
var ByteUtils = class _ByteUtils {
  /**
   * Convert hex string to bytes
   */
  static hexStringToBytes(hex) {
    const stripped = _ByteUtils.strip0x(hex);
    const bytes = new Uint8Array(stripped.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(stripped.substring(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }
  /**
   * Convert bytes to hex string (no 0x prefix)
   */
  static fastBytesToHex(bytes) {
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  /**
   * Strip 0x prefix from hex string
   */
  static strip0x(hex) {
    return hex.startsWith("0x") ? hex.slice(2) : hex;
  }
  /**
   * Add 0x prefix to hex string
   */
  static hexlify(data, prefix = false) {
    if (typeof data === "number") {
      const hex = data.toString(16);
      return prefix ? `0x${hex}` : hex;
    }
    if (data instanceof Uint8Array) {
      const hex = _ByteUtils.fastBytesToHex(data);
      return prefix ? `0x${hex}` : hex;
    }
    const stripped = _ByteUtils.strip0x(data);
    return prefix ? `0x${stripped}` : stripped;
  }
  /**
   * Convert bigint to hex string
   */
  static nToHex(n, byteLength, prefix = false) {
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
  static nToBytes(n, byteLength) {
    const hex = _ByteUtils.nToHex(n, byteLength);
    return _ByteUtils.hexStringToBytes(hex);
  }
  /**
   * Convert hex string to bigint
   */
  static hexToBigInt(hex) {
    const stripped = _ByteUtils.strip0x(hex);
    if (stripped.length === 0) return 0n;
    return BigInt(`0x${stripped}`);
  }
  /**
   * Convert bytes to bigint
   */
  static bytesToN(bytes) {
    return _ByteUtils.hexToBigInt(_ByteUtils.fastBytesToHex(bytes));
  }
  /**
   * Pad hex string to byte length
   */
  static padToLength(data, byteLength) {
    if (typeof data === "number") {
      return data.toString(16).padStart(byteLength * 2, "0");
    }
    const stripped = _ByteUtils.strip0x(data);
    return stripped.padStart(byteLength * 2, "0");
  }
  /**
   * Format to byte length
   */
  static formatToByteLength(data, byteLength, prefix = false) {
    let hex;
    if (data instanceof Uint8Array) {
      hex = _ByteUtils.fastBytesToHex(data);
    } else {
      hex = _ByteUtils.strip0x(data);
    }
    const padded = hex.padStart(byteLength * 2, "0");
    return prefix ? `0x${padded}` : padded;
  }
  /**
   * Generate random hex string
   */
  static randomHex(byteLength) {
    const bytes = ethers.randomBytes(byteLength);
    return _ByteUtils.fastBytesToHex(bytes);
  }
  /**
   * Combine hex strings
   */
  static combine(hexStrings) {
    return hexStrings.map((h) => _ByteUtils.strip0x(h)).join("");
  }
  /**
   * Convert to ethers-compatible bytes
   */
  static arrayify(data) {
    if (data instanceof Uint8Array) return data;
    return _ByteUtils.hexStringToBytes(data);
  }
  /**
   * Convert UTF-8 string to hex
   */
  static fromUTF8String(str) {
    return _ByteUtils.fastBytesToHex(new TextEncoder().encode(str));
  }
};

// ../../../../../../ceremony-kzg/packages/sdk/src/crypto/poseidon.ts
var poseidonInstance = null;
var poseidonPromise = null;
var externalPoseidonBuilder = null;
function findBuildPoseidon(mod) {
  if (typeof mod === "function") return mod;
  if (typeof mod?.buildPoseidon === "function") return mod.buildPoseidon;
  if (typeof mod?.default === "function") return mod.default;
  if (typeof mod?.default?.buildPoseidon === "function")
    return mod.default.buildPoseidon;
  for (const key of Object.keys(mod || {})) {
    if (key.toLowerCase().includes("poseidon") && typeof mod[key] === "function") {
      return mod[key];
    }
  }
  return null;
}
async function getPoseidon() {
  if (poseidonInstance) {
    return poseidonInstance;
  }
  if (!poseidonPromise) {
    poseidonPromise = (async () => {
      if (externalPoseidonBuilder) {
        try {
          poseidonInstance = await externalPoseidonBuilder();
          return poseidonInstance;
        } catch (e) {
          console.warn("External Poseidon builder failed:", e);
        }
      }
      let lastError = null;
      try {
        const circomlibjs = await import("#vanta-circom-crypto");
        const buildPoseidon = findBuildPoseidon(circomlibjs);
        if (buildPoseidon) {
          poseidonInstance = await buildPoseidon();
          return poseidonInstance;
        }
      } catch (e) {
        lastError = e;
      }
      try {
        if (typeof globalThis.circomlibjs !== "undefined") {
          const buildPoseidon = findBuildPoseidon(
            globalThis.circomlibjs
          );
          if (buildPoseidon) {
            poseidonInstance = await buildPoseidon();
            return poseidonInstance;
          }
        }
      } catch (e) {
        lastError = e;
      }
      throw new Error(
        `Failed to load circomlibjs: ${lastError?.message || "Unknown error"}. In browser, call setPoseidonBuilder() first.`
      );
    })();
  }
  return poseidonPromise;
}
async function poseidonAsync(args) {
  const poseidon = await getPoseidon();
  const hash4 = poseidon(args);
  return poseidon.F.toObject(hash4);
}

// ../../../../../../ceremony-kzg/packages/sdk/src/crypto/field.ts
import { randomBytes } from "@noble/hashes/utils";
var BN254_FR_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
var BABYJUBJUB_SUBORDER = 2736030358979909402780800718157159386076813972158567259200215660948447373041n;
var FIELD_SAMPLE_BITS = 254n;
var FIELD_SAMPLE_MASK = (1n << FIELD_SAMPLE_BITS) - 1n;
function bytesToBigIntBE(bytes) {
  let value2 = 0n;
  for (const byte of bytes) {
    value2 = value2 << 8n | BigInt(byte);
  }
  return value2;
}
function reduceToNonzeroResidue(wide, modulus, label) {
  if (wide.length < 48) {
    throw new Error(`${label} needs at least 48 bytes of entropy to reduce`);
  }
  const reduced = bytesToBigIntBE(wide) % modulus;
  if (reduced === 0n) throw new Error(`${label} reduced to zero`);
  return reduced;
}

// ../../../../../../ceremony-kzg/packages/sdk/src/crypto/babyjubjub.ts
var babyJubInstance = null;
var babyJubPromise = null;
async function getBabyJub() {
  if (babyJubInstance) return babyJubInstance;
  if (!babyJubPromise) {
    babyJubPromise = (async () => {
      const circomlibjs = await import("#vanta-circom-crypto");
      const build = circomlibjs?.buildBabyjub ?? circomlibjs?.default?.buildBabyjub;
      if (typeof build !== "function") {
        throw new Error("circomlibjs does not expose buildBabyjub");
      }
      babyJubInstance = await build();
      return babyJubInstance;
    })();
  }
  return babyJubPromise;
}
var SPEND_SCALAR_BOUND = 1n << 252n;
async function scalarMultBase8(scalar) {
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

// ../../../../../../ceremony-kzg/packages/sdk/src/crypto/keys.ts
import { bech32m } from "@scure/base";
var DOMAIN_SPENDING = "stealthos-spending-key-v1";
var DOMAIN_SPEND_SCALAR = "stealthos-spend-scalar-v1";
var DOMAIN_VIEWING = "stealthos-viewing-key-v1";
var DOMAIN_NULLIFYING = "stealthos-nullifying-key-v1";
var WIDE_DERIVATION_BYTES = 64;
function expand(secret, domain, length) {
  return hkdf(
    sha2562,
    secret,
    new Uint8Array(0),
    // no salt for determinism
    new TextEncoder().encode(domain),
    length
  );
}
async function deriveKeysFromSeed(masterSeed) {
  if (masterSeed.length !== 32) {
    throw new Error("Master seed must be 32 bytes");
  }
  const spendingPrivateKey = expand(masterSeed, DOMAIN_SPENDING, 32);
  const viewingPrivateKey = expand(masterSeed, DOMAIN_VIEWING, 32);
  const viewingPublicKey = x25519.getPublicKey(viewingPrivateKey);
  const spendSecretScalar = reduceToNonzeroResidue(
    expand(spendingPrivateKey, DOMAIN_SPEND_SCALAR, WIDE_DERIVATION_BYTES),
    BABYJUBJUB_SUBORDER,
    "spend secret scalar"
  );
  const spendingPublicKey = await scalarMultBase8(spendSecretScalar);
  const nullifyingKey = reduceToNonzeroResidue(
    expand(masterSeed, DOMAIN_NULLIFYING, WIDE_DERIVATION_BYTES),
    BN254_FR_MODULUS,
    "nullifying key"
  );
  const masterPublicKey = await poseidonAsync([
    spendingPublicKey[0],
    spendingPublicKey[1],
    nullifyingKey
  ]);
  const addressData = {
    masterPublicKey,
    viewingPublicKey
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
    stealthAddress
  };
}
var ADDRESS_PREFIX = "0zk";
var ADDRESS_LENGTH_LIMIT = 127;
var ALL_CHAINS_NETWORK_ID = "ffffffffffffffff";
function encodeStealthAddress(addressData) {
  const masterPublicKey = ByteUtils.nToHex(
    addressData.masterPublicKey,
    32 /* UINT_256 */,
    false
  );
  const viewingPublicKey = ByteUtils.formatToByteLength(
    addressData.viewingPublicKey,
    32 /* UINT_256 */
  );
  const networkID = addressData.chain ? getChainNetworkID(addressData.chain) : ALL_CHAINS_NETWORK_ID;
  const version = "01";
  const addressString = `${version}${masterPublicKey}${networkID}${viewingPublicKey}`;
  const addressBuffer = ByteUtils.hexStringToBytes(addressString);
  return bech32m.encode(
    ADDRESS_PREFIX,
    bech32m.toWords(addressBuffer),
    ADDRESS_LENGTH_LIMIT
  );
}
function getChainNetworkID(chain) {
  const typeHex = chain.type.toString(16).padStart(2, "0");
  const idHex = chain.id.toString(16).padStart(14, "0");
  return `${typeHex}${idHex}`;
}

// fresh/family-handle.mjs
function normalizeVantaFamilyHandle(value2) {
  const name = String(value2 ?? "").trim().toLowerCase();
  const handle = name.endsWith(".stealth") ? name : name + ".stealth";
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)?\.stealth$/u.test(handle))
    throw Error("Invalid family .stealth handle.");
  const labels = handle.slice(0, -8).split(".");
  if (labels.length < 1 || labels.length > 2 || labels.some((label) => label.length < 2 || label.length > 32 || label.startsWith("-") || label.endsWith("-")) || labels.join(".").length < 3 || labels.join(".").length > 48)
    throw Error("Invalid family .stealth handle.");
  return handle;
}

// fresh/family-rpc.mjs
import { JsonRpcProvider } from "ethers";

// fresh/family-network.mjs
import { getAddress as getAddress3, getBytes as getBytes2, keccak256 as keccak2563, sha256 as sha2566, toUtf8Bytes as toUtf8Bytes3, verifyMessage as verifyMessage2 } from "ethers";

// fresh/generated-family-release.mjs
var COMPILED_FAMILY_RELEASE_JSON = '{"activation":{"familyId":"dogeos","familyTag":"0x0d7e28190dad8c216f3b244bf15b182aebe3698b85e928461c3b148b4439c445","generationId":"0x2acecbe256faf24f04b0c5ddd06a40cfa7d832677ce6e476e2eb69fa2321c7e0","network":{"genesisHash":"0xf9f7c524dce38b51a4d28ec2f18680773e5ba9d3f5f430d0e05f92cfeb65b1bc","id":"eip155:6281971","role":"testnet"},"revision":6,"schema":"stealthos-family-network-activation-v1","setupId":"0xb4676558822d9964f45f716c27ea00f0f22f629b799dfaf61cb446db60e1ed70","signature":"0x6ab985fc32525011292d8ee299fb53d2e31782c6253aec9c7dcc843fd52a2b6050ed4534a2822562059ba1dcdbfb2349ac8bf905b956a9522c86f8dadc26d1221c"},"lock":{"contracts":[{"address":"0x29A73099227d348171fB3Bb6aa16263C105AACC3","codehash":"0xdff8d4f111b2be3c2ff3641818d43e84a5c5d4144e60c2573985c62d54d52dd3","kind":"bootstrap","name":"ccip-bnm-bootstrap"},{"address":"0xa8D6209316729dA2cC7bDf37d4077Af2E46FdBb2","codehash":"0xf85dc2f3d446faf9bf391f2d4714a0a7d5735ee7beab9e1c00a8a54b7f507990","kind":"bootstrap","name":"native-bootstrap"},{"address":"0xf3c128bA0903a8e85105096193f00f5EB4fda3ed","codehash":"0x1d0fe7d53d2b7ec894dbb99cb2133a4fc9d9eb072352690726d7a89df7a7fc64","kind":"bootstrap","name":"token-bootstrap"},{"address":"0x41B1134f986a93020703EcCc89931080895f1254","codehash":"0xd6e10a33c9d1b9ec9e4a8712fcacdfb6ed9e1d450332da832eb02226016c58e5","kind":"bootstrap","name":"usdc-bootstrap"},{"address":"0xb57BFFB8D02E59558a42CB56541299a6213c076B","codehash":"0xa3e0fcac7ddf463e1be3b5e9a8f107592eb876f418c8dca9958bfdd9dc988366","kind":"pool","name":"ccip-bnm-pool"},{"address":"0xd2e97e1197f4F1A78D125c518deCa494237b7362","codehash":"0x61c7b77eb6139d693ac04aeadf0056883c097787c6ba11eb024fa581b06c7a6a","kind":"pool","name":"native-pool"},{"address":"0xEd4397660cD48Cf26a7FC195272005207B4eF93C","codehash":"0xb33705a93b7ddb7967a7e1a0c6a26324ea7af31ea5f7ebd3272ec77ce1a0bac5","kind":"pool","name":"token-pool"},{"address":"0xc9c1A05607Ca20cAc2bd47503638F6be666F7601","codehash":"0x8aa22742a27c0cfd1cd65d927b0bbe39c2c224bff60e937818b16de5009bee28","kind":"pool","name":"usdc-pool"},{"address":"0x7E243Bc192C0106EB4C59BBb6be42fDB328E92b5","codehash":"0x46a952cb326ad62f51ba900f2806e04b279fd762d83a058941eac2fa34909de2","kind":"registry","name":"partner-registry"},{"address":"0x5B06144783Efc88A48D2F3D7E18428e338bEa6d5","codehash":"0xce2bc593530eceb7b69eb77cc5cde36e3a998bb1bb82cf46d5c2275cd8937a4a","kind":"verifier","name":"aggregate"},{"address":"0x509b5dC9D39242C20E7E812086b0259fe96A856e","codehash":"0x702da16aa335ab43587575398e66597b320d1f181f79e4858b49db253bed4497","kind":"verifier","name":"batch-payout-escrow"},{"address":"0x6A656fc96946d1Ff244D7d246F18050CCF501c00","codehash":"0xf3c1013008100fb316668adb2c083ae167d0ee28c024834fecf296f9e62e2fb4","kind":"verifier","name":"batch-payout-gateway"},{"address":"0xB1134A9a68774d87f35De8406e9Cc01945f87061","codehash":"0x6c99752547128c9e486615cc9aa12d4e1b0b3bf115aca4213dfb3450a38e8e6a","kind":"verifier","name":"bundle"},{"address":"0x25D5E5375e01Ed39Dc856bDCA5040417fD45eA3F","codehash":"0xf7d64e986fc068b96bccf90327d4dbbc5ba8dd5db4c927dddb91fd17eae5b013","kind":"verifier","name":"canonical-token"},{"address":"0x4A92387cE022FDae06c2e49020be7B24AAB16070","codehash":"0xbdcf4ef9a26ddbd853f009c68f9408c17523032ca3935d3f92f6bf3d0679324e","kind":"verifier","name":"ccip-bnm-asset"},{"address":"0x4ed1db6DF910Fe4c58fDcDBC97f28EeA9791558C","codehash":"0x315444b412b34dee38e0d49372efdbd094dfe4ddc268568e9f69472dbe119167","kind":"verifier","name":"ccip-bnm-combined-fee"},{"address":"0xCEcfE56CB4Bb513b6B051eaA55a44845B9d7035a","codehash":"0x2c601a02b41843045f4c8389eb43dfd8241454c90c82152afda04c8f55b1ae53","kind":"verifier","name":"ccip-bnm-enhanced-fee"},{"address":"0xE507cd544B32d4cA9bcd7810068E33f1Fa3902c9","codehash":"0xb053b2b9aff01851dbf9019c3569b490cc9e4048c61abc6645821f140b4ceb17","kind":"verifier","name":"ccip-bnm-vault-0"},{"address":"0xe45c42Bba0B450240Ac8AA33B7396A79FB8Fb72b","codehash":"0xd0b650c6532c34fc27caa335d5a4f235e5eec73b70e363887f1bd206f9ec0365","kind":"verifier","name":"combined-fee-partner"},{"address":"0x1d071eCCEb54b6Efc3Be26e20c57591E4EF70F93","codehash":"0xff3fdf98b19664bc44457af577b7435c1714e69996482a7c7fe0e94f59ee3540","kind":"verifier","name":"enhanced-authorization"},{"address":"0x4c83d1eA2E48b057B4c603B30B8d5cF90Fa331Ac","codehash":"0x3020378571d67543c420a51b703dbde059d4c5aee86d7fa3d707d2ab389a0347","kind":"verifier","name":"enhanced-claim"},{"address":"0xf2763002982cdDB84F0AD5bF246Df218FaA258BF","codehash":"0x9b37bcab7931d6b81e7011593646f2f79ea179a34c515dcbf8903d861e0b437c","kind":"verifier","name":"enhanced-fee-partner"},{"address":"0x9fa4E7EB89b4CeAa4E761184D519eF4f015A7955","codehash":"0x1c3db7095ae082997c24e91e06b1e5716eb8a225b36c743eadf686efdc6be5da","kind":"verifier","name":"exit"},{"address":"0x403eDCDE57c78eda1A9d323b70EA92bA9B4993Da","codehash":"0xef8e2763ac48bb12c37520fc24fee7acfa3f4afb30be5850b1814954d5110cbf","kind":"verifier","name":"exit-statement-eight"},{"address":"0xaEfe2bD24653E10AFB80accD71a33948556049Ea","codehash":"0x63610ddc5b395ddd16480a3c418ae6cfab22e712529f3096316182f1b7beeb4a","kind":"verifier","name":"exit-statement-thirty-two"},{"address":"0x7A3Bf3fd5EEfD7e2a2767D34577E547B1992935f","codehash":"0xc13a5f23d8d8ad57c50ce9ad9de5fff338859114563e90e419d46b56532da290","kind":"verifier","name":"gate0"},{"address":"0xE8a81d30DB501730D3dD13d5239ce05da273f2ea","codehash":"0xc8d37e6b5380d662a31cf8caae298d1c085eabc79048d06da772284816ae8136","kind":"verifier","name":"gate1"},{"address":"0x324954D841ecF9e572D953974d28B54818b3e97f","codehash":"0x58c500572072467568ebaca5f0ede7c8522dd601a2211e3d7e080a3ff801bf9c","kind":"verifier","name":"handle-adapter"},{"address":"0x77D2b0d3a73B8C833560DAF608c70f9225fcCFCA","codehash":"0xa97db27498636f6c7fac63f45c2adc9fd0f1ff6fed36139baaae59e6755a969a","kind":"verifier","name":"handle-register"},{"address":"0x77323D6F2d112BB50f3Aa105B9F24218B17037b7","codehash":"0xa3768d79e83371dde89976a00ff61cac9b31ce82c5dbc59e491bdc5b56b73341","kind":"verifier","name":"handle-registry"},{"address":"0x78bAF85bB97c7E9E25e54d9ED6952e7013ce4e7E","codehash":"0xe960266d6764e1567daf85f7bd3f498c061fc355bfe6bc26b3116f74d90249ae","kind":"verifier","name":"hasher"},{"address":"0x0b3E7339a6f6dBbf2Ed4F51073cb9cda574Ce541","codehash":"0xf8eedc71c75ff8b5a303ae79739a598893b9ba42bc0ad10f00df30f5c3757a39","kind":"verifier","name":"kzg"},{"address":"0x99871Ca5636aF1D4f629faF894FDc7070c9550E9","codehash":"0x2be75c4d82588974c21b4cb6336da076261222982bf4a8cefccaa7f2710bca52","kind":"verifier","name":"kzg-row-keys"},{"address":"0xA1c23DB24D9efF5a2E3aE98930c5c15Ec735eA3d","codehash":"0xa12efd55db0c85bf2aded736835cf92ff83490b42a5d9bddb16eb9da767d4ee1","kind":"verifier","name":"library-0"},{"address":"0xaEf1335474D784C7BeACFd92C142B98E1D213C56","codehash":"0xacaca3add15a8e634954358a7b869e50fa66ffb9d2050d41f9c5436f7c1b2dbd","kind":"verifier","name":"library-1"},{"address":"0xE50D5C281cE720bF14D45988A7A79b1c467eF9dd","codehash":"0x3d43427fda19fed077e95b866bfd10cda524cfd91ee2a27b73aba1ef965b94a1","kind":"verifier","name":"library-2"},{"address":"0xC0d040946FAAeF62B9BbFa547fCA6689c7aDB07D","codehash":"0x1df324a005d77263edcc6fc21286b8861cbc3cef42b42b8015aca8e0d9883100","kind":"verifier","name":"library-3"},{"address":"0x655165C5c7FA747a6526FE0a15146ccf795f5D78","codehash":"0xa059875fb6f8f30e26cef26c252f38cdcbeee4194e155b495d4c3c6424cddd68","kind":"verifier","name":"library-4"},{"address":"0x06fc82ac7A47F18c6A9FEc68C363B42Ea0C2dCd5","codehash":"0xc5163697c465b1ad8d74d5943fd6a5c76e338c77d97d4fa1e194848dea33ce15","kind":"verifier","name":"link"},{"address":"0x04807398391DDEB42b920Ec855f2e5Aa95093001","codehash":"0xf2e3f54d576c0aee9297d02b135813a261d4fd2ee6bc4cfd94dd29d6b1ac7f34","kind":"verifier","name":"native-combined-fee"},{"address":"0xfa97bbb5C8343e0B6C8B41190539d09CE5a7572b","codehash":"0x0d41df8ab32a1636c68aa27eb4b7b02718a2c5d27c416edba53a43ea5b9d455a","kind":"verifier","name":"native-enhanced-fee"},{"address":"0x8aBEff5CC6A03cAa2ae31714b9B12a3Dedb85DCe","codehash":"0xf9e9e2b7b3437b7bb4165f9b26174f22679fe22bdc8083660c9aad03ba1e970a","kind":"verifier","name":"native-screening-clearance"},{"address":"0x3474e922d4Fe08d9D4E8dDeD9F17e9fBeb1697C2","codehash":"0xfa39b4576a9153e3e57c58e45fd1b0e91b60807a8d69df44db9e7b35f6c67b46","kind":"verifier","name":"native-vault-0"},{"address":"0x7E92E062b33F8712f118CbD4523cF1117Ca27aA4","codehash":"0x315327fe4cfc6567584fecd4fa459b4016a52f32e2b551941ecdd5986b05a967","kind":"verifier","name":"normal"},{"address":"0x4956AaA031559FE0d57CCcbd277Bfcb53952F079","codehash":"0x039c4cb8841c8ad3ed6cc84498f1a3d488c70de8e852059cb7f016338809492c","kind":"verifier","name":"normal-statement-eight"},{"address":"0xa50846eb43fdDbc0E4eB20788e3915fe25ab1570","codehash":"0x32fb29ab97e293f0f2052b72aeedef278008fcc15b6adedfbac632ea278b9c29","kind":"verifier","name":"normal-statement-thirty-two"},{"address":"0xDb3C426CA59A8FBf7D7AA649821a826b5650011C","codehash":"0x67b8e410fc3c73ea855b2f54b234dd8e6f1a9470ad1a0d888029d36328e8a5e8","kind":"verifier","name":"partner-owner"},{"address":"0x5372b6A3483D86aa2D9a0121df53bE069FF5Fca2","codehash":"0x7fefee90ee19da0eef3fe01dbc926d64124639b0aea4c0a3a387ab84fce78c90","kind":"verifier","name":"partner-registrar"},{"address":"0x806045Bf4cAD45ab958218165e6C8093bC36701A","codehash":"0x4a317a656a1fc098104e9030806b3b0f97d60c2e2115099232c3d4c4ae12e5fc","kind":"verifier","name":"partner-updater"},{"address":"0x846d9457709a2E77403ec21C1077228fC1699072","codehash":"0x354b26999e434f8256d168395315e1f51fc15bf49bf2e6bb58fc549bd597e7da","kind":"verifier","name":"poseidon2"},{"address":"0x2cc2818781520CD0023e56a390A607797886b282","codehash":"0xe247ac4f3d40602f0ac0604b0f1fe631237cbc64d3e29a5d5e45721f2d94fa81","kind":"verifier","name":"poseidon3"},{"address":"0x6120c0d93Bb29c2c8A989965618353169156dB07","codehash":"0x5a31170277d2a27c7bfebc0bd00e7c00e32b9decbfc2fa07b8ef2a2e9cea364c","kind":"verifier","name":"private-swap-gateway"},{"address":"0xFd2723371303DE7dBBB909981af5a6fa15270caE","codehash":"0xfa0cae74b51aa57d53a1b62d6a40b62a88e9a71c38a7143b544e61567994efe3","kind":"verifier","name":"private-swap-output-escrow"},{"address":"0x4C5FEc9Fc4E34508253CFB0204660bC11C72e225","codehash":"0x3f6876c4bdd80ce4ab423f0428930ece5923de73ad7c649b86dbfdaf04e02d7f","kind":"verifier","name":"protocol-fee-policy"},{"address":"0x524B83ae8208490151339c626fd0E35b964483e3","codehash":"0x99dc8b2d1824c42cbf5d866a8d01685c7a5a4001a2b1fc9b91478bc1013aafd2","kind":"verifier","name":"route-ccip"},{"address":"0xe58df513B94B93f6F7847074b92D35ab5EbF3F38","codehash":"0x0ab7c9ab6662a793161a5770226de4863f93caa5cd77693bf387c4b40b79de8b","kind":"verifier","name":"route-gateway"},{"address":"0xC653e745FC613a03D156DACB924AE8e9148B18dc","codehash":"0xae6a1390251735e658b69a6c140d0258e266d9cf98a0118b685a34633475c149","kind":"verifier","name":"route-muchfi"},{"address":"0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE","codehash":"0xbd6ed8c4ef62daa1628f9d0259f01f08f1a3a085c71227865442c826cb1f2b5c","kind":"verifier","name":"route-wrappeddoge"},{"address":"0xdff0c3EaF76e4C53AC614c134C9E748E69C4353f","codehash":"0x74f4fdbe10afed5d6c554d7e97b74869e9876d069caadab849cd6c2884d43fd1","kind":"verifier","name":"token-combined-fee"},{"address":"0xd21330fa2286E70F9FECBa08cfB4a4ED8a5c97ce","codehash":"0x0aead9054d2d783f13e7447da05b4669c3d9b397c6cdc9dc4dd1b0f411f9c496","kind":"verifier","name":"token-enhanced-fee"},{"address":"0x6D102d1F5826e3526788d712E7D9B576414d0f14","codehash":"0x13c55e341da7ce2e6e08c5f80b1c9cedf3fae2dea9439d0339167ba4500a6357","kind":"verifier","name":"token-vault-0"},{"address":"0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925","codehash":"0xf7d64e986fc068b96bccf90327d4dbbc5ba8dd5db4c927dddb91fd17eae5b013","kind":"verifier","name":"usdc-asset"},{"address":"0xEF3aAAD36c418615c50621e399F449119d592eF4","codehash":"0x14dde396b5e5d05cf2fb988ee9faa7ba7b1a35f8bacbfed9f0737af7263babe9","kind":"verifier","name":"usdc-combined-fee"},{"address":"0xFfCa7ac847FeCd13Fb657922Ca61948792efc9B6","codehash":"0xc854dcb5b4e409df518bdef2f4a7774a92ece0f7a0de1b079b708769a75dc372","kind":"verifier","name":"usdc-enhanced-fee"},{"address":"0x85d86538B2E1762afC7F70639678062FF11ab3D4","codehash":"0xd04b0d950233ba765b77b6b3d3b8f0db6de090bb49d2e2734310add9bc577b0c","kind":"verifier","name":"usdc-vault-0"}],"familyId":"dogeos","familyTag":"0x0d7e28190dad8c216f3b244bf15b182aebe3698b85e928461c3b148b4439c445","generationId":"0x2acecbe256faf24f04b0c5ddd06a40cfa7d832677ce6e476e2eb69fa2321c7e0","lockId":"0x57e6d1e911046c7810dc3ae934fc85a155a4c1ba8ca6f6b09e24e8995ed961d4","network":{"genesisHash":"0xf9f7c524dce38b51a4d28ec2f18680773e5ba9d3f5f430d0e05f92cfeb65b1bc","id":"eip155:6281971","role":"testnet"},"relayerConfigSha256":"98622383f147333fd3caf4db5940166f89cf65cc1f8871e826c93245aa292580","schema":"stealthos-family-deployment-lock-v1","setupId":"0xb4676558822d9964f45f716c27ea00f0f22f629b799dfaf61cb446db60e1ed70","signature":"0x50cbd3b720d21fefc083e1e87f47a8a9c526c2dab3315f377bd4ab33cd653d1f2d42aeab1d05fd91af33a1dd1db1acc084e5d7294fe4445a284cf90f13c6a7921c"},"networkPolicy":{"familyId":"dogeos","networks":[{"genesisHash":"0xf9f7c524dce38b51a4d28ec2f18680773e5ba9d3f5f430d0e05f92cfeb65b1bc","id":"eip155:6281971","role":"testnet"}],"schema":"stealthos-reviewed-family-networks-v1","sourceNetworkId":"eip155:6281971"},"pins":{"familyId":"dogeos","generationId":"0x2acecbe256faf24f04b0c5ddd06a40cfa7d832677ce6e476e2eb69fa2321c7e0","genesisHash":"0xf9f7c524dce38b51a4d28ec2f18680773e5ba9d3f5f430d0e05f92cfeb65b1bc","lockId":"0x57e6d1e911046c7810dc3ae934fc85a155a4c1ba8ca6f6b09e24e8995ed961d4","networkId":"eip155:6281971","networkPolicySha256":"cd543f25008e339075bea5f879364b02a05eda526b287fc741ee7319a9d1cf9a","relayerConfigSha256":"98622383f147333fd3caf4db5940166f89cf65cc1f8871e826c93245aa292580","setupId":"0xb4676558822d9964f45f716c27ea00f0f22f629b799dfaf61cb446db60e1ed70"},"proving":{"circuits":[{"familyTag":"0x0d7e28190dad8c216f3b244bf15b182aebe3698b85e928461c3b148b4439c445","id":"combined-fee-partner","r1csSha256":"a1d25f967d987591fd676c79f1c4eeaee88c9c5cde9e95a116684d19a06d66d9","sourceSha256":"6a50aef5fa3ef8effcabe72ca5cd755142dd5fc709151ea3f568739b1d7c5fc7"},{"familyTag":"0x0d7e28190dad8c216f3b244bf15b182aebe3698b85e928461c3b148b4439c445","id":"enhanced-authorization","r1csSha256":"35692724d64ba7225b2dea934211789376f4e19385b8c53b56b67943514fe2b3","sourceSha256":"6a50aef5fa3ef8effcabe72ca5cd755142dd5fc709151ea3f568739b1d7c5fc7"},{"familyTag":"0x0d7e28190dad8c216f3b244bf15b182aebe3698b85e928461c3b148b4439c445","id":"enhanced-claim","r1csSha256":"cbdee4a4e7bdff1afa48c101622c27f9488fdec3d8c445cf7c920c89fe4e14b4","sourceSha256":"6a50aef5fa3ef8effcabe72ca5cd755142dd5fc709151ea3f568739b1d7c5fc7"},{"familyTag":"0x0d7e28190dad8c216f3b244bf15b182aebe3698b85e928461c3b148b4439c445","id":"enhanced-fee-partner","r1csSha256":"97fbed398a25ef618fe7c880c442f0bffdef801decf61618b9ab5140b0fa6e35","sourceSha256":"6a50aef5fa3ef8effcabe72ca5cd755142dd5fc709151ea3f568739b1d7c5fc7"},{"familyTag":"0x0d7e28190dad8c216f3b244bf15b182aebe3698b85e928461c3b148b4439c445","id":"gate0-exit-32","r1csSha256":"9003ad2975772dd42181180f002f68aecfb93df514d5072f588850727df29762","sourceSha256":"6a50aef5fa3ef8effcabe72ca5cd755142dd5fc709151ea3f568739b1d7c5fc7"},{"familyTag":"0x0d7e28190dad8c216f3b244bf15b182aebe3698b85e928461c3b148b4439c445","id":"gate0-exit-8","r1csSha256":"e11e3ec2cfae1566afc1dd4ea13a43ab09a0a822540149ab231cdaab51dfdd54","sourceSha256":"6a50aef5fa3ef8effcabe72ca5cd755142dd5fc709151ea3f568739b1d7c5fc7"},{"familyTag":"0x0d7e28190dad8c216f3b244bf15b182aebe3698b85e928461c3b148b4439c445","id":"gate0-normal-32","r1csSha256":"1b16c403ee12f4f9e30b87fe9c1fbbff80b1a35df99f3ca0bb671e2cd0ccbc6f","sourceSha256":"6a50aef5fa3ef8effcabe72ca5cd755142dd5fc709151ea3f568739b1d7c5fc7"},{"familyTag":"0x0d7e28190dad8c216f3b244bf15b182aebe3698b85e928461c3b148b4439c445","id":"gate0-normal-8","r1csSha256":"a31f0a9d73a82c0c79fb0937bfc2dcf704556088919cb30513c9e2d4e5d06958","sourceSha256":"6a50aef5fa3ef8effcabe72ca5cd755142dd5fc709151ea3f568739b1d7c5fc7"},{"familyTag":"0x0d7e28190dad8c216f3b244bf15b182aebe3698b85e928461c3b148b4439c445","id":"handle-register","r1csSha256":"593617ac14c03dea7c8afe82fee41aa75530c3e1538cdae100a439b1a299c45e","sourceSha256":"cc65db7cb2ec4ff286f9a5108e4fe6d5c2978b791656dbe492e075e28143177f"},{"familyTag":"0x0d7e28190dad8c216f3b244bf15b182aebe3698b85e928461c3b148b4439c445","id":"partner-owner","r1csSha256":"e54c79d4e2756f670de4eaabce2fbb0d18591eca549036c31115fd83c5527d34","sourceSha256":"e779485a237eb8c15d2437f363b03baea0279d20872cb22a6e9165d0cf1bd74b"},{"familyTag":"0x0d7e28190dad8c216f3b244bf15b182aebe3698b85e928461c3b148b4439c445","id":"payout-aggregate","r1csSha256":"d687ed54d6f7aa33bc82a6aa0939e77fde7a2c773b099ff629ce1406edb2472e","sourceSha256":"6a50aef5fa3ef8effcabe72ca5cd755142dd5fc709151ea3f568739b1d7c5fc7"}],"driver":{"engine":"STREAM_BOUND4","familyId":"dogeos","familyTag":"0x0d7e28190dad8c216f3b244bf15b182aebe3698b85e928461c3b148b4439c445","networkId":"eip155:6281971","partnerPolicyScheme":"kzg-caulk-plus-cclink-v1","schema":"stealthos-family-bound4-driver-v2","workerCount":4},"resourcesSha256":"ccb808096517224c5bf4f4649cb2802fd2960a2f7c449e0a258fd961aedb9da4"},"schema":"stealthos-family-sdk-release-v2","setup":{"artifactInventorySha256":"6cb7b5b34d1de4680f404041172889861ab7346e4187f4ba221ed0567151613d","beaconAnchors":{"phase1":"f5e80a3622182cc08c40799f32bbea900d8e04d2ff6cac87d568ac676731eac9","terminal":"0c0d4742ab445a70ed59ebe5489dc042d70199945166af2c4c4246bfcd6cb9a3"},"ceremonyId":"dogeos-kzg-live-20261114","ceremonyReleaseHash":"f59e3577e9b88e341edc09a0ae1961ee911548eec7ef1668cf61a0402cb849ab","circuitInventorySha256":"9d7377393f4992673eae8a3d2fb653b299dcf61aced6ed6c1295775248e0a4ec","constructionPlanSha256":"366cf2399629fd662dca064c5786f384bfdb97900b3309d13dd5ae67f3e5a9ac","family":{"activationAuthority":"0x1162ae2D023773aa526D63C11da14E4E40209093","id":"dogeos","namespace":"eip155","tag":"0x0d7e28190dad8c216f3b244bf15b182aebe3698b85e928461c3b148b4439c445"},"schema":"stealthos-reusable-family-setup-v1","setupId":"0xb4676558822d9964f45f716c27ea00f0f22f629b799dfaf61cb446db60e1ed70","sourceNetwork":{"chainId":6281971,"name":"DogeOS Chikyu"},"transcriptSha256":"42cd84b0bf13faea21ab94f2d8c60e76bd87e0f455d3ffceb0e5d8f3dfeb6be4","verifierKeysSha256":"4a9911d22ec41208c9dd0b0c445e3408617887e221867ae3cba77f4f9feae06c"}}\n';
var COMPILED_FAMILY_RELEASE_SHA256 = "8a9b88c8d035312af46d16064deb2dceaec6cd4c72815cd00c580a45f853905c";
var COMPILED_FAMILY_HISTORY_JSON = null;

// fresh/family-routed-resources.mjs
var ADDRESS = /^0x[0-9a-f]{40}$/u;
var WORD = /^0x[0-9a-f]{64}$/u;
var check = (ok, message) => {
  if (!ok) throw Error("Family routes: " + message);
};
var exact2 = (v, keys) => check(v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join() === keys.slice().sort().join(), "unexpected fields");
function validateFamilyRoutedResources(raw, release, pools) {
  exact2(raw, ["schema", "gateway", "sourceSelector", "nativePool", "usdcPool", "bnmPool", "usdc", "bnm", "muchFi", "ccip", "wrappedDoge", "maximumDeliveryFee", "destination"]);
  check(raw.schema === "vanta-family-chikyu-routes-v1" && release.pins.networkId === "eip155:6281971" && raw.sourceSelector === "7254999290874773717", "wrong route network");
  const pin = (value2, name, deployed = false) => {
    exact2(value2, deployed ? ["address", "codehash", "deploymentBlock"] : ["address", "codehash"]);
    const rows = release.lock.contracts.filter((c) => c.name === name);
    check(ADDRESS.test(value2.address) && BigInt(value2.address) > 0n && WORD.test(value2.codehash) && BigInt(value2.codehash) > 0n && rows.length === 1 && rows[0].address.toLowerCase() === value2.address && rows[0].codehash.toLowerCase() === value2.codehash, "unsigned route pin");
    if (deployed) check(Number.isSafeInteger(value2.deploymentBlock) && value2.deploymentBlock > 0, "missing deployment block");
    return Object.freeze({ ...value2 });
  };
  const gateway = pin(raw.gateway, "route-gateway", true), venues = Object.fromEntries(["muchFi", "ccip", "wrappedDoge"].map((n) => [n, pin(raw[n], "route-" + n.toLowerCase())]));
  check([raw.nativePool, raw.usdcPool, raw.bnmPool, raw.usdc, raw.bnm].every((v) => ADDRESS.test(v) && BigInt(v) > 0n) && raw.usdc !== raw.bnm, "invalid route assets");
  for (const [pool, asset] of [[raw.nativePool, "0x" + "00".repeat(20)], [raw.usdcPool, raw.usdc], [raw.bnmPool, raw.bnm]])
    check(pools.filter((p) => p.pool === pool && p.asset === asset).length === 1, "route pool differs from signed inventory");
  for (const [name, asset] of [["usdc-asset", raw.usdc], ["ccip-bnm-asset", raw.bnm]]) check(release.lock.contracts.filter((c) => c.name === name && c.address.toLowerCase() === asset).length === 1, "unsigned token");
  check(typeof raw.maximumDeliveryFee === "string" && /^[1-9][0-9]{0,20}$/u.test(raw.maximumDeliveryFee) && BigInt(raw.maximumDeliveryFee) <= 100n * 10n ** 18n, "invalid delivery fee bound");
  const d = raw.destination;
  exact2(d, ["chainId", "selector", "genesisHash", "rpcUrl", "token", "tokenCodehash", "router", "routerCodehash", "offRamp", "offRampCodehash"]);
  check(d.chainId === 11155111 && d.selector === "16015286601757825753" && WORD.test(d.genesisHash) && [d.token, d.router, d.offRamp].every((v) => ADDRESS.test(v) && BigInt(v) > 0n) && [d.tokenCodehash, d.routerCodehash, d.offRampCodehash].every((v) => WORD.test(v) && BigInt(v) > 0n), "invalid destination pins");
  const url = new URL(d.rpcUrl);
  check(url.protocol === "https:" && !url.username && !url.password && !url.hash && !url.search, "invalid destination RPC");
  return Object.freeze({ ...raw, gateway, ...venues, destination: Object.freeze({ ...d }) });
}

// fresh/family-funding-resources.mjs
var required = (ok, message) => {
  if (!ok) throw Error("Family funding resources: " + message);
};
var exact3 = (v, names) => required(v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join() === names.slice().sort().join(), "unexpected fields");
var ADDRESS2 = /^0x[0-9a-f]{40}$/u;
var WORD2 = /^0x[0-9a-f]{64}$/u;
var SHA = /^[0-9a-f]{64}$/u;
var isFamilyAssetSelection = (value2) => ["native", "token"].includes(value2) || typeof value2 === "string" && ADDRESS2.test(value2) && BigInt(value2) > 0n;
var leaf = (v) => {
  exact3(v, ["path", "sha256", "bytes"]);
  required(typeof v.path === "string" && /^[A-Za-z0-9_-][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$/u.test(v.path) && !v.path.split("/").some((s) => s === "." || s === "..") && SHA.test(v.sha256) && BigInt("0x" + v.sha256) > 0n && Number.isSafeInteger(v.bytes) && v.bytes > 0 && v.bytes <= 128 * 1024 * 1024, "invalid resource pin");
  return Object.freeze({ ...v });
};
function validateVantaFamilyFundingResources(raw, release) {
  exact3(raw, ["schema", "publicCache", "pools", ...raw.routes === void 0 ? [] : ["routes"]]);
  required(raw.schema === "vanta-family-kzg-funding-resources-v1", "unsupported funding schema");
  exact3(raw.publicCache, ["runtime", "corpus", "metadata"]);
  exact3(raw.publicCache.runtime, ["glue", "wasm", "rawWasm", "build"]);
  const publicCache = Object.freeze({
    runtime: Object.freeze(Object.fromEntries(["glue", "wasm", "rawWasm", "build"].map((n) => [n, leaf(raw.publicCache.runtime[n])]))),
    corpus: leaf(raw.publicCache.corpus),
    metadata: leaf(raw.publicCache.metadata)
  });
  required(publicCache.runtime.glue.path.endsWith(".js") && publicCache.runtime.wasm.path.endsWith(".wasm") && publicCache.runtime.rawWasm.path.endsWith(".wasm") && publicCache.runtime.build.path.endsWith(".json") && publicCache.runtime.build.bytes <= 2 * 1024 * 1024 && publicCache.corpus.bytes === 12582912 && publicCache.metadata.bytes <= 2 * 1024 * 1024, "wrong note-opening corpus or runtime layout");
  const locks = release.lock.contracts.filter((v) => v.kind === "pool");
  required(Array.isArray(raw.pools) && raw.pools.length === locks.length && raw.pools.length > 0 && raw.pools.length <= 8, "one host configuration per signed pool is required");
  const pools = raw.pools.map((p) => {
    exact3(p, ["pool", "asset", "poolCodehash", "deploymentBlock", "assetSymbol", "assetDecimals", "protocolBps", "relayerAddress", "hostPolicy"]);
    required(
      [p.pool, p.asset, p.relayerAddress].every((v) => ADDRESS2.test(v)) && BigInt(p.pool) > 0n && BigInt(p.relayerAddress) > 0n && WORD2.test(p.poolCodehash) && BigInt(p.poolCodehash) > 0n && locks.some((v) => v.address.toLowerCase() === p.pool && v.codehash.toLowerCase() === p.poolCodehash) && Number.isSafeInteger(p.deploymentBlock) && p.deploymentBlock > 0 && /^[A-Za-z0-9][A-Za-z0-9._-]{0,23}$/u.test(p.assetSymbol) && Number.isSafeInteger(p.assetDecimals) && p.assetDecimals >= 0 && p.assetDecimals <= 36 && Number.isInteger(p.protocolBps) && p.protocolBps >= 0 && p.protocolBps <= 1e4,
      "invalid signed pool identity or display/fee pins"
    );
    exact3(p.hostPolicy, ["windowEpochs", "minimumDelayEpochs", "maximumAuthorizationAgeEpochs", "reviewTtlSeconds"]);
    const policy = p.hostPolicy;
    required(Object.values(policy).every(Number.isSafeInteger) && policy.windowEpochs > 0 && policy.windowEpochs <= 360 && policy.maximumAuthorizationAgeEpochs >= 0 && policy.minimumDelayEpochs > policy.maximumAuthorizationAgeEpochs && policy.minimumDelayEpochs < policy.windowEpochs && policy.reviewTtlSeconds > 0 && policy.reviewTtlSeconds <= 900, "invalid reviewed schedule policy");
    return Object.freeze({ ...p, hostPolicy: Object.freeze({ ...policy }) });
  });
  required(new Set(pools.map((p) => p.pool)).size === pools.length && new Set(pools.map((p) => p.asset)).size === pools.length, "duplicate funding pool or asset");
  return Object.freeze({ schema: raw.schema, publicCache, pools: Object.freeze(pools), ...raw.routes === void 0 ? {} : { routes: validateFamilyRoutedResources(raw.routes, release, pools) } });
}
function selectVantaFamilyFundingResources(release, inventory, asset = "native") {
  required(isFamilyAssetSelection(asset), "unsupported pool asset selection");
  const funding = validateVantaFamilyFundingResources(inventory.funding, release);
  const canonical4 = release.lock.contracts.find((c) => c.name === "canonical-token")?.address?.toLowerCase();
  const matches = funding.pools.filter((p) => asset === "native" ? BigInt(p.asset) === 0n : asset === "token" ? canonical4 ? p.asset === canonical4 : BigInt(p.asset) !== 0n : p.asset === asset);
  required(matches.length === 1, "pool selection is ambiguous");
  const deployment = matches[0];
  return Object.freeze({
    chainId: Number(release.pins.networkId.split(":")[1]),
    familyTag: release.setup.family.tag,
    genesisHash: release.pins.genesisHash,
    generationId: release.pins.generationId,
    deployment: Object.freeze({ ...deployment, setupId: release.pins.setupId }),
    publicCache: funding.publicCache,
    profiles: Object.freeze(Object.fromEntries(["normal8", "normal32", "exit8", "exit32", "aggregate"].map((n) => [n, inventory.profiles[n]]))),
    driver: release.proving.driver,
    candidateOnly: true,
    safeForFunds: false
  });
}

// fresh/family-proof-resources.mjs
import { sha256 as sha2564 } from "ethers";

// fresh/family-proof-driver.mjs
import { sha256 as sha25622 } from "ethers";
import { sha256 as incrementalSha256 } from "@noble/hashes/sha256";
import { isHexString, sha256 as sha2563 } from "ethers";
import { sha256 as sha25632 } from "ethers";
var VANTA_DOGEOS_FAMILY_TAG = "0x0d7e28190dad8c216f3b244bf15b182aebe3698b85e928461c3b148b4439c445";
var KZG_FIELDS = ["schema", "familyId", "networkId", "familyTag", "engine", "workerCount", "partnerPolicyScheme"].sort().join(",");
function validateVantaFamilyBound4Descriptor(value2) {
  let v = value2, chainId = typeof v?.networkId == "string" && /^eip155:[1-9][0-9]{0,15}$/u.test(v.networkId) ? Number(v.networkId.slice(7)) : NaN;
  if (!v || typeof v != "object" || Array.isArray(v) || v.schema !== "stealthos-family-bound4-driver-v2" || Object.keys(v).sort().join(",") !== KZG_FIELDS || v.partnerPolicyScheme !== "kzg-caulk-plus-cclink-v1" || v.familyId !== "dogeos" || !Number.isSafeInteger(chainId) || chainId <= 0 || v.familyTag !== VANTA_DOGEOS_FAMILY_TAG || v.engine !== "STREAM_BOUND4" || v.workerCount !== 4)
    throw Error("DogeOS family proofs require the pinned four-worker STREAM_BOUND4 driver.");
  return Object.freeze({ ...v });
}
var MAX_MATRIX = 32 * 1024 * 1024;
var MAX_PACKAGE = 128 * 1024 * 1024;
var MAX_RANGE = 2 * 1024 * 1024;

// fresh/generated-family-proof-resources.mjs
var COMPILED_FAMILY_PROOF_RESOURCES_JSON = '{"credentials":{"handle-register":{"verificationKey":{"bytes":4335,"path":"objects/410f130a7cacf43ed886422a8e670ac4e7c4643f0a7046a064c895053630dcc7.json","sha256":"410f130a7cacf43ed886422a8e670ac4e7c4643f0a7046a064c895053630dcc7"},"witnessWasm":{"bytes":2863855,"path":"objects/05d5da57ccb59354b53ea760ece6952950324d157fbd68f059e5d3f8fd3d4c6d.wasm","sha256":"05d5da57ccb59354b53ea760ece6952950324d157fbd68f059e5d3f8fd3d4c6d"},"zkey":{"bytes":1183525,"path":"objects/876901ab21f0361539eef81136ec06f3ef0c21230b597a45ccccbd84fecc34ec.bin","sha256":"876901ab21f0361539eef81136ec06f3ef0c21230b597a45ccccbd84fecc34ec"}},"partner-owner":{"verificationKey":{"bytes":4338,"path":"objects/155d047c22bfa0c6af701b6c012cf4878a583b2338c7dc77b6395cdf4d05ecf2.json","sha256":"155d047c22bfa0c6af701b6c012cf4878a583b2338c7dc77b6395cdf4d05ecf2"},"witnessWasm":{"bytes":2172912,"path":"objects/a820241322c2d8631c309ddc146fbf88e65c71e24b3ac9803c1018be3f070b0c.wasm","sha256":"a820241322c2d8631c309ddc146fbf88e65c71e24b3ac9803c1018be3f070b0c"},"zkey":{"bytes":824953,"path":"objects/34991f760b72828859305ca89dd20de431f2a2ea3a8fc95863d717c29d5e1333.bin","sha256":"34991f760b72828859305ca89dd20de431f2a2ea3a8fc95863d717c29d5e1333"}}},"enhancedComponents":{"enhanced-authorization":{"provingKey":{"bytes":12667824,"path":"objects/5b093c1d6f910371af59eb918648e8ee1b6f9701332eae22c1ed38d22c70df4e.bin","sha256":"5b093c1d6f910371af59eb918648e8ee1b6f9701332eae22c1ed38d22c70df4e"},"publicInputs":19,"r1csSha256":"35692724d64ba7225b2dea934211789376f4e19385b8c53b56b67943514fe2b3","runtime":{"glue":{"bytes":18880,"path":"objects/599a65ca5bea54a3150ea4c317bc8b684d583ed4eab9aa8bcb7c5c465dc09e5b.js","sha256":"599a65ca5bea54a3150ea4c317bc8b684d583ed4eab9aa8bcb7c5c465dc09e5b"},"wasm":{"bytes":1994516,"path":"objects/8083640167139c6b73b26e7267eff773601b4247e3529e54c774ec4ab27062ad.wasm","sha256":"8083640167139c6b73b26e7267eff773601b4247e3529e54c774ec4ab27062ad"}},"verificationKey":{"bytes":4693,"path":"objects/06abac17bb11daa4fd18ed02fe08a6ac0d5fe79100ca18cc3211fd1b71d3a38f.json","sha256":"06abac17bb11daa4fd18ed02fe08a6ac0d5fe79100ca18cc3211fd1b71d3a38f"},"verifier":{"address":"0x1d071eCCEb54b6Efc3Be26e20c57591E4EF70F93","codehash":"0xff3fdf98b19664bc44457af577b7435c1714e69996482a7c7fe0e94f59ee3540","name":"enhanced-authorization"}},"enhanced-claim":{"provingKey":{"bytes":16827824,"path":"objects/c6ff02d078cfc194f59bb80faea93b67f9a8d2043e8deef5e3cc59834a996481.bin","sha256":"c6ff02d078cfc194f59bb80faea93b67f9a8d2043e8deef5e3cc59834a996481"},"publicInputs":15,"r1csSha256":"cbdee4a4e7bdff1afa48c101622c27f9488fdec3d8c445cf7c920c89fe4e14b4","runtime":{"glue":{"bytes":18880,"path":"objects/599a65ca5bea54a3150ea4c317bc8b684d583ed4eab9aa8bcb7c5c465dc09e5b.js","sha256":"599a65ca5bea54a3150ea4c317bc8b684d583ed4eab9aa8bcb7c5c465dc09e5b"},"wasm":{"bytes":1994516,"path":"objects/8083640167139c6b73b26e7267eff773601b4247e3529e54c774ec4ab27062ad.wasm","sha256":"8083640167139c6b73b26e7267eff773601b4247e3529e54c774ec4ab27062ad"}},"verificationKey":{"bytes":3997,"path":"objects/dad06f9150cae7b0080c013d671c2ec2a96a8581992c5b78404a7debc9954760.json","sha256":"dad06f9150cae7b0080c013d671c2ec2a96a8581992c5b78404a7debc9954760"},"verifier":{"address":"0x4c83d1eA2E48b057B4c603B30B8d5cF90Fa331Ac","codehash":"0x3020378571d67543c420a51b703dbde059d4c5aee86d7fa3d707d2ab389a0347","name":"enhanced-claim"}}},"familyId":"dogeos","familyTag":"0x0d7e28190dad8c216f3b244bf15b182aebe3698b85e928461c3b148b4439c445","funding":{"pools":[{"asset":"0x0000000000000000000000000000000000000000","assetDecimals":18,"assetSymbol":"DOGE","deploymentBlock":9647904,"hostPolicy":{"maximumAuthorizationAgeEpochs":2,"minimumDelayEpochs":3,"reviewTtlSeconds":300,"windowEpochs":360},"pool":"0xd2e97e1197f4f1a78d125c518deca494237b7362","poolCodehash":"0x61c7b77eb6139d693ac04aeadf0056883c097787c6ba11eb024fa581b06c7a6a","protocolBps":15,"relayerAddress":"0xfc03df9c4ae77fb69749bbfd9efb8eb747dd389e"},{"asset":"0x25d5e5375e01ed39dc856bdca5040417fd45ea3f","assetDecimals":18,"assetSymbol":"USD1","deploymentBlock":9647927,"hostPolicy":{"maximumAuthorizationAgeEpochs":2,"minimumDelayEpochs":3,"reviewTtlSeconds":300,"windowEpochs":360},"pool":"0xed4397660cd48cf26a7fc195272005207b4ef93c","poolCodehash":"0xb33705a93b7ddb7967a7e1a0c6a26324ea7af31ea5f7ebd3272ec77ce1a0bac5","protocolBps":15,"relayerAddress":"0xfc03df9c4ae77fb69749bbfd9efb8eb747dd389e"},{"asset":"0xd19d2ffb1c284668b7afe72cddae1baf3bc03925","assetDecimals":18,"assetSymbol":"USDC","deploymentBlock":9648168,"hostPolicy":{"maximumAuthorizationAgeEpochs":2,"minimumDelayEpochs":3,"reviewTtlSeconds":300,"windowEpochs":360},"pool":"0xc9c1a05607ca20cac2bd47503638f6be666f7601","poolCodehash":"0x8aa22742a27c0cfd1cd65d927b0bbe39c2c224bff60e937818b16de5009bee28","protocolBps":15,"relayerAddress":"0xfc03df9c4ae77fb69749bbfd9efb8eb747dd389e"},{"asset":"0x4a92387ce022fdae06c2e49020be7b24aab16070","assetDecimals":18,"assetSymbol":"CCIP-BnM","deploymentBlock":9648330,"hostPolicy":{"maximumAuthorizationAgeEpochs":2,"minimumDelayEpochs":3,"reviewTtlSeconds":300,"windowEpochs":360},"pool":"0xb57bffb8d02e59558a42cb56541299a6213c076b","poolCodehash":"0xa3e0fcac7ddf463e1be3b5e9a8f107592eb876f418c8dca9958bfdd9dc988366","protocolBps":15,"relayerAddress":"0xfc03df9c4ae77fb69749bbfd9efb8eb747dd389e"}],"publicCache":{"corpus":{"bytes":12582912,"path":"objects/b1e367d6be9c8cea49313afa5edf723b010eaba2279ed75406d6e7605be5af3f.bin","sha256":"b1e367d6be9c8cea49313afa5edf723b010eaba2279ed75406d6e7605be5af3f"},"metadata":{"bytes":1898,"path":"objects/c47d1bbe344c936a582ae4eb498f94eae03ed1fb9854d12c3612f20dd3371f8e.json","sha256":"c47d1bbe344c936a582ae4eb498f94eae03ed1fb9854d12c3612f20dd3371f8e"},"runtime":{"build":{"bytes":39754,"path":"objects/a9f88d91bf72d4665a45c3cb6351f226b9c6986a98c672149c78c8aaace3ee49.json","sha256":"a9f88d91bf72d4665a45c3cb6351f226b9c6986a98c672149c78c8aaace3ee49"},"glue":{"bytes":68486,"path":"objects/3a345081630a321c1426be39c8bc93ed6959b9007af401b273c8b6a2bac0675c.js","sha256":"3a345081630a321c1426be39c8bc93ed6959b9007af401b273c8b6a2bac0675c"},"rawWasm":{"bytes":4337243,"path":"objects/7201543a80be0d269165980b7989f314051cc9a03db8db29f61a0a181e9187fb.wasm","sha256":"7201543a80be0d269165980b7989f314051cc9a03db8db29f61a0a181e9187fb"},"wasm":{"bytes":3655628,"path":"objects/1245ac73d925405a921a68fa9e9d5d3072681d95970087439ff43773d013f54f.wasm","sha256":"1245ac73d925405a921a68fa9e9d5d3072681d95970087439ff43773d013f54f"}}},"routes":{"bnm":"0x4a92387ce022fdae06c2e49020be7b24aab16070","bnmPool":"0xb57bffb8d02e59558a42cb56541299a6213c076b","ccip":{"address":"0x524b83ae8208490151339c626fd0e35b964483e3","codehash":"0x99dc8b2d1824c42cbf5d866a8d01685c7a5a4001a2b1fc9b91478bc1013aafd2"},"destination":{"chainId":11155111,"genesisHash":"0x25a5cc106eea7138acab33231d7160d69cb777ee0c2c553fcddf5138993e6dd9","offRamp":"0xc6a246a9acdaae651708706494720f79c3e5d0a1","offRampCodehash":"0xe62935d123bcfd3c5c4a08d1df75b8a0dd4c4952fe77e496739a634596a88b15","router":"0x0bf3de8c5d3e8a2b34d2beeb17abfcebaf363a59","routerCodehash":"0xb0b5a5a199085b5e41254c16e72fb37416a41c006d3f5f58a7bed54e36c4bfa5","rpcUrl":"https://ethereum-sepolia-rpc.publicnode.com","selector":"16015286601757825753","token":"0xfd57b4ddbf88a4e07ff4e34c487b99af2fe82a05","tokenCodehash":"0x3cab80772f8841a55240878b8ba7fec41d626a72e61178af4ac664c28f13a627"},"gateway":{"address":"0xe58df513b94b93f6f7847074b92d35ab5ebf3f38","codehash":"0x0ab7c9ab6662a793161a5770226de4863f93caa5cd77693bf387c4b40b79de8b","deploymentBlock":9648459},"maximumDeliveryFee":"30000000000000000000","muchFi":{"address":"0xc653e745fc613a03d156dacb924ae8e9148b18dc","codehash":"0xae6a1390251735e658b69a6c140d0258e266d9cf98a0118b685a34633475c149"},"nativePool":"0xd2e97e1197f4f1a78d125c518deca494237b7362","schema":"vanta-family-chikyu-routes-v1","sourceSelector":"7254999290874773717","usdc":"0xd19d2ffb1c284668b7afe72cddae1baf3bc03925","usdcPool":"0xc9c1a05607ca20cac2bd47503638f6be666f7601","wrappedDoge":{"address":"0xf6bdb158a5ddf77f1b83bc9074f6a472c58d78ae","codehash":"0xbd6ed8c4ef62daa1628f9d0259f01f08f1a3a085c71227865442c826cb1f2b5c"}},"schema":"vanta-family-kzg-funding-resources-v1"},"generationId":"0x2acecbe256faf24f04b0c5ddd06a40cfa7d832677ce6e476e2eb69fa2321c7e0","networkId":"eip155:6281971","partnerPolicyKzg":{"acceptedUpdateKeyRoot":"0xd0acb3cf558621a2ca09fb448c31b9048c3fff4887ba1ddd9c25f83dad213cb8","chainId":6281971,"corpus":{"bytes":12582912,"path":"objects/b1e367d6be9c8cea49313afa5edf723b010eaba2279ed75406d6e7605be5af3f.bin","sha256":"0xb1e367d6be9c8cea49313afa5edf723b010eaba2279ed75406d6e7605be5af3f"},"corpusMetadata":{"bytes":1898,"path":"objects/c47d1bbe344c936a582ae4eb498f94eae03ed1fb9854d12c3612f20dd3371f8e.json","sha256":"0xc47d1bbe344c936a582ae4eb498f94eae03ed1fb9854d12c3612f20dd3371f8e"},"familyTag":"0x0d7e28190dad8c216f3b244bf15b182aebe3698b85e928461c3b148b4439c445","generationId":"0x2acecbe256faf24f04b0c5ddd06a40cfa7d832677ce6e476e2eb69fa2321c7e0","genesisHash":"0xf9f7c524dce38b51a4d28ec2f18680773e5ba9d3f5f430d0e05f92cfeb65b1bc","lookupKeys":{"combined":{"bytes":143211,"path":"objects/8f543797de65ae0f4a85c2f50dcc8045778762046329c37354e8f4a8e6a6a130.json","sha256":"0x8f543797de65ae0f4a85c2f50dcc8045778762046329c37354e8f4a8e6a6a130"},"enhanced":{"bytes":143211,"path":"objects/cc0f7b442b9c101083ee8ca6d43780df58a10cf63bf18b4f48e76017fb23d49a.json","sha256":"0xcc0f7b442b9c101083ee8ca6d43780df58a10cf63bf18b4f48e76017fb23d49a"}},"reservedRows":32,"schema":"vanta-kzg-partner-policy-table-v1","setupId":"0xb4676558822d9964f45f716c27ea00f0f22f629b799dfaf61cb446db60e1ed70","tableSize":65536,"verifiers":{"combined":{"address":"0xe45c42Bba0B450240Ac8AA33B7396A79FB8Fb72b","codehash":"0xd0b650c6532c34fc27caa335d5a4f235e5eec73b70e363887f1bd206f9ec0365"},"enhanced":{"address":"0xf2763002982cdDB84F0AD5bF246Df218FaA258BF","codehash":"0x9b37bcab7931d6b81e7011593646f2f79ea179a34c515dcbf8903d861e0b437c"}}},"profiles":{"aggregate":{"fixedKey":{"bytes":744,"path":"streams/aggregate/aggregate-bound4-fixed.bin","sha256":"1ab05e77ab257d08c83ca058380071c4224c2899bc9aad9992d09eec29703afa"},"keyManifest":{"bytes":24884,"path":"streams/aggregate/key.json","sha256":"0abf6370156460602c40731d9a12e8e6fa1dca812548a0671d97f8c17b97d449"},"matrix":{"bytes":385621,"path":"streams/aggregate/aggregate-bound4-matrix.bin","sha256":"0a5d369721043ad43ee26c1aecb226cdae01667ee66d01864199ef4d97166400"},"matrixManifest":{"bytes":9292,"path":"streams/aggregate/matrix.json","sha256":"4a258830f1ecda859996312e74b5c7b693d63b9618156a1e4a316706f373c04d"},"provingKeySha256":"abcdf693b61395063c68b7307625b0a0d69e441dde59a1db47b64be2b2187855","queries":{"A":{"bytes":579904,"path":"streams/aggregate/aggregate-bound4-A.bin","sha256":"62f5952c8d4bfded79aa4d37019123e2b71a9d77fc6545735bdf45ee25da9b6f"},"B_G1":{"bytes":579904,"path":"streams/aggregate/aggregate-bound4-B_G1.bin","sha256":"ef225b3b36cd453221cfa1ca9a987e188bba6e56db3061638bf5ab7dd34c700b"},"B_G2":{"bytes":1159808,"path":"streams/aggregate/aggregate-bound4-B_G2.bin","sha256":"7b6ab1326037e6aed65749cb4d71cb320b6f4313f813ad550dd9cc2bf25580de"},"H":{"bytes":1048512,"path":"streams/aggregate/aggregate-bound4-H.bin","sha256":"25ea4ecaeea1f06644ea377a894086330a73e453d8ccfa9bbcfeeb78de9c3e8f"},"L":{"bytes":579008,"path":"streams/aggregate/aggregate-bound4-L.bin","sha256":"316ce78bca193e67629f6b5b8951518fff17ab26f333a97848b4b097f18fd9f9"}},"r1csSha256":"d687ed54d6f7aa33bc82a6aa0939e77fde7a2c773b099ff629ce1406edb2472e","runtime":{"glue":{"bytes":66592,"path":"objects/591867f0acd91e884ffa9e1f31f5e33536222c1910f028ab76fcdec8210e2187.js","sha256":"591867f0acd91e884ffa9e1f31f5e33536222c1910f028ab76fcdec8210e2187"},"wasm":{"bytes":3542397,"path":"objects/1a11b0341fae6ef391c6078b1626ebf79d4debf4887e574938dffc872a61ee51.wasm","sha256":"1a11b0341fae6ef391c6078b1626ebf79d4debf4887e574938dffc872a61ee51"}}},"combined":{"fixedKey":{"bytes":1712,"path":"streams/combined/combined-bound4-fixed.bin","sha256":"0ea138a47414bd9d5ae429c180e1fdf8c8a6c3814892a6d556394f06bc1a19e9"},"keyManifest":{"bytes":91743,"path":"streams/combined/key.json","sha256":"9a8b1228b1f6951861da0bf6ea0b980d215302a2b4ccff14af81a8503f48ccc8"},"matrix":{"bytes":1205662,"path":"streams/combined/combined-bound4-matrix.bin","sha256":"57443364308b6ec41adf6ce6ea7538fd73b072501c15b79ffc27da6bb7d07ba9"},"matrixManifest":{"bytes":36167,"path":"streams/combined/matrix.json","sha256":"8d300b6cfc16c578df36a5f6213e413e74da77bb524dbd7417e845ce0a0326ab"},"policyLookupKey":{"bytes":143211,"path":"objects/8f543797de65ae0f4a85c2f50dcc8045778762046329c37354e8f4a8e6a6a130.json","sha256":"8f543797de65ae0f4a85c2f50dcc8045778762046329c37354e8f4a8e6a6a130"},"provingKeySha256":"78cc5cff70587a54bb44cbb3be726026859b9f4784fbea6a7121f9dbd3a576c0","queries":{"A":{"bytes":2199296,"path":"streams/combined/combined-bound4-A.bin","sha256":"7ce9f1a5200a15bf13e2c590da4b540c510a95d632e902e9187561c1d058b29d"},"B_G1":{"bytes":2199296,"path":"streams/combined/combined-bound4-B_G1.bin","sha256":"7c9d2961ed6b2bf51d73e0a31c384c21656757b014928ded965a113e09f4ee68"},"B_G2":{"bytes":4398592,"path":"streams/combined/combined-bound4-B_G2.bin","sha256":"063a828bcd41ee01d83ef7dcd2d1bde80a29e0ad9502326d40abac87d461103f"},"H":{"bytes":4194240,"path":"streams/combined/combined-bound4-H.bin","sha256":"dca2bbd2dbc18aa74a30c1b8da87bbbd90fe57ff6dfbc3de0002a56168065115"},"L":{"bytes":2196608,"path":"streams/combined/combined-bound4-L.bin","sha256":"9d56e7e5da0f095a211dd7deeaa41c2a26a3864da5c5051003d9a27bea4dd9e4"}},"r1csSha256":"a1d25f967d987591fd676c79f1c4eeaee88c9c5cde9e95a116684d19a06d66d9","runtime":{"glue":{"bytes":66592,"path":"objects/591867f0acd91e884ffa9e1f31f5e33536222c1910f028ab76fcdec8210e2187.js","sha256":"591867f0acd91e884ffa9e1f31f5e33536222c1910f028ab76fcdec8210e2187"},"wasm":{"bytes":3542397,"path":"objects/1a11b0341fae6ef391c6078b1626ebf79d4debf4887e574938dffc872a61ee51.wasm","sha256":"1a11b0341fae6ef391c6078b1626ebf79d4debf4887e574938dffc872a61ee51"}}},"enhanced":{"fixedKey":{"bytes":1744,"path":"streams/enhanced/enhanced-fee-bound4-fixed.bin","sha256":"c87318f3dbd85c5873bbbe31d4d326b7a88c166aa17d7d1c80787fe05e64669b"},"keyManifest":{"bytes":100815,"path":"streams/enhanced/key.json","sha256":"42e82fbaed22af95b78a3097b42ae5afd9b5f5f069b947aa53f45b5aef6c51b3"},"matrix":{"bytes":1328153,"path":"streams/enhanced/enhanced-fee-bound4-matrix.bin","sha256":"601f4fe8e7af3127e6e501c128a75f9b0ef591bf2d73e306982c1afa9fc0fa6c"},"matrixManifest":{"bytes":42524,"path":"streams/enhanced/matrix.json","sha256":"7ea8ee964e6b1a57173fc3b8b93e1f334ca2afb842839b6ca78597894ce50e77"},"policyLookupKey":{"bytes":143211,"path":"objects/cc0f7b442b9c101083ee8ca6d43780df58a10cf63bf18b4f48e76017fb23d49a.json","sha256":"cc0f7b442b9c101083ee8ca6d43780df58a10cf63bf18b4f48e76017fb23d49a"},"provingKeySha256":"9a7b62f1bbfdfbaff0417de40a2a8269a50c80b398070e3dbf90f4cab9f90a44","queries":{"A":{"bytes":2539904,"path":"streams/enhanced/enhanced-fee-bound4-A.bin","sha256":"f26db48ed40eb1b76763d1fc00d0883cf989abef3385a4c17aa0763fea62a4b7"},"B_G1":{"bytes":2539904,"path":"streams/enhanced/enhanced-fee-bound4-B_G1.bin","sha256":"615c9dab87523a666825d6953b2d0ea7cf5fa5746ae415fa28f71f64adba997c"},"B_G2":{"bytes":5079808,"path":"streams/enhanced/enhanced-fee-bound4-B_G2.bin","sha256":"e872dce030c6dbaee23849c4e217d16b0c3721271389bc3e9f2bf5be4349fe37"},"H":{"bytes":4194240,"path":"streams/enhanced/enhanced-fee-bound4-H.bin","sha256":"f77cef3437bb3846b025b16f7d78eff5ca9f42dd83426a6e58765a4004ef5080"},"L":{"bytes":2537152,"path":"streams/enhanced/enhanced-fee-bound4-L.bin","sha256":"6fe3890db34e9b0c7526cfb6ce5f3263517190db7f3bfa912ff2bfde1cf52c27"}},"r1csSha256":"97fbed398a25ef618fe7c880c442f0bffdef801decf61618b9ab5140b0fa6e35","runtime":{"glue":{"bytes":66592,"path":"objects/591867f0acd91e884ffa9e1f31f5e33536222c1910f028ab76fcdec8210e2187.js","sha256":"591867f0acd91e884ffa9e1f31f5e33536222c1910f028ab76fcdec8210e2187"},"wasm":{"bytes":3542397,"path":"objects/1a11b0341fae6ef391c6078b1626ebf79d4debf4887e574938dffc872a61ee51.wasm","sha256":"1a11b0341fae6ef391c6078b1626ebf79d4debf4887e574938dffc872a61ee51"}}},"exit32":{"m2Key":{"bytes":19090952,"path":"objects/7287447966eb0e99168c0eea198643862768b2a0dd726f0aa6185c9f2f100c47.bin","sha256":"7287447966eb0e99168c0eea198643862768b2a0dd726f0aa6185c9f2f100c47"},"m2Manifest":{"bytes":11301,"path":"objects/d6a61e9b388d7294db0db0de6247abadb26476e00b1b36e7f07b9f0cd39280cd.json","sha256":"d6a61e9b388d7294db0db0de6247abadb26476e00b1b36e7f07b9f0cd39280cd"},"matrix":{"bytes":2707756,"path":"objects/d6d428acb9375d443dc420d02a5bf7ec44e8207557a3b17c614a5e8f41396d5f.bin","sha256":"d6d428acb9375d443dc420d02a5bf7ec44e8207557a3b17c614a5e8f41396d5f"},"matrixManifest":{"bytes":25554,"path":"objects/d4dd2b88f418ac0b0a4d110d48ad6f3b70dfb1a7b88839a5887cd858295e2851.json","sha256":"d4dd2b88f418ac0b0a4d110d48ad6f3b70dfb1a7b88839a5887cd858295e2851"},"publicMaterial":{"bytes":157949,"path":"objects/f510523726bbc04dd919c1439a6d93abfc0798dadbffd6fb893b563c9fefeb02.json","sha256":"f510523726bbc04dd919c1439a6d93abfc0798dadbffd6fb893b563c9fefeb02"},"r1csSha256":"9003ad2975772dd42181180f002f68aecfb93df514d5072f588850727df29762","runtime":{"glue":{"bytes":66592,"path":"objects/591867f0acd91e884ffa9e1f31f5e33536222c1910f028ab76fcdec8210e2187.js","sha256":"591867f0acd91e884ffa9e1f31f5e33536222c1910f028ab76fcdec8210e2187"},"wasm":{"bytes":3530383,"path":"objects/40f7ca3fd259315f5762201815092dd141d2b1a7fb2f60b69a176b835c5f37f3.wasm","sha256":"40f7ca3fd259315f5762201815092dd141d2b1a7fb2f60b69a176b835c5f37f3"}},"setupLockSha256":"sha256:37a12bf2689f41ef27f8e67c107d98c446109f9bf0d06dc09b398832321a439a"},"exit8":{"m2Key":{"bytes":8841480,"path":"objects/76a0fc327e7882f1b38956e0b4958a6563eaf6d4f3efa02c6f99466a7c98075b.bin","sha256":"76a0fc327e7882f1b38956e0b4958a6563eaf6d4f3efa02c6f99466a7c98075b"},"m2Manifest":{"bytes":7143,"path":"objects/1ca0ea6bf1c2cbfddc4647f984cd4bb97f927e526ef428838aca1552ba02fd6b.json","sha256":"1ca0ea6bf1c2cbfddc4647f984cd4bb97f927e526ef428838aca1552ba02fd6b"},"matrix":{"bytes":1170700,"path":"objects/484982608a37c7fc1960f4625e9cfd8e5a14e9d84a39018f35fabdb3e12350b7.bin","sha256":"484982608a37c7fc1960f4625e9cfd8e5a14e9d84a39018f35fabdb3e12350b7"},"matrixManifest":{"bytes":12005,"path":"objects/bdaba04f1a7fe10cfa6aabcee8ddbe84f2c9bf78a7e1a711b7acd863e6b8bfe1.json","sha256":"bdaba04f1a7fe10cfa6aabcee8ddbe84f2c9bf78a7e1a711b7acd863e6b8bfe1"},"publicMaterial":{"bytes":154395,"path":"objects/a6dbab6c1d58fe6cbfd5f8c9a4acd00ed2ce7abb220172e6ea58306bb64cb084.json","sha256":"a6dbab6c1d58fe6cbfd5f8c9a4acd00ed2ce7abb220172e6ea58306bb64cb084"},"r1csSha256":"e11e3ec2cfae1566afc1dd4ea13a43ab09a0a822540149ab231cdaab51dfdd54","runtime":{"glue":{"bytes":66592,"path":"objects/591867f0acd91e884ffa9e1f31f5e33536222c1910f028ab76fcdec8210e2187.js","sha256":"591867f0acd91e884ffa9e1f31f5e33536222c1910f028ab76fcdec8210e2187"},"wasm":{"bytes":3532311,"path":"objects/73c2715fb40d7699fccba9123687895a15cc3c8d7002e3cf9ab5e5623ac71795.wasm","sha256":"73c2715fb40d7699fccba9123687895a15cc3c8d7002e3cf9ab5e5623ac71795"}},"setupLockSha256":"sha256:a5c0b742d9a9df14c7119b3097dee7077f85ed31bb206aba21169ed8fa858546"},"normal32":{"m2Key":{"bytes":19163592,"path":"objects/939e79c60891579cc345933170ad944a70d4bbb550ecaf8aabbbab8c0c3cb66a.bin","sha256":"939e79c60891579cc345933170ad944a70d4bbb550ecaf8aabbbab8c0c3cb66a"},"m2Manifest":{"bytes":11302,"path":"objects/2b6bed935d49d7dd44f48a5e53ebb2414b350525a09a41022a31bae05ef79521.json","sha256":"2b6bed935d49d7dd44f48a5e53ebb2414b350525a09a41022a31bae05ef79521"},"matrix":{"bytes":2724292,"path":"objects/b0b70b86dbf5b904eba67ebd20e049169f63c4adc163a06b11c5aad94807261e.bin","sha256":"b0b70b86dbf5b904eba67ebd20e049169f63c4adc163a06b11c5aad94807261e"},"matrixManifest":{"bytes":25554,"path":"objects/fb46063574f5826ea2f162e5e1cb6acde16d662d55def4c6bfa600ac80f1654c.json","sha256":"fb46063574f5826ea2f162e5e1cb6acde16d662d55def4c6bfa600ac80f1654c"},"publicMaterial":{"bytes":157950,"path":"objects/0df0c00140cfc93ce043bbefe93967c6abae78186d9ed17b9add98c267cce2d5.json","sha256":"0df0c00140cfc93ce043bbefe93967c6abae78186d9ed17b9add98c267cce2d5"},"r1csSha256":"1b16c403ee12f4f9e30b87fe9c1fbbff80b1a35df99f3ca0bb671e2cd0ccbc6f","runtime":{"glue":{"bytes":66592,"path":"objects/591867f0acd91e884ffa9e1f31f5e33536222c1910f028ab76fcdec8210e2187.js","sha256":"591867f0acd91e884ffa9e1f31f5e33536222c1910f028ab76fcdec8210e2187"},"wasm":{"bytes":3533061,"path":"objects/194654590523daf443ca0de51ddcc29f9c61a022c94b4c2e2e9583065aab3d06.wasm","sha256":"194654590523daf443ca0de51ddcc29f9c61a022c94b4c2e2e9583065aab3d06"}},"setupLockSha256":"sha256:432872d4523045da3fbee236ce200a23da9866ee050ee276949ef710da436b93"},"normal8":{"m2Key":{"bytes":8914120,"path":"objects/67a030235bfe718ba6f612644a7351f8fc82a2f99b877f54085cc5e5294128bf.bin","sha256":"67a030235bfe718ba6f612644a7351f8fc82a2f99b877f54085cc5e5294128bf"},"m2Manifest":{"bytes":7144,"path":"objects/ab7461c7c92f83469523636cc5acd10d0cf8b4c3695cef8f3cd596be6d073e61.json","sha256":"ab7461c7c92f83469523636cc5acd10d0cf8b4c3695cef8f3cd596be6d073e61"},"matrix":{"bytes":1187275,"path":"objects/f366990c49e37a8e2cfb3b4674d65fc41814f9237a9b2722a8c6516b5dcfd023.bin","sha256":"f366990c49e37a8e2cfb3b4674d65fc41814f9237a9b2722a8c6516b5dcfd023"},"matrixManifest":{"bytes":12007,"path":"objects/f62213cc8a855085651b648dce98d63b6685965508e09b29a45dd41dfea14097.json","sha256":"f62213cc8a855085651b648dce98d63b6685965508e09b29a45dd41dfea14097"},"publicMaterial":{"bytes":154396,"path":"objects/fa27f2c99f425f69fe3985dfa135d9a2d0759ca5ac62b71672934135045a7be5.json","sha256":"fa27f2c99f425f69fe3985dfa135d9a2d0759ca5ac62b71672934135045a7be5"},"r1csSha256":"a31f0a9d73a82c0c79fb0937bfc2dcf704556088919cb30513c9e2d4e5d06958","runtime":{"glue":{"bytes":66592,"path":"objects/591867f0acd91e884ffa9e1f31f5e33536222c1910f028ab76fcdec8210e2187.js","sha256":"591867f0acd91e884ffa9e1f31f5e33536222c1910f028ab76fcdec8210e2187"},"wasm":{"bytes":3542397,"path":"objects/1a11b0341fae6ef391c6078b1626ebf79d4debf4887e574938dffc872a61ee51.wasm","sha256":"1a11b0341fae6ef391c6078b1626ebf79d4debf4887e574938dffc872a61ee51"}},"setupLockSha256":"sha256:e9e7f741e43330bfde2fde2cc8632f3f1475581ecb36ebad41c71d917b62808a"}},"schema":"stealthos-family-bound4-resources-v2","setupId":"0xb4676558822d9964f45f716c27ea00f0f22f629b799dfaf61cb446db60e1ed70","sourceCommit":"7111c058558c1fb558e2497e4bc7c36d59446f77"}\n';
var COMPILED_FAMILY_PROOF_RESOURCES_SHA256 = "ccb808096517224c5bf4f4649cb2802fd2960a2f7c449e0a258fd961aedb9da4";

// fresh/family-role-contract.mjs
var FAMILY_PROFILE_V2 = "family-eip155-v2";
var FAMILY_PUBLIC_INPUTS_V2 = Object.freeze({
  "combined-fee-partner": 40,
  "enhanced-authorization": 19,
  "enhanced-claim": 15,
  "enhanced-fee-partner": 41,
  "gate0-exit-32": 6,
  "gate0-exit-8": 6,
  "gate0-normal-32": 6,
  "gate0-normal-8": 6,
  "handle-register": 7,
  "partner-owner": 7,
  "payout-aggregate": 13
});
var FAMILY_ROLE_IDS_V2 = Object.freeze(Object.keys(FAMILY_PUBLIC_INPUTS_V2).sort());
var FAMILY_PROOF_PROFILES_V2 = Object.freeze({
  normal8: "gate0-normal-8",
  normal32: "gate0-normal-32",
  exit8: "gate0-exit-8",
  exit32: "gate0-exit-32",
  aggregate: "payout-aggregate",
  combined: "combined-fee-partner",
  enhanced: "enhanced-fee-partner"
});
var FAMILY_KZG_FEE_PROFILES_V2 = Object.freeze(["combined", "enhanced"]);
var FAMILY_STANDARD_STREAM_PROFILES_V2 = Object.freeze(["aggregate", "combined", "enhanced"]);
var FAMILY_ENHANCED_COMPONENT_PUBLIC_INPUTS_V2 = Object.freeze({ "enhanced-authorization": 19, "enhanced-claim": 15 });
function familyRoleContract(profile = FAMILY_PROFILE_V2) {
  if (profile !== FAMILY_PROFILE_V2) throw Error("The current SDK requires the KZG eleven-role V2 profile.");
  return Object.freeze({
    profile,
    roles: FAMILY_ROLE_IDS_V2,
    publicInputs: FAMILY_PUBLIC_INPUTS_V2,
    proofs: FAMILY_PROOF_PROFILES_V2,
    kzgFees: FAMILY_KZG_FEE_PROFILES_V2
  });
}
function assertFamilyRoleInventory(ids, profile = FAMILY_PROFILE_V2) {
  const expected = familyRoleContract(profile).roles;
  if (!Array.isArray(ids) || ids.length !== expected.length || new Set(ids).size !== expected.length || expected.some((id) => !ids.includes(id)))
    throw Error("Expected complete eleven-role KZG V2 inventory.");
  return true;
}

// fresh/family-proof-resources.mjs
var SHA2 = /^[0-9a-f]{64}$/u;
var WORD3 = /^0x[0-9a-f]{64}$/u;
var PATH = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$/u;
var PROFILES = Object.keys(FAMILY_PROOF_PROFILES_V2);
var SECTIONS = ["H", "L", "A", "B_G1", "B_G2"];
var CIRCUITS = FAMILY_PROOF_PROFILES_V2;
var CIRCUIT_IDS = FAMILY_ROLE_IDS_V2;
var ENHANCED_COMPONENTS = Object.keys(FAMILY_ENHANCED_COMPONENT_PUBLIC_INPUTS_V2);
var canonical = (value2) => Array.isArray(value2) ? "[" + value2.map(canonical).join(",") + "]" : value2 && typeof value2 === "object" ? "{" + Object.keys(value2).sort().map((key) => JSON.stringify(key) + ":" + canonical(value2[key])).join(",") + "}" : JSON.stringify(value2);
var required2 = (condition, message) => {
  if (!condition) throw Error("Family proof resources: " + message);
};
var exact4 = (value2, fields, label) => required2(value2 && typeof value2 === "object" && !Array.isArray(value2) && Object.keys(value2).sort().join() === fields.slice().sort().join(), "invalid " + label);
var nonzero = (value2, pattern) => typeof value2 === "string" && pattern.test(value2) && BigInt(value2.startsWith("0x") ? value2 : "0x" + value2) !== 0n;
var leaf2 = (raw, label) => {
  exact4(raw, ["path", "sha256", "bytes"], label);
  required2(typeof raw.path === "string" && PATH.test(raw.path) && !raw.path.split("/").some((part) => part === "." || part === "..") && nonzero(raw.sha256, SHA2) && Number.isSafeInteger(raw.bytes) && raw.bytes > 0 && raw.bytes <= 128 * 1024 * 1024, "invalid " + label + " pin");
  return Object.freeze({ ...raw });
};
function validateVantaFamilyProofConfiguration(raw, release) {
  exact4(raw, ["driver", "resourcesSha256", "circuits"], "proving configuration");
  const driver = validateVantaFamilyBound4Descriptor(raw.driver);
  required2(driver.schema === "stealthos-family-bound4-driver-v2" && driver.partnerPolicyScheme === "kzg-caulk-plus-cclink-v1", "fee relations require the KZG v2 driver");
  required2(
    nonzero(raw.resourcesSha256, SHA2) && driver.familyId === release?.pins?.familyId && driver.networkId === release?.pins?.networkId && driver.familyTag === release?.setup?.family?.tag && driver.networkId === release?.activation?.network?.id,
    "driver differs from the signed network family"
  );
  required2(
    Array.isArray(raw.circuits) && raw.circuits.length === CIRCUIT_IDS.length,
    "full family circuit inventory required"
  );
  const circuits = raw.circuits.map((row, index) => {
    exact4(row, ["id", "r1csSha256", "sourceSha256", "familyTag"], "sealed circuit");
    required2(row.id === CIRCUIT_IDS[index] && row.familyTag === driver.familyTag && nonzero(row.r1csSha256, SHA2) && nonzero(row.sourceSha256, SHA2), "invalid or unordered sealed circuit pins");
    return Object.freeze({ ...row });
  });
  required2(sha2564(new TextEncoder().encode(canonical(circuits))) === "0x" + release?.setup?.circuitInventorySha256, "circuit pins differ from the signed setup");
  return Object.freeze({ driver, resourcesSha256: raw.resourcesSha256, circuits: Object.freeze(circuits) });
}
function validateVantaFamilyEnhancedComponentResources(raw, configuration, release) {
  exact4(raw, ENHANCED_COMPONENTS, "separate enhanced proof components");
  return Object.freeze(Object.fromEntries(ENHANCED_COMPONENTS.map((name) => {
    const source = raw[name];
    exact4(source, ["r1csSha256", "publicInputs", "provingKey", "verificationKey", "runtime", "verifier"], name);
    const pinned = configuration.circuits.find((item) => item.id === name);
    required2(
      source.r1csSha256 === pinned?.r1csSha256 && source.publicInputs === FAMILY_ENHANCED_COMPONENT_PUBLIC_INPUTS_V2[name],
      "enhanced proving key is not the signed R1CS/public layout: " + name
    );
    exact4(source.runtime, ["glue", "wasm"], name + " runtime");
    const runtime = Object.freeze({
      glue: leaf2(source.runtime.glue, name + " glue"),
      wasm: leaf2(source.runtime.wasm, name + " WASM")
    });
    required2(
      runtime.glue.path.endsWith(".js") && runtime.wasm.path.endsWith(".wasm"),
      "enhanced proof runtime must pin ESM/WASM bytes"
    );
    exact4(source.verifier, ["name", "address", "codehash"], name + " Solidity verifier");
    required2(
      source.verifier.name === name && /^0x[0-9a-fA-F]{40}$/u.test(source.verifier.address) && /^0x[0-9a-fA-F]{64}$/u.test(source.verifier.codehash) && release.lock.contracts.some((item) => item.kind === "verifier" && item.name === name && item.address.toLowerCase() === source.verifier.address.toLowerCase() && item.codehash.toLowerCase() === source.verifier.codehash.toLowerCase()),
      "enhanced verifier address and bytecode must match the signed deployment lock: " + name
    );
    return [name, Object.freeze({
      ...source,
      runtime,
      provingKey: leaf2(source.provingKey, name + " proving key"),
      verificationKey: leaf2(source.verificationKey, name + " verification key"),
      verifier: Object.freeze({ ...source.verifier })
    })];
  })));
}
function validateVantaFamilyProofResources(raw, release) {
  required2(
    release?.schema === "stealthos-family-sdk-release-v2",
    "funded proofs require a v2 compiled family descriptor"
  );
  const configuration = validateVantaFamilyProofConfiguration(release.proving, release);
  exact4(raw, [
    "schema",
    "familyId",
    "familyTag",
    "networkId",
    "setupId",
    "generationId",
    "sourceCommit",
    "profiles",
    "partnerPolicyKzg",
    "credentials",
    "enhancedComponents",
    "funding"
  ], "inventory");
  required2(
    raw.schema === "stealthos-family-bound4-resources-v2" && raw.familyId === configuration.driver.familyId && raw.familyTag === configuration.driver.familyTag && raw.networkId === configuration.driver.networkId && raw.setupId === release.pins.setupId && raw.generationId === release.pins.generationId && nonzero(raw.setupId, WORD3) && nonzero(raw.generationId, WORD3) && /^[0-9a-f]{40}$/u.test(raw.sourceCommit ?? ""),
    "inventory differs from the signed generation"
  );
  const partnerPolicyKzg = validateVantaPartnerPolicyKzgProfile(raw.partnerPolicyKzg);
  required2(partnerPolicyKzg.chainId === Number(configuration.driver.networkId.slice(7)) && partnerPolicyKzg.setupId === raw.setupId && partnerPolicyKzg.generationId === raw.generationId && partnerPolicyKzg.familyTag === raw.familyTag && partnerPolicyKzg.genesisHash === release.pins.genesisHash, "policy table differs from the signed generation");
  for (const pin of Object.values(partnerPolicyKzg.verifiers))
    required2(
      release.lock.contracts.some((item) => item.kind === "verifier" && item.address.toLowerCase() === pin.address.toLowerCase() && item.codehash.toLowerCase() === pin.codehash),
      "policy lookup verifier is not in the signed deployment lock"
    );
  exact4(raw.credentials, ["handle-register", "partner-owner"], "credentials");
  const credentials = Object.freeze(Object.fromEntries(["handle-register", "partner-owner"].map((name) => {
    const source = raw.credentials[name];
    exact4(source, ["witnessWasm", "zkey", "verificationKey"], name + " credential");
    return [name, Object.freeze(Object.fromEntries(Object.entries(source).map(([kind, pin]) => [kind, leaf2(pin, name + " " + kind)])))];
  })));
  const enhancedComponents = validateVantaFamilyEnhancedComponentResources(
    raw.enhancedComponents,
    configuration,
    release
  );
  exact4(raw.profiles, PROFILES, "profiles");
  const profiles = {};
  for (const name of PROFILES) {
    const source = raw.profiles[name], standard = FAMILY_STANDARD_STREAM_PROFILES_V2.includes(name), fee = name !== "aggregate" && standard;
    const fields = standard ? [
      "runtime",
      "r1csSha256",
      "provingKeySha256",
      "keyManifest",
      "fixedKey",
      "matrixManifest",
      "matrix",
      "queries",
      ...fee ? ["policyLookupKey"] : []
    ] : [
      "runtime",
      "r1csSha256",
      "m2Manifest",
      "m2Key",
      "matrixManifest",
      "matrix",
      "publicMaterial",
      "setupLockSha256"
    ];
    exact4(source, fields, name);
    exact4(source.runtime, ["glue", "wasm"], name + " runtime");
    required2(
      nonzero(source.r1csSha256, SHA2) && configuration.circuits.find((row) => row.id === CIRCUITS[name])?.r1csSha256 === source.r1csSha256,
      "R1CS pin differs from the signed " + name + " circuit"
    );
    const profile = { runtime: Object.freeze({
      glue: leaf2(source.runtime.glue, name + " glue"),
      wasm: leaf2(source.runtime.wasm, name + " WASM")
    }), r1csSha256: source.r1csSha256 };
    required2(
      profile.runtime.glue.path.endsWith(".js") && profile.runtime.wasm.path.endsWith(".wasm"),
      "runtime filenames must preserve ESM/WASM types"
    );
    for (const key of standard ? ["keyManifest", "fixedKey", "matrixManifest", "matrix"] : ["m2Manifest", "m2Key", "matrixManifest", "matrix", "publicMaterial"])
      profile[key] = leaf2(source[key], name + " " + key);
    if (standard) {
      required2(nonzero(source.provingKeySha256, SHA2), "missing " + name + " key derivation pin");
      profile.provingKeySha256 = source.provingKeySha256;
      if (fee) {
        profile.policyLookupKey = leaf2(source.policyLookupKey, name + " policy lookup key");
        const approved = partnerPolicyKzg.lookupKeys[name];
        required2(approved.path === profile.policyLookupKey.path && approved.bytes === profile.policyLookupKey.bytes && approved.sha256 === "0x" + profile.policyLookupKey.sha256, "policy lookup key differs from its relation pin");
      }
      exact4(source.queries, SECTIONS, name + " query sections");
      profile.queries = Object.freeze(Object.fromEntries(SECTIONS.map((section) => [section, leaf2(source.queries[section], name + " query " + section)])));
    } else {
      required2(/^sha256:[0-9a-f]{64}$/u.test(source.setupLockSha256 ?? ""), "invalid setup lock");
      profile.setupLockSha256 = source.setupLockSha256;
    }
    profiles[name] = Object.freeze(profile);
  }
  for (const name of ["aggregate", "combined", "enhanced"]) {
    for (const kind of ["glue", "wasm"]) {
      const actual = profiles[name].runtime[kind], shared = profiles.normal8.runtime[kind];
      required2(
        actual.sha256 === shared.sha256 && actual.bytes === shared.bytes,
        "standard proof roles must reuse the pinned normal8 engine"
      );
    }
  }
  const funding = validateVantaFamilyFundingResources(raw.funding, release);
  const paths = /* @__PURE__ */ new Map();
  for (const item of familyProofResourceLeaves({ profiles, partnerPolicyKzg, credentials, enhancedComponents, funding })) {
    const old = paths.get(item.path);
    required2(!old || old.sha256 === item.sha256 && old.bytes === item.bytes, "conflicting artifact paths");
    paths.set(item.path, item);
  }
  return Object.freeze({ ...raw, partnerPolicyKzg, credentials, enhancedComponents, funding, profiles: Object.freeze(profiles) });
}
function familyProofResourceLeaves(inventory) {
  const leaves = [];
  const visit = (value2) => {
    if (value2 && typeof value2 === "object") {
      if (Object.hasOwn(value2, "path")) {
        leaves.push({ ...value2, sha256: value2.sha256.replace(/^0x/u, "") });
        return;
      }
      for (const item of Object.values(value2)) visit(item);
    }
  };
  visit(inventory.profiles);
  visit(inventory.partnerPolicyKzg);
  visit(inventory.credentials);
  visit(inventory.enhancedComponents);
  visit(inventory.funding);
  return leaves;
}
function getCompiledVantaFamilyProofResources(release, releaseContext) {
  if (releaseContext !== void 0) {
    const record = familyReleaseContextRecord(releaseContext);
    required2(record.release.pins.networkId === release?.pins?.networkId && record.release.pins.generationId === release?.pins?.generationId && record.release.pins.lockId === release?.pins?.lockId, "generation resource capability differs");
    if (record.inventory) return record.inventory;
  }
  required2(
    typeof COMPILED_FAMILY_PROOF_RESOURCES_JSON === "string" && COMPILED_FAMILY_PROOF_RESOURCES_JSON.length <= 256 * 1024 && nonzero(COMPILED_FAMILY_PROOF_RESOURCES_SHA256, SHA2) && sha2564(new TextEncoder().encode(COMPILED_FAMILY_PROOF_RESOURCES_JSON)) === "0x" + COMPILED_FAMILY_PROOF_RESOURCES_SHA256 && release?.proving?.resourcesSha256 === COMPILED_FAMILY_PROOF_RESOURCES_SHA256,
    "no matching compiled STREAM_BOUND4 inventory"
  );
  return validateVantaFamilyProofResources(JSON.parse(COMPILED_FAMILY_PROOF_RESOURCES_JSON), release);
}
function createVantaFamilyProofArtifactReader({ artifactBaseUrl, fetcher = fetch, signal } = {}) {
  const location = globalThis.location;
  let base;
  try {
    base = new URL(artifactBaseUrl, location?.href);
  } catch {
    throw Error("Invalid family artifact origin.");
  }
  required2(
    location && !base.username && !base.password && !base.search && !base.hash && (base.protocol === "https:" || base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname)),
    "trusted local proof runtime requires a secure artifact locator"
  );
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  const url = (pin) => {
    leaf2(pin, "requested artifact");
    const result = new URL(pin.path, base);
    required2(result.origin === base.origin && result.pathname.startsWith(base.pathname), "artifact escaped origin");
    return result.href;
  };
  const read = async (pin, offset, length, range) => {
    signal?.throwIfAborted();
    required2(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(length) && length > 0 && offset + length <= pin.bytes && (!range || length <= 2 * 1024 * 1024), "invalid bounded read");
    const response = await fetcher(url(pin), {
      signal,
      credentials: "omit",
      redirect: "error",
      ...range ? { headers: { Range: `bytes=${offset}-${offset + length - 1}` } } : {}
    });
    required2(!response.redirected && response.type !== "opaque" && response.body && response.status === (range ? 206 : 200), "pinned artifact unavailable");
    if (range) required2(response.headers.get("Content-Range") === `bytes ${offset}-${offset + length - 1}/${pin.bytes}`, "range response differs");
    const declared = response.headers.get("content-length");
    required2(declared === null || /^\d+$/u.test(declared) && Number(declared) === length, "response size differs");
    const result = new Uint8Array(length), reader = response.body.getReader();
    let received = 0;
    try {
      for (; ; ) {
        signal?.throwIfAborted();
        const next = await reader.read();
        if (next.done) break;
        required2(next.value instanceof Uint8Array && received + next.value.length <= length, "oversized artifact response");
        result.set(next.value, received);
        received += next.value.length;
      }
      required2(received === length, "truncated artifact response");
      if (!range) required2(sha2564(result) === "0x" + pin.sha256, "artifact SHA-256 differs");
      signal?.throwIfAborted();
      return result;
    } catch (error) {
      result.fill(0);
      try {
        await reader.cancel();
      } catch {
      }
      throw error;
    } finally {
      reader.releaseLock();
    }
  };
  return Object.freeze({
    url,
    bytes: (pin) => read(pin, 0, pin.bytes, false),
    range: (pin, offset, length) => read(pin, offset, length, true)
  });
}

// fresh/family-catalog-core.mjs
import { getAddress as getAddress2, sha256 as sha2565, toUtf8Bytes as toUtf8Bytes2, keccak256 as keccak2562, verifyMessage, getBytes } from "ethers";
var freezeFamilyCatalogValue = (v) => {
  if (v && typeof v === "object") {
    for (const x of Object.values(v)) freezeFamilyCatalogValue(x);
    Object.freeze(v);
  }
  return v;
};

// fresh/family-network.mjs
var releaseContexts = /* @__PURE__ */ new WeakMap();
var compiledRelease;
var FR = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
var WORD4 = /^0x[0-9a-fA-F]{64}$/u;
var SHA3 = /^[0-9a-f]{64}$/u;
var ID = /^[a-z][a-z0-9-]{1,31}$/u;
var NAME = /^[a-z][a-z0-9-]{0,63}$/u;
var nonzeroSha = (value2) => SHA3.test(value2 ?? "") && BigInt("0x" + value2) !== 0n;
var fail = (message) => {
  throw Error("SDK family release: " + message);
};
var check2 = (ok, message) => {
  if (!ok) fail(message);
};
var canonical2 = (value2) => {
  if (Array.isArray(value2)) return "[" + value2.map(canonical2).join(",") + "]";
  if (value2 && typeof value2 === "object") return "{" + Object.keys(value2).sort().map((key) => JSON.stringify(key) + ":" + canonical2(value2[key])).join(",") + "}";
  check2(value2 !== void 0 && !(typeof value2 === "number" && !Number.isSafeInteger(value2)), "noncanonical manifest");
  return JSON.stringify(value2);
};
var exact5 = (value2, keys, label) => check2(value2 && typeof value2 === "object" && !Array.isArray(value2) && Object.keys(value2).sort().join(",") === [...keys].sort().join(","), "invalid " + label);
var digest = (value2) => keccak2563(toUtf8Bytes3(canonical2(value2)));
var familyTag = (family) => {
  check2(
    ID.test(family?.id ?? "") && family.namespace === "eip155",
    "unsupported ceremony family; non-EVM adapters are not enabled"
  );
  const hash4 = keccak2563(toUtf8Bytes3(
    `STEALTHOS_VANTA_CEREMONY_FAMILY_V1:eip155:${family.id}`
  ));
  return "0x" + (BigInt(hash4) % FR).toString(16).padStart(64, "0");
};
var signCheck = (message, signature, authority, label) => {
  let result;
  try {
    result = verifyMessage2(getBytes2(message), signature);
  } catch {
    fail(label + " signature invalid");
  }
  check2(result === getAddress3(authority), label + " signer differs");
};
function assertPinnedFamilyEvmManifest({
  setup,
  activation,
  lock,
  pins,
  networkPolicy
}) {
  exact5(pins, [
    "familyId",
    "networkId",
    "genesisHash",
    "setupId",
    "generationId",
    "lockId",
    "relayerConfigSha256",
    "networkPolicySha256"
  ], "SDK build pins");
  exact5(setup, [
    "schema",
    "family",
    "ceremonyId",
    "sourceNetwork",
    "ceremonyReleaseHash",
    "transcriptSha256",
    "verifierKeysSha256",
    "constructionPlanSha256",
    "circuitInventorySha256",
    "artifactInventorySha256",
    "beaconAnchors",
    "setupId"
  ], "setup");
  exact5(
    setup.family,
    ["id", "namespace", "tag", "activationAuthority"],
    "family"
  );
  exact5(setup.beaconAnchors, ["phase1", "terminal"], "beacon anchors");
  exact5(setup.sourceNetwork, ["chainId", "name"], "source network");
  const { setupId, ...setupBody } = setup;
  check2(
    setup.schema === "stealthos-reusable-family-setup-v1" && setup.setupId === digest(setupBody) && setup.setupId === pins.setupId && setup.family.id === pins.familyId && Number.isSafeInteger(setup.sourceNetwork.chainId) && setup.sourceNetwork.chainId > 0 && typeof setup.sourceNetwork.name === "string" && setup.sourceNetwork.name.trim().length > 0 && setup.family.tag === familyTag(setup.family) && getAddress3(setup.family.activationAuthority) === setup.family.activationAuthority && setup.family.activationAuthority !== "0x0000000000000000000000000000000000000000" && ID.test(setup.ceremonyId) && [
      "ceremonyReleaseHash",
      "transcriptSha256",
      "verifierKeysSha256",
      "constructionPlanSha256",
      "circuitInventorySha256",
      "artifactInventorySha256"
    ].every((name) => nonzeroSha(setup[name])) && nonzeroSha(setup.beaconAnchors.phase1) && nonzeroSha(setup.beaconAnchors.terminal),
    "setup identity differs from separately compiled family pins"
  );
  exact5(
    networkPolicy,
    ["schema", "familyId", "sourceNetworkId", "networks"],
    "reviewed chain-family policy"
  );
  check2(
    networkPolicy.schema === "stealthos-reviewed-family-networks-v1" && networkPolicy.familyId === setup.family.id && networkPolicy.sourceNetworkId === "eip155:" + setup.sourceNetwork.chainId && SHA3.test(pins.networkPolicySha256 ?? "") && sha2566(toUtf8Bytes3(canonical2(networkPolicy))).toLowerCase() === "0x" + pins.networkPolicySha256 && Array.isArray(networkPolicy.networks) && networkPolicy.networks.length > 0 && networkPolicy.networks.length <= 8,
    "missing independently pinned network-family membership"
  );
  const members = /* @__PURE__ */ new Set();
  for (const net of networkPolicy.networks) {
    exact5(net, ["id", "genesisHash", "role"], "reviewed network");
    check2(
      /^eip155:[1-9][0-9]*$/u.test(net.id) && !members.has(net.id) && ["mainnet", "testnet"].includes(net.role) && WORD4.test(net.genesisHash ?? "") && BigInt(net.genesisHash) !== 0n && net.genesisHash === net.genesisHash.toLowerCase(),
      "invalid or duplicate reviewed family membership"
    );
    members.add(net.id);
  }
  check2(
    networkPolicy.networks.some((net) => net.id === networkPolicy.sourceNetworkId && net.role === "testnet") && networkPolicy.networks.some((net) => canonical2(net) === canonical2(activation?.network)),
    "an operator cannot relabel another chain as this ceremony family"
  );
  exact5(activation, [
    "schema",
    "setupId",
    "familyId",
    "familyTag",
    "network",
    "revision",
    "generationId",
    "signature"
  ], "activation");
  exact5(activation.network, ["id", "genesisHash", "role"], "network");
  const { signature: activationSignature, ...activationBody } = activation;
  const { generationId, ...unsignedActivation } = activationBody;
  const chain = activation.network.id.match(/^eip155:([1-9][0-9]*)$/u)?.[1];
  check2(
    activation.schema === "stealthos-family-network-activation-v1" && chain && Number.isSafeInteger(Number(chain)) && String(Number(chain)) === chain && activation.setupId === setup.setupId && activation.familyId === setup.family.id && activation.familyTag === setup.family.tag && ["mainnet", "testnet"].includes(activation.network.role) && WORD4.test(activation.network.genesisHash ?? "") && BigInt(activation.network.genesisHash) !== 0n && activation.network.genesisHash === activation.network.genesisHash.toLowerCase() && Number.isSafeInteger(activation.revision) && activation.revision >= 0 && activation.revision < 2 ** 32 && activation.generationId === digest(unsignedActivation) && activation.generationId === pins.generationId && activation.network.id === pins.networkId && activation.network.genesisHash === pins.genesisHash,
    "network activation differs from immutable SDK network pins"
  );
  signCheck(
    keccak2563(toUtf8Bytes3(
      "STEALTHOS_VANTA_FAMILY_ACTIVATION_V1:" + canonical2(activationBody)
    )),
    activationSignature,
    setup.family.activationAuthority,
    "activation"
  );
  exact5(
    lock,
    [
      "schema",
      "setupId",
      "generationId",
      "familyId",
      "familyTag",
      "network",
      "contracts",
      "relayerConfigSha256",
      "lockId",
      "signature"
    ],
    "deployment lock"
  );
  const { signature: lockSignature, ...lockBody } = lock;
  const { lockId, ...unsignedLock } = lockBody;
  check2(
    lock.schema === "stealthos-family-deployment-lock-v1" && lock.setupId === setup.setupId && lock.generationId === activation.generationId && lock.familyId === setup.family.id && lock.familyTag === setup.family.tag && canonical2(lock.network) === canonical2(activation.network) && lock.lockId === digest(unsignedLock) && lock.lockId === pins.lockId && lock.relayerConfigSha256 === pins.relayerConfigSha256 && nonzeroSha(lock.relayerConfigSha256) && Array.isArray(lock.contracts) && lock.contracts.length >= 4,
    "deployment differs from immutable SDK contract and relayer pins"
  );
  const kinds = /* @__PURE__ */ new Set(), roles = /* @__PURE__ */ new Set(), addresses = /* @__PURE__ */ new Set();
  let previous = "";
  for (const item of lock.contracts) {
    exact5(item, ["kind", "name", "address", "codehash"], "contract");
    check2(
      ["pool", "registry", "bootstrap", "verifier"].includes(item.kind) && NAME.test(item.name) && !item.name.includes("research") && WORD4.test(item.codehash) && BigInt(item.codehash) !== 0n && getAddress3(item.address) === item.address && item.address !== "0x0000000000000000000000000000000000000000",
      "invalid contract identity"
    );
    const key = item.kind + ":" + item.name;
    check2(
      key.localeCompare(previous, "en") > 0 && !roles.has(key) && !addresses.has(item.address),
      "duplicate/unordered contract graph"
    );
    previous = key;
    kinds.add(item.kind);
    roles.add(key);
    addresses.add(item.address);
  }
  check2(
    ["pool", "registry", "bootstrap", "verifier"].every((k) => kinds.has(k)),
    "incomplete new network graph"
  );
  signCheck(
    keccak2563(toUtf8Bytes3(
      "STEALTHOS_VANTA_FAMILY_DEPLOYMENT_V1:" + canonical2(lockBody)
    )),
    lockSignature,
    setup.family.activationAuthority,
    "deployment"
  );
  return Object.freeze({
    setupId: setup.setupId,
    generationId: lock.generationId,
    lockId: lock.lockId,
    networkId: activation.network.id
  });
}
function getCompiledFamilyEvmRelease(releaseContext) {
  if (releaseContext !== void 0) return familyReleaseContextRecord(releaseContext).release;
  if (compiledRelease) return compiledRelease;
  check2(
    typeof COMPILED_FAMILY_RELEASE_JSON === "string" && SHA3.test(COMPILED_FAMILY_RELEASE_SHA256 ?? "") && COMPILED_FAMILY_HISTORY_JSON === null && sha2566(toUtf8Bytes3(COMPILED_FAMILY_RELEASE_JSON)).toLowerCase() === "0x" + COMPILED_FAMILY_RELEASE_SHA256,
    "no independently pinned family SDK release is built in"
  );
  const release = JSON.parse(COMPILED_FAMILY_RELEASE_JSON);
  const v2 = release?.schema === "stealthos-family-sdk-release-v2";
  check2(
    v2 && Object.keys(release).sort().join(",") === [
      "schema",
      "setup",
      "activation",
      "lock",
      "pins",
      "networkPolicy",
      "proving"
    ].sort().join(","),
    "compiled SDK release has unexpected fields or older-generation access"
  );
  assertPinnedFamilyEvmManifest(release);
  validateVantaFamilyProofConfiguration(release.proving, release);
  return compiledRelease = freezeFamilyCatalogValue(release);
}
function familyReleaseContextRecord(context) {
  const record = releaseContexts.get(context);
  check2(record, "a compiled generation capability is required");
  return record;
}
function isFamilyWithdrawalOnlyContext(context) {
  return context !== void 0 && familyReleaseContextRecord(context).mode === "withdraw-only";
}

// fresh/bootstrap-credential-scope.mjs
import { getAddress as getAddress4, getBytes as getBytes3, keccak256 as keccak2564, sha256 as sha2567, toUtf8Bytes as toUtf8Bytes4, verifyMessage as verifyMessage3 } from "ethers";
var scopes = /* @__PURE__ */ new WeakMap();
var SHA4 = /^[0-9a-f]{64}$/u;
var WORD5 = /^0x[0-9a-f]{64}$/u;
var canonical3 = (v) => Array.isArray(v) ? "[" + v.map(canonical3).join(",") + "]" : v && typeof v === "object" ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical3(v[k])).join(",") + "}" : JSON.stringify(v);
var hash2 = (v) => sha2567(toUtf8Bytes4(canonical3(v))).slice(2);
var check3 = (ok, m) => {
  if (!ok) throw Error("Bootstrap credentials: " + m);
};
var freeze = (v) => {
  if (v && typeof v === "object") {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
};
var sorted = (rows) => [...rows].sort((a, b) => a.name.localeCompare(b.name, "en"));
function createFamilyBootstrapCredentialScope(descriptor, expected) {
  const { setup, activation, familyRelease, networkPolicy, planSha256, handleRegistry, registrar, pools } = descriptor ?? {};
  check3(
    expected?.familyId === "dogeos" && setup?.schema === "stealthos-reusable-family-setup-v1" && WORD5.test(setup.setupId) && setup.setupId === expected?.setupId && setup.family?.id === expected.familyId && getAddress4(setup.family.activationAuthority) === getAddress4(expected.activationAuthority),
    "The selected setup or authority differs."
  );
  const { setupId, ...setupBody } = setup;
  check3(keccak2564(toUtf8Bytes4(canonical3(setupBody))) === setupId, "The setup identity is altered.");
  const familyTag2 = "0x" + (BigInt(keccak2564(toUtf8Bytes4("STEALTHOS_VANTA_CEREMONY_FAMILY_V1:eip155:dogeos"))) % 21888242871839275222246405745257275088548364400416034343698204186575808495617n).toString(16).padStart(64, "0");
  check3(setup.family.namespace === "eip155" && setup.family.tag === familyTag2, "The setup family domain differs.");
  const { signature, ...activationBody } = activation ?? {}, { generationId, ...unsignedActivation } = activationBody;
  check3(
    activation.schema === "stealthos-family-network-activation-v1" && activation.setupId === setupId && activation.familyId === setup.family.id && activation.familyTag === setup.family.tag && activation.generationId === expected.generationId && keccak2564(toUtf8Bytes4(canonical3(unsignedActivation))) === generationId && /^eip155:[1-9][0-9]*$/u.test(activation.network?.id) && activation.network.id === expected.networkId && activation.network.genesisHash === expected.genesisHash && WORD5.test(expected.genesisHash) && BigInt(expected.genesisHash) > 0n && ["testnet", "mainnet"].includes(activation.network.role) && Number.isSafeInteger(activation.revision) && activation.revision >= 0 && activation.revision < 2 ** 32,
    "The selected activation or network differs."
  );
  const digest2 = keccak2564(toUtf8Bytes4("STEALTHOS_VANTA_FAMILY_ACTIVATION_V1:" + canonical3(activationBody)));
  check3(
    verifyMessage3(getBytes3(digest2), signature) === getAddress4(expected.activationAuthority),
    "The network activation is not signed by the selected authority."
  );
  check3(
    networkPolicy?.schema === "stealthos-reviewed-family-networks-v1" && networkPolicy.familyId === setup.family.id && networkPolicy.sourceNetworkId === "eip155:" + setup.sourceNetwork.chainId && SHA4.test(expected.networkPolicySha256) && hash2(networkPolicy) === expected.networkPolicySha256 && Array.isArray(networkPolicy.networks) && networkPolicy.networks.length <= 8 && networkPolicy.networks.some((row) => canonical3(row) === canonical3(activation.network)),
    "The network is outside the pinned DogeOS family policy."
  );
  check3(
    familyRelease?.schema === "stealthos-family-ceremony-release-v2" && familyRelease.constructionProfile === FAMILY_PROFILE_V2 && familyRelease.beaconFinalized === true && canonical3(familyRelease.family) === canonical3(setup.family) && familyRelease.ceremony?.id === setup.ceremonyId && familyRelease.releaseHash === setup.ceremonyReleaseHash && familyRelease.verifierKeysSha256 === setup.verifierKeysSha256 && Array.isArray(familyRelease.artifacts),
    "A matching finalized eleven-role KZG ceremony release is required."
  );
  const { releaseHash, ...releaseBody } = familyRelease;
  check3(SHA4.test(releaseHash) && hash2(releaseBody) === releaseHash, "The ceremony release bytes are altered.");
  assertFamilyRoleInventory(familyRelease.derivations?.map((d) => d.familyId), FAMILY_PROFILE_V2);
  const inventory = sorted(familyRelease.artifacts), artifacts = /* @__PURE__ */ new Map();
  for (const ref of inventory) {
    check3(
      ref && /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/u.test(ref.name) && !ref.name.split("/").some((p) => p === "." || p === "..") && SHA4.test(ref.sha256) && Number.isSafeInteger(ref.bytes) && ref.bytes > 0 && ref.bytes <= 128 * 1024 * 1024 && !artifacts.has(ref.name),
      "Invalid or repeated final artifact."
    );
    artifacts.set(ref.name, ref);
  }
  const keyNames = new Set(familyRelease.derivations.flatMap((d) => [d.sourceArtifact, ...d.verifierArtifacts]));
  check3(
    [...keyNames].every((n) => artifacts.has(n)) && hash2(inventory) === setup.artifactInventorySha256 && hash2(inventory.filter((ref) => keyNames.has(ref.name))) === setup.verifierKeysSha256,
    "The final key or artifact inventory differs from the activated setup."
  );
  check3(
    SHA4.test(planSha256) && planSha256 === expected.planSha256 && getAddress4(handleRegistry) === getAddress4(expected.handleRegistry) && getAddress4(registrar) === getAddress4(expected.registrar) && Array.isArray(pools) && pools.length >= 2 && pools.length <= 8 && canonical3(pools) === canonical3(expected.pools) && new Set([handleRegistry, registrar, ...pools].map((a) => getAddress4(a).toLowerCase())).size === pools.length + 2,
    "The namespace or pools differ from the selected deployment plan."
  );
  for (const address of [handleRegistry, registrar, ...pools]) check3(BigInt(getAddress4(address)) > 0n, "Zero bootstrap contract.");
  const credentials = Object.fromEntries(["handle-register", "partner-owner"].map((role) => [
    role,
    Object.fromEntries(Object.entries({ witnessWasm: "circuit.wasm", zkey: "final.zkey", verificationKey: "verification-key.json" }).map(([kind, file]) => {
      const name = role + "/" + file, ref = artifacts.get(name);
      check3(ref, "Missing final credential artifact: " + name);
      return [kind, { path: name, sha256: ref.sha256, bytes: ref.bytes }];
    }))
  ]));
  const chainId = Number(activation.network.id.slice(7));
  check3(Number.isSafeInteger(chainId) && chainId > 0 && WORD5.test(expected.genesisHash), "Invalid target chain.");
  const value2 = freeze({
    chainId,
    networkId: activation.network.id,
    familyTag: setup.family.tag,
    setupId,
    generationId,
    genesisHash: activation.network.genesisHash,
    planSha256,
    handleRegistry: getAddress4(handleRegistry),
    registrar: getAddress4(registrar),
    pools: pools.map(getAddress4),
    credentials,
    pins: { networkId: activation.network.id },
    setup: { family: { tag: setup.family.tag } }
  });
  const ticket = Object.freeze({});
  scopes.set(ticket, value2);
  return ticket;
}
function getFamilyBootstrapCredentialContext(ticket) {
  const value2 = scopes.get(ticket);
  check3(value2, "An authenticated bootstrap credential scope is required.");
  return value2;
}

// fresh/partner-credential-prover.mjs
var FR2 = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
var FQ = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
var H32 = /^0x[0-9a-f]{64}$/iu;
var value = (input, label, nonzero2 = true) => {
  if (typeof input !== "string" || !H32.test(input))
    throw Error("Invalid fresh credential " + label + ".");
  const n = BigInt(input);
  if (n >= FR2 || nonzero2 && n === 0n)
    throw Error("Fresh credential " + label + " exceeds the scalar field.");
  return n;
};
var digestField = (input, label) => {
  if (typeof input !== "string" || !H32.test(input))
    throw Error("Invalid fresh credential " + label + ".");
  return BigInt(input) % FR2;
};
function coordinates(proof) {
  const words = [
    proof?.pi_a?.[0],
    proof?.pi_a?.[1],
    proof?.pi_b?.[0]?.[1],
    proof?.pi_b?.[0]?.[0],
    proof?.pi_b?.[1]?.[1],
    proof?.pi_b?.[1]?.[0],
    proof?.pi_c?.[0],
    proof?.pi_c?.[1]
  ];
  if (words.some((item) => typeof item !== "string" || !/^(0|[1-9][0-9]*)$/u.test(item) || BigInt(item) >= FQ))
    throw Error("Fresh credential proof has invalid BN254 coordinates.");
  return Object.freeze(words.map(BigInt));
}
async function executePinnedCredential(input, expected, artifacts, signal) {
  try {
    const [wasm, zkey, vkey] = artifacts.map((item) => item.bytes);
    const verificationKey = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(vkey));
    if (verificationKey?.protocol !== "groth16" || Number(verificationKey?.nPublic) !== expected.length)
      throw Error("Fresh credential verification key has another relation.");
    if (signal?.aborted) throw Error("Fresh credential proof cancelled.");
    const snarkjs = await import("snarkjs");
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      input,
      wasm,
      zkey,
      void 0,
      void 0,
      { singleThread: true }
    );
    if (signal?.aborted) throw Error("Fresh credential proof cancelled.");
    if (!Array.isArray(publicSignals) || publicSignals.length !== expected.length || publicSignals.some((item, index) => !/^(0|[1-9][0-9]*)$/u.test(item) || BigInt(item) !== expected[index]) || !await snarkjs.groth16.verify(verificationKey, publicSignals, proof))
      throw Error("Fresh credential proof failed exact public-signal verification.");
    return coordinates(proof);
  } finally {
    for (const artifact of artifacts) artifact.bytes.fill(0);
  }
}
async function proveFamilyCredential(kind, input, expected, options) {
  const bootstrap = options?.credentialScope ? getFamilyBootstrapCredentialContext(options.credentialScope) : null;
  const inventory = bootstrap ?? getCompiledVantaFamilyProofResources(getCompiledFamilyEvmRelease(options?.releaseContext), options?.releaseContext);
  const reader = createVantaFamilyProofArtifactReader(options), pins = inventory.credentials[kind];
  if (!pins) throw Error("Family credential artifacts are not compiled.");
  const artifacts = await Promise.all(["witnessWasm", "zkey", "verificationKey"].map(async (key) => ({ bytes: await reader.bytes(pins[key]) })));
  return executePinnedCredential(input, expected, artifacts, options.signal);
}
async function proveFamilyHandleClaim(witness, options) {
  const release = options?.credentialScope ? getFamilyBootstrapCredentialContext(options.credentialScope) : getCompiledFamilyEvmRelease(options?.releaseContext), chain = BigInt(release.pins.networkId.slice(7));
  if (BigInt(witness.chainId) !== chain || witness.epoch !== 1)
    throw Error("Family handle proof targets another compiled network.");
  const id = value(witness.handleId, "handle ID"), record = value(witness.recordCommitment, "record"), owner = value(witness.ownerCommitment, "owner"), nullifier = value(witness.nullifier, "nullifier"), hsk = value(witness.hsk, "handle secret"), label = digestField(witness.handleLabelHash, "label"), recordHash = digestField(witness.recordHash, "record hash");
  return proveFamilyCredential(
    "handle-register",
    {
      handleId: id.toString(),
      recordCommitment: record.toString(),
      ownerCommitment: owner.toString(),
      epoch: "1",
      nullifier: nullifier.toString(),
      chainId: chain.toString(),
      actionTag: "1",
      handleLabelHash: label.toString(),
      recordHash: recordHash.toString(),
      hsk: hsk.toString()
    },
    [id, record, owner, 1n, nullifier, chain, 1n],
    options
  );
}
async function proveFamilyPartnerOwner(witness, options) {
  const release = options?.credentialScope ? getFamilyBootstrapCredentialContext(options.credentialScope) : getCompiledFamilyEvmRelease(options?.releaseContext), chain = BigInt(release.pins.networkId.slice(7)), family = BigInt(release.setup.family.tag);
  if (BigInt(witness.chainId) !== chain || BigInt(witness.familyTag) !== family)
    throw Error("Family owner proof targets another compiled generation.");
  const names = [
    "handleId",
    "ownerCommitment",
    "authorizationCommitment",
    "actionDigest",
    "authorizationNullifier",
    "hsk",
    "signingAddress",
    "signingSalt"
  ];
  const fields = Object.fromEntries(names.map((name) => [name, value(witness[name], name)]));
  if (fields.signingAddress >= 1n << 160n) throw Error("Family owner signer exceeds 160 bits.");
  const input = Object.fromEntries(names.map((name) => [name === "signingAddress" ? "signerAddress" : name === "signingSalt" ? "signerSalt" : name, fields[name].toString()]));
  input.familyTag = family.toString();
  input.chainId = chain.toString();
  return proveFamilyCredential(
    "partner-owner",
    input,
    [family, chain, ...names.slice(0, 5).map((name) => fields[name])],
    options
  );
}

// fresh/family-deposit-partner-auth.mjs
import {
  getAddress as getAddress5,
  isHexString as isHexString2,
  randomBytes as randomBytes3,
  hexlify as hexlify2,
  toBeHex,
  verifyTypedData
} from "ethers";
var FR3 = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
var CAP = (1n << 120n) - 1n;
var H322 = /^0x[0-9a-f]{64}$/iu;
var FRESH_PARTNER_DEPOSIT_AUTH_TYPES = Object.freeze({
  PartnerDepositAuthorization: Object.freeze([
    ["handleId", "bytes32"],
    ["pool", "address"],
    ["asset", "address"],
    ["payer", "address"],
    ["count", "uint8"],
    ["gross", "uint128"],
    ["protocolFeeCap", "uint128"],
    ["partnerFeeCap", "uint128"],
    ["outputsHash", "bytes32"],
    ["envelopesHash", "bytes32"],
    ["feeSlotsHash", "bytes32"],
    ["feeTermsHash", "uint256"],
    ["partnerRegistryRoot", "uint256"],
    ["signerSalt", "uint256"],
    ["requestNonce", "bytes32"],
    ["deadline", "uint64"]
  ].map(([name, type]) => Object.freeze({ name, type })))
});
var exact6 = (value2, fields) => value2 && typeof value2 === "object" && !Array.isArray(value2) && Object.keys(value2).sort().join() === fields.slice().sort().join();
var hash3 = (value2, label) => {
  if (typeof value2 !== "string" || !H322.test(value2))
    throw Error("Invalid family " + label + " hash.");
  return value2.toLowerCase();
};
var units = (value2, label, max) => {
  if (typeof value2 !== "string" || !/^(0|[1-9][0-9]*)$/u.test(value2) || value2.length > 80 || BigInt(value2) > max)
    throw Error("Invalid family " + label + " units.");
  return BigInt(value2);
};
async function signFamilyDepositPartnerAuthorization({
  release,
  resources,
  asset,
  handleId,
  request,
  signer,
  signerSalt,
  deadline,
  requestNonce,
  now = Math.floor(
    Date.now() / 1e3
  )
}) {
  if (!Number.isSafeInteger(resources?.chainId) || !H322.test(resources.generationId) || !isFamilyAssetSelection(asset) || typeof signer?.signTypedData !== "function" || !Number.isSafeInteger(now) || !Number.isSafeInteger(deadline) || deadline <= now || deadline > now + 300)
    throw Error("Family partner quote requires a compiled release and short expiry.");
  const rows = release.lock.contracts.filter((r) => r.name === "partner-registrar");
  const pin = rows.length === 1 ? {
    pool: resources.deployment.pool,
    assetAddress: resources.deployment.asset,
    modules: { partnerRegistrar: rows[0] }
  } : null;
  if (!pin || !pin.modules?.partnerRegistrar?.address || !exact6(request, [
    "payer",
    "count",
    "gross",
    "protocolFeeCap",
    "partnerFeeCap",
    "outputsHash",
    "envelopesHash",
    "feeSlotsHash",
    "feeTermsHash",
    "partnerRegistryRoot"
  ]))
    throw Error("Family partner quote request or release is incomplete.");
  const id = hash3(handleId, "handle ID"), salt = BigInt(signerSalt), nonce = hash3(requestNonce ?? hexlify2(randomBytes3(32)), "request nonce");
  if (BigInt(id) <= 0n || BigInt(id) >= FR3 || salt <= 0n || salt >= FR3 || BigInt(nonce) === 0n || request.count !== 3)
    throw Error("Family partner identity or quote nonce is invalid.");
  const gross = units(request.gross, "gross", CAP), protocolFeeCap = units(request.protocolFeeCap, "protocol fee", CAP), partnerFeeCap = units(request.partnerFeeCap, "partner fee", CAP), feeTermsHash = units(request.feeTermsHash, "fee terms", FR3 - 1n), partnerRegistryRoot = units(
    request.partnerRegistryRoot,
    "partner root",
    FR3 - 1n
  );
  if (gross === 0n || protocolFeeCap !== 0n || partnerFeeCap >= gross || feeTermsHash === 0n || partnerRegistryRoot === 0n)
    throw Error("Family partner quote does not preserve a positive owned note.");
  const domain = Object.freeze({
    name: "Vanta Partner Quote",
    version: "2",
    chainId: resources.chainId,
    verifyingContract: getAddress5(
      pin.modules.partnerRegistrar.address
    )
  });
  const message = Object.freeze({
    handleId: id,
    pool: getAddress5(pin.pool),
    asset: getAddress5(pin.assetAddress),
    payer: getAddress5(request.payer),
    count: request.count,
    gross,
    protocolFeeCap,
    partnerFeeCap,
    outputsHash: hash3(request.outputsHash, "outputs"),
    envelopesHash: hash3(request.envelopesHash, "envelopes"),
    feeSlotsHash: hash3(request.feeSlotsHash, "fee slots"),
    feeTermsHash,
    partnerRegistryRoot,
    signerSalt: salt,
    requestNonce: nonce,
    deadline
  });
  if (message.payer === "0x0000000000000000000000000000000000000000")
    throw Error("Family deposit payer is zero.");
  const signature = await signer.signTypedData(
    domain,
    FRESH_PARTNER_DEPOSIT_AUTH_TYPES,
    message
  );
  if (!isHexString2(signature, 65))
    throw Error("Family partner authorization signature is invalid.");
  return Object.freeze({
    handleId: id,
    signerSalt: toBeHex(salt, 32),
    requestNonce: nonce,
    deadline,
    signature
  });
}

// fresh/family-partner-app-config-core.mjs
import { AbiCoder as AbiCoder2, Interface as Interface2, getAddress as getAddress6, keccak256 as keccak2566, toUtf8Bytes as toUtf8Bytes6 } from "ethers";

// fresh/partner-application.mjs
import { keccak256 as keccak2565, toUtf8Bytes as toUtf8Bytes5 } from "ethers";
function normalizePartnerApplication(value2) {
  const fail3 = () => {
    throw Error("Enter an app name and HTTPS app origins. No partner backend is required.");
  };
  const legacy = Object.keys(value2 ?? {}).sort().join() === "authorizationUrl,name,origins";
  if (!value2 || !legacy && Object.keys(value2).sort().join() !== "name,origins" || typeof value2.name !== "string" || value2.name !== value2.name.trim() || value2.name.length < 1 || value2.name.length > 80 || !Array.isArray(value2.origins) || value2.origins.length < 1 || value2.origins.length > 8) fail3();
  const origins = value2.origins.map((raw) => {
    let u;
    try {
      u = new URL(raw);
    } catch {
      fail3();
    }
    if (u.protocol !== "https:" || u.origin !== raw || u.username || u.password || u.pathname !== "/" || u.search || u.hash) fail3();
    return u.origin;
  });
  if (new Set(origins).size !== origins.length || JSON.stringify(origins) !== JSON.stringify([...origins].sort())) fail3();
  if (!legacy) return Object.freeze({ name: value2.name, origins: Object.freeze(origins) });
  let endpoint;
  try {
    endpoint = new URL(value2.authorizationUrl);
  } catch {
    fail3();
  }
  if (endpoint.protocol !== "https:" || !origins.includes(endpoint.origin) || endpoint.pathname !== "/api/vanta-v8/partner/authorize" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) fail3();
  return Object.freeze({ name: value2.name, origins: Object.freeze(origins), authorizationUrl: endpoint.href });
}
function partnerApplicationHash(value2) {
  const app = normalizePartnerApplication(value2);
  return keccak2565(toUtf8Bytes5(JSON.stringify(app.authorizationUrl ? [app.name, app.origins, app.authorizationUrl] : ["stealthos-partner-app-v2", app.name, app.origins])));
}

// fresh/family-partner-app-config-core.mjs
var coder2 = AbiCoder2.defaultAbiCoder();
var FR4 = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
var abi = new Interface2([
  "function partnerIdentity(bytes32) view returns(uint256 authorizationCommitment,uint256 receiverCommitment,bytes32 routingCommitment,bytes32 salt,uint64 nextRevision,bool exists)",
  "function registeredAssetMask(bytes32) view returns(uint8)",
  "function getHandleState(bytes32) view returns(bytes32 recordCommitment,bytes32 ownerCommitment,uint64 epoch,bool exists)",
  "function verifyProof(uint256[2],uint256[2][2],uint256[2],uint256[7]) view returns(bool)"
]);
var fail2 = () => {
  throw Error("Partner asset configuration is not authorized for the signed deployment.");
};
function partnerAssetConfigurationDigest(configuration, authorizationCommitment) {
  const c = configuration;
  const application = c?.schema === "stealthos-partner-app-assets-v2";
  if (!c || Object.keys(c).sort().join() !== (application ? "app," : "") + "deadline,generationId,genesisHash,handle,handleId,networkId,registrar,revision,schema,setupId,visibleAssets" || !["stealthos-partner-app-assets-v1", "stealthos-partner-app-assets-v2"].includes(c.schema) || !/^eip155:[1-9][0-9]*$/u.test(c.networkId) || !/^[a-z0-9][a-z0-9.-]{1,63}$/u.test(c.handle) || !Array.isArray(c.visibleAssets) || c.visibleAssets.length > 8 || new Set(c.visibleAssets.map((a) => getAddress6(a).toLowerCase())).size !== c.visibleAssets.length || !/^[1-9][0-9]{0,19}$/u.test(c.revision) || BigInt(c.revision) >= 1n << 64n || !Number.isSafeInteger(c.deadline) || c.deadline < 1 || BigInt(c.deadline) >= 1n << 64n) fail2();
  const digest2 = BigInt(keccak2566(coder2.encode(
    ["bytes32", "uint256", "address", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32", "uint256", "address[]", "uint64", "uint64"],
    [
      keccak2566(toUtf8Bytes6("STEALTHOS_PARTNER_APP_ASSETS_V1")),
      BigInt(c.networkId.split(":")[1]),
      c.registrar,
      c.setupId,
      c.generationId,
      c.genesisHash,
      c.handleId,
      keccak2566(toUtf8Bytes6(c.handle)),
      authorizationCommitment,
      c.visibleAssets,
      BigInt(c.revision),
      BigInt(c.deadline)
    ]
  ))) % FR4;
  return application ? BigInt(keccak2566(coder2.encode(
    ["bytes32", "uint256", "bytes32"],
    [keccak2566(toUtf8Bytes6("STEALTHOS_PARTNER_APPLICATION_V2")), digest2, partnerApplicationHash(c.app)]
  ))) % FR4 : digest2;
}

// fresh/wallet-entry.ts
function familyWalletScope(releaseContext) {
  const release = getCompiledFamilyEvmRelease(releaseContext), inventory = getCompiledVantaFamilyProofResources(release, releaseContext);
  const role = (name) => {
    const rows = release.lock.contracts.filter((row) => row.name === name);
    if (rows.length !== 1) throw Error("Compiled family wallet role is missing or duplicated.");
    return rows[0].address;
  };
  return {
    profile: inventory.partnerPolicyKzg,
    handleRegistry: role("handle-registry"),
    registrar: role("partner-registrar"),
    registry: role("partner-registry"),
    pools: inventory.funding.pools.map((p) => getAddress7(p.pool))
  };
}
var ROOT_DOMAIN = "StealthOS Vanta V8 partner root v1";
var AUTH_PATH = "m/44'/60'/0'/0/7";
var AUTH_SALT_DOMAIN = "STEALTHOS_VANTA_V8_PARTNER_SIGNER_SALT_V1";
var RECEIVER_SALT_DOMAIN = "STEALTHOS_VANTA_V8_RECEIVER_SALT_V2";
var RECORD_SALT_DOMAIN = "STEALTHOS_VANTA_V8_PARTNER_RECORD_SALT_V1";
var OWNER_DOMAIN = "stealthos-vanta-v8-handle-owner-v1";
var RELAY_DOMAIN = "STEALTHOS_VANTA_V8_HANDLE_RELAY_V1";
var RECORD_DOMAIN = keccak2567(toUtf8Bytes7("VANTA_PARTNER_HANDLE_BINDING_V3"));
var ROUTE_DOMAIN = keccak2567(toUtf8Bytes7("VANTA_PRIVATE_RECEIVING_ROUTE_V2"));
var COLLECTOR_ROLE_DOMAIN = keccak2567(toUtf8Bytes7("VANTA_FEE_COLLECTOR_ROLE_ACTIVATE_V1"));
var BOOTSTRAP_IDENTITIES = ["protocol", "relayer"];
var SCOPE = 0x565243563201n;
var coder3 = AbiCoder3.defaultAbiCoder();
var handleAbi = new Interface3([
  "function registerAnonymous(bytes32,bytes32,bytes32,uint256[8],bytes32,uint64)"
]);
var collectorAbi = new Interface3([
  "function activateFeeCollector(address,uint8,bytes32,uint256,uint256,uint256,bytes32,bytes32,uint64,uint256[8],uint256)"
]);
var FR5 = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
var FQ2 = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
var h32 = (value2) => "0x" + value2.toString(16).padStart(64, "0");
var validProof = (proof) => Array.isArray(proof) && proof.length === 8 && proof.every((x) => typeof x === "bigint" && x >= 0n && x < FQ2);
var VantaFreshPrivateWallet = class _VantaFreshPrivateWallet {
  #root;
  #quoteKey;
  #signingSalt;
  #receiverSalt;
  constructor(root, quoteKey, signingSalt, receiverSalt) {
    this.#root = root;
    this.#quoteKey = quoteKey;
    this.#signingSalt = signingSalt;
    this.#receiverSalt = receiverSalt;
  }
  static async create() {
    const temporary = HDNodeWallet.createRandom();
    const phrase = temporary.mnemonic?.phrase;
    if (!phrase || phrase.trim().split(/\s+/u).length !== 12)
      throw Error("Unable to create fresh wallet recovery phrase.");
    return Object.freeze({ wallet: await this.restore(phrase), recoveryPhrase: phrase });
  }
  static async restore(phrase) {
    if (typeof phrase !== "string" || phrase.trim().split(/\s+/u).length !== 12)
      throw Error("Enter the twelve-word wallet recovery phrase.");
    const signer = HDNodeWallet.fromPhrase(phrase.trim(), void 0, AUTH_PATH);
    const seed = signer.mnemonic?.computeSeed();
    if (!seed) throw Error("Invalid wallet recovery phrase.");
    const root = getBytes4(keccak2567(concat2([
      toUtf8Bytes7(ROOT_DOMAIN),
      getBytes4(seed)
    ])));
    if (root.length !== 32 || !root.some((x) => x !== 0))
      throw Error("Invalid fresh wallet root.");
    const signingSalt = BigInt(keccak2567(AbiCoder3.defaultAbiCoder().encode(
      ["string", "bytes32"],
      [AUTH_SALT_DOMAIN, hexlify3(root)]
    ))) % FR5;
    if (signingSalt === 0n) throw Error("Invalid fresh partner signing salt.");
    const receiverSalt = BigInt(keccak2567(coder3.encode(
      ["string", "bytes32"],
      [RECEIVER_SALT_DOMAIN, hexlify3(root)]
    ))) % FR5;
    if (receiverSalt === 0n) throw Error("Invalid fresh receiver salt.");
    return new _VantaFreshPrivateWallet(
      root,
      getBytes4(signer.privateKey),
      signingSalt,
      receiverSalt
    );
  }
  async privateWalletKeys() {
    if (this.#root.length !== 32 || !this.#root.some((x) => x !== 0))
      throw Error("Fresh wallet is locked.");
    return deriveKeysFromSeed(this.#root);
  }
  async publicReceivingIdentity() {
    const keys = await this.privateWalletKeys();
    return Object.freeze({
      masterPublicKey: keys.masterPublicKey,
      viewingPublicKey: new Uint8Array(keys.viewingPublicKey)
    });
  }
  /** Public constructor commitments for an operator's local bootstrap wallet.
   * Recovery material, MPK, receiver salt and quote signer remain local. */
  async publicBootstrapIdentity() {
    this.#requireWallet();
    const keys = await this.privateWalletKeys();
    const authorizationCommitment = BigInt(await poseidonAsync([
      BigInt(new Wallet(hexlify3(this.#quoteKey)).address),
      this.#signingSalt
    ]));
    const proofCommitment = BigInt(await poseidonAsync([BigInt(keys.masterPublicKey), this.#receiverSalt]));
    if ([authorizationCommitment, proofCommitment].some((value2) => value2 <= 0n || value2 >= FR5))
      throw Error("Invalid public bootstrap wallet commitments.");
    return Object.freeze({ authorizationCommitment, proofCommitment });
  }
  #requireWallet() {
    if (this.#root.length !== 32 || !this.#root.some((x) => x !== 0) || this.#quoteKey.length !== 32 || !this.#quoteKey.some((x) => x !== 0))
      throw Error("Fresh partner wallet is locked.");
  }
  #handleSecret(handle, registry, chainId) {
    this.#requireWallet();
    const hsk = BigInt(keccak2567(coder3.encode(
      ["string", "uint256", "address", "bytes32", "string"],
      [OWNER_DOMAIN, chainId, registry, hexlify3(this.#root), handle]
    ))) % FR5;
    if (hsk === 0n) throw Error("Invalid fresh handle secret.");
    return hsk;
  }
  async #partnerIdentity(handleInput, registryInput, chainId) {
    this.#requireWallet();
    const handle = normalizeVantaFamilyHandle(handleInput), registry = getAddress7(registryInput);
    if (registry === "0x0000000000000000000000000000000000000000")
      throw Error("Fresh receiving route requires the compiled handle registry.");
    const handleId = h32(BigInt(await poseidonAsync([
      BigInt(keccak2567(toUtf8Bytes7(handle))),
      chainId
    ])));
    const signer = new Wallet(hexlify3(this.#quoteKey));
    const authorizationCommitment = BigInt(await poseidonAsync([
      BigInt(signer.address),
      this.#signingSalt
    ]));
    const keys = await this.privateWalletKeys();
    const mpk = BigInt(keys.masterPublicKey);
    if (mpk <= 0n || mpk >= FR5 || authorizationCommitment <= 0n || authorizationCommitment >= FR5) throw Error("Invalid fresh partner identity.");
    const scope = BigInt(await poseidonAsync([BigInt(handleId), SCOPE]));
    const receiverCommitment = BigInt(await poseidonAsync([
      mpk,
      this.#receiverSalt,
      scope
    ]));
    const viewingPublicKey = hexlify3(keys.viewingPublicKey).toLowerCase();
    const routingCommitment = keccak2567(coder3.encode([
      "bytes32",
      "uint256",
      "address",
      "bytes32",
      "uint256",
      "bytes32",
      "bytes32",
      "uint256"
    ], [
      ROUTE_DOMAIN,
      chainId,
      registry,
      handleId,
      mpk,
      viewingPublicKey,
      h32(this.#receiverSalt),
      receiverCommitment
    ])).toLowerCase();
    return {
      handle,
      handleId,
      registry,
      signerAddress: signer.address,
      authorizationCommitment,
      receiverCommitment,
      routingCommitment,
      collectorMpk: mpk,
      viewingPublicKey,
      hsk: this.#handleSecret(handle, registry, chainId)
    };
  }
  async #preparePartnerHandleClaim({ handle, registry, artifactBaseUrl, fetcher, signal, chainId, prove, bootstrapIdentity, releaseContext }) {
    const identity = await this.#partnerIdentity(handle, registry, chainId);
    if (bootstrapIdentity !== void 0 && (!BOOTSTRAP_IDENTITIES.includes(bootstrapIdentity) || identity.handle !== bootstrapIdentity + ".stealth"))
      throw Error("Invalid bootstrap infrastructure identity.");
    if (bootstrapIdentity === void 0 && ["protocol.stealth", "relayer.stealth"].includes(identity.handle))
      throw Error("Bootstrap fee handles cannot be claimed by partner onboarding.");
    const salt = keccak2567(coder3.encode(
      [
        "string",
        "uint256",
        "address",
        "bytes32",
        "string"
      ],
      [
        RECORD_SALT_DOMAIN,
        chainId,
        identity.registry,
        hexlify3(this.#root),
        identity.handle
      ]
    ));
    const labelHash = keccak2567(toUtf8Bytes7(identity.handle));
    const recordHash = keccak2567(coder3.encode([
      "bytes32",
      "uint256",
      "address",
      "bytes32",
      "uint256",
      "uint256",
      "bytes32",
      "bytes32"
    ], [
      RECORD_DOMAIN,
      chainId,
      identity.registry,
      identity.handleId,
      identity.authorizationCommitment,
      identity.receiverCommitment,
      identity.routingCommitment,
      salt
    ]));
    const recordCommitment = h32(BigInt(await poseidonAsync([
      BigInt(recordHash),
      1n,
      chainId
    ])));
    const ownerCommitment = h32(BigInt(await poseidonAsync([
      identity.hsk,
      BigInt(identity.handleId),
      chainId
    ])));
    const nullifier = h32(BigInt(await poseidonAsync([
      identity.hsk,
      BigInt(identity.handleId),
      1n,
      1n,
      chainId
    ])));
    const proof = await prove(
      {
        chainId: Number(chainId),
        epoch: 1,
        handleId: identity.handleId,
        handleLabelHash: labelHash,
        recordHash,
        recordCommitment,
        ownerCommitment,
        nullifier,
        hsk: h32(identity.hsk)
      },
      { artifactBaseUrl, fetcher, signal, releaseContext }
    );
    if (!validProof(proof)) throw Error("Fresh handle proof is malformed.");
    const calldata = handleAbi.encodeFunctionData("registerAnonymous", [
      identity.handleId,
      recordCommitment,
      ownerCommitment,
      proof,
      nullifier,
      1
    ]);
    const settlementNonce = keccak2567(coder3.encode([
      "string",
      "uint256",
      "address",
      "bytes32"
    ], [
      RELAY_DOMAIN,
      chainId,
      identity.registry,
      keccak2567(calldata)
    ])).toLowerCase();
    return Object.freeze({
      handle: identity.handle,
      handleId: identity.handleId,
      registry: identity.registry,
      recordHash,
      recordCommitment,
      ownerCommitment,
      nullifier,
      authorizationCommitment: identity.authorizationCommitment,
      receiverCommitment: identity.receiverCommitment,
      routingCommitment: identity.routingCommitment,
      salt,
      calldata,
      settlementNonce
    });
  }
  /** Reconstruct public handle ownership from recovery keys without proving,
   * signing, or contacting a service. The caller must authenticate it on chain. */
  async exportFamilyHandleBinding({ handle, releaseContext }) {
    const scope = familyWalletScope(releaseContext), chainId = BigInt(scope.profile.chainId);
    const identity = await this.#partnerIdentity(handle, scope.handleRegistry, chainId);
    const salt = keccak2567(coder3.encode(
      ["string", "uint256", "address", "bytes32", "string"],
      [RECORD_SALT_DOMAIN, chainId, identity.registry, hexlify3(this.#root), identity.handle]
    ));
    const recordHash = keccak2567(coder3.encode(
      ["bytes32", "uint256", "address", "bytes32", "uint256", "uint256", "bytes32", "bytes32"],
      [RECORD_DOMAIN, chainId, identity.registry, identity.handleId, identity.authorizationCommitment, identity.receiverCommitment, identity.routingCommitment, salt]
    ));
    return Object.freeze({
      authorizationCommitment: h32(identity.authorizationCommitment),
      salt,
      ownerCommitment: h32(BigInt(await poseidonAsync([identity.hsk, BigInt(identity.handleId), chainId]))),
      recordCommitment: h32(BigInt(await poseidonAsync([BigInt(recordHash), 1n, chainId])))
    });
  }
  async exportFamilyPartnerReceivingRoute({ handle, releaseContext }) {
    const scope = familyWalletScope(releaseContext);
    const identity = await this.#partnerIdentity(handle, scope.handleRegistry, BigInt(scope.profile.chainId));
    return Object.freeze({
      schema: "vanta-family-private-route-v1",
      chainId: scope.profile.chainId,
      familyTag: scope.profile.familyTag,
      generationId: scope.profile.generationId,
      registry: identity.registry,
      handle: identity.handle,
      handleId: identity.handleId,
      receiverCommitment: h32(identity.receiverCommitment),
      routingCommitment: identity.routingCommitment,
      collectorMpk: h32(identity.collectorMpk),
      viewingPublicKey: identity.viewingPublicKey,
      receiverSalt: h32(this.#receiverSalt)
    });
  }
  /** Public receiving data only; the bootstrap's exact credential capability
   * selects the new generation before a sealed SDK exists. */
  async exportFamilyBootstrapReceivingRoute({ identity: role, credentialScope }) {
    if (!BOOTSTRAP_IDENTITIES.includes(role)) throw Error("Unknown bootstrap identity.");
    const scope = getFamilyBootstrapCredentialContext(credentialScope), identity = await this.#partnerIdentity(role + ".stealth", scope.handleRegistry, BigInt(scope.chainId));
    return Object.freeze({
      schema: "vanta-family-private-route-v1",
      chainId: scope.chainId,
      familyTag: scope.familyTag,
      generationId: scope.generationId,
      registry: identity.registry,
      handle: identity.handle,
      handleId: identity.handleId,
      receiverCommitment: h32(identity.receiverCommitment),
      routingCommitment: identity.routingCommitment,
      collectorMpk: h32(identity.collectorMpk),
      viewingPublicKey: identity.viewingPublicKey,
      receiverSalt: h32(this.#receiverSalt)
    });
  }
  async prepareFamilyPartnerHandleClaim(input) {
    if (isFamilyWithdrawalOnlyContext(input.releaseContext)) throw Error("Historical generations cannot register new partners.");
    const scope = familyWalletScope(input.releaseContext);
    return this.#preparePartnerHandleClaim({
      ...input,
      registry: scope.handleRegistry,
      chainId: BigInt(scope.profile.chainId),
      prove: proveFamilyHandleClaim,
      bootstrapIdentity: void 0
    });
  }
  /** Bootstrap uses the same actual credential relation, never an admin bypass.
   * The two returned claims are submitted in one namespace-factory CREATE. */
  async prepareFamilyBootstrapHandleClaim(input) {
    if (!BOOTSTRAP_IDENTITIES.includes(input.identity)) throw Error("Unknown bootstrap identity.");
    const scope = getFamilyBootstrapCredentialContext(input.credentialScope);
    return this.#preparePartnerHandleClaim({
      handle: input.identity + ".stealth",
      registry: scope.handleRegistry,
      chainId: BigInt(scope.chainId),
      prove: (witness, options) => proveFamilyHandleClaim(
        witness,
        { ...options, credentialScope: input.credentialScope }
      ),
      bootstrapIdentity: input.identity,
      artifactBaseUrl: input.artifactBaseUrl,
      fetcher: input.fetcher,
      signal: input.signal
    });
  }
  /** Prepare one genuine owner proof for one infrastructure role on one pool. */
  async prepareFamilyBootstrapCollector(input) {
    const role = input.identity === "protocol" ? 0 : input.identity === "relayer" ? 2 : -1;
    if (role < 0) throw Error("Unknown bootstrap collector role.");
    const scope = getFamilyBootstrapCredentialContext(input.credentialScope), chainId = BigInt(scope.chainId), pool = getAddress7(input.pool);
    if (!scope.pools.includes(pool))
      throw Error("Bootstrap collector pool is outside the compiled generation.");
    const now = BigInt(Math.floor(Date.now() / 1e3));
    if (input.deadline <= now || input.deadline > now + 3600n) throw Error("Collector proof must expire within one hour.");
    const identity = await this.#partnerIdentity(input.identity + ".stealth", scope.handleRegistry, chainId);
    const salt = keccak2567(coder3.encode(
      ["string", "uint256", "address", "bytes32", "string"],
      [RECORD_SALT_DOMAIN, chainId, identity.registry, hexlify3(this.#root), identity.handle]
    ));
    const ownerCommitment = h32(BigInt(await poseidonAsync([identity.hsk, BigInt(identity.handleId), chainId])));
    const keys = await this.privateWalletKeys(), proofCommitment = BigInt(await poseidonAsync([
      BigInt(keys.masterPublicKey),
      this.#receiverSalt
    ]));
    if (proofCommitment <= 0n || proofCommitment >= FR5) throw Error("Invalid collector proof commitment.");
    const actionDigest = BigInt(keccak2567(coder3.encode(
      [
        "bytes32",
        "uint256",
        "address",
        "bytes32",
        "bytes32",
        "bytes32",
        "address",
        "uint8",
        "bytes32",
        "uint256",
        "uint256",
        "uint256",
        "bytes32",
        "bytes32",
        "uint64"
      ],
      [
        COLLECTOR_ROLE_DOMAIN,
        chainId,
        scope.registrar,
        scope.setupId,
        scope.generationId,
        scope.genesisHash,
        pool,
        role,
        identity.handleId,
        identity.authorizationCommitment,
        identity.receiverCommitment,
        proofCommitment,
        identity.routingCommitment,
        salt,
        input.deadline
      ]
    ))) % FR5;
    const authorizationNullifier = BigInt(await poseidonAsync([identity.hsk, actionDigest]));
    const ownershipProof = await proveFamilyPartnerOwner(
      {
        chainId: Number(chainId),
        familyTag: scope.familyTag,
        handleId: identity.handleId,
        ownerCommitment,
        authorizationCommitment: h32(identity.authorizationCommitment),
        actionDigest: h32(actionDigest),
        authorizationNullifier: h32(authorizationNullifier),
        hsk: h32(identity.hsk),
        signingAddress: h32(BigInt(identity.signerAddress)),
        signingSalt: h32(this.#signingSalt)
      },
      { credentialScope: input.credentialScope, artifactBaseUrl: input.artifactBaseUrl, fetcher: input.fetcher, signal: input.signal }
    );
    if (!validProof(ownershipProof)) throw Error("Bootstrap collector owner proof is malformed.");
    const calldata = collectorAbi.encodeFunctionData("activateFeeCollector", [
      pool,
      role,
      identity.handleId,
      identity.authorizationCommitment,
      identity.receiverCommitment,
      proofCommitment,
      identity.routingCommitment,
      salt,
      input.deadline,
      ownershipProof,
      authorizationNullifier
    ]);
    return Object.freeze({
      identity: input.identity,
      pool,
      role,
      handle: identity.handle,
      handleId: identity.handleId,
      ownerCommitment,
      authorizationCommitment: identity.authorizationCommitment,
      receiverCommitment: identity.receiverCommitment,
      proofCommitment,
      routingCommitment: identity.routingCommitment,
      salt,
      deadline: input.deadline,
      actionDigest,
      authorizationNullifier,
      ownershipProof,
      to: scope.registrar,
      calldata
    });
  }
  async approveFamilyPartnerAction(input) {
    if (isFamilyWithdrawalOnlyContext(input.releaseContext)) throw Error("Historical generations cannot change partner policies.");
    const pinned = familyWalletScope(input.releaseContext), scope = input.policyScope;
    if (JSON.stringify(scope.profile) !== JSON.stringify(pinned.profile) || getAddress7(scope.registrar) !== getAddress7(pinned.registrar) || getAddress7(scope.registry) !== getAddress7(pinned.registry) || !Array.isArray(scope.pools) || scope.pools.length !== pinned.pools.length || scope.pools.some((pool, index) => getAddress7(pool) !== pinned.pools[index]) || scope.checkpoints.length !== pinned.pools.length)
      throw Error("Family owner authorization differs from the compiled policy generation.");
    const identity = await this.#partnerIdentity(input.handle, pinned.handleRegistry, BigInt(pinned.profile.chainId));
    const ownerCommitment = h32(await poseidonAsync([identity.hsk, BigInt(identity.handleId), BigInt(pinned.profile.chainId)]));
    const claim = input.claim;
    if (input.kind === "register" && (!claim || claim.handleId !== identity.handleId || claim.ownerCommitment !== ownerCommitment || claim.authorizationCommitment !== identity.authorizationCommitment || claim.receiverCommitment !== identity.receiverCommitment || claim.routingCommitment !== identity.routingCommitment))
      throw Error("Family partner claim belongs to another private wallet.");
    const now = BigInt(Math.floor(Date.now() / 1e3));
    if (input.deadline <= now || input.deadline > now + 3600n)
      throw Error("Family owner authorization must expire within one hour.");
    const actionDigest = vantaPolicyOwnerAction({
      ...scope,
      kind: input.kind,
      handleId: identity.handleId,
      authorizationCommitment: identity.authorizationCommitment,
      receiverCommitment: identity.receiverCommitment,
      routingCommitment: identity.routingCommitment,
      salt: claim?.salt,
      fees: input.fees,
      assetIndex: scope.assetIndex,
      revision: input.revision,
      deadline: input.deadline
    });
    const authorizationNullifier = await poseidonAsync([identity.hsk, actionDigest]);
    const ownershipProof = await proveFamilyPartnerOwner(
      {
        chainId: pinned.profile.chainId,
        familyTag: pinned.profile.familyTag,
        handleId: identity.handleId,
        ownerCommitment,
        authorizationCommitment: h32(identity.authorizationCommitment),
        actionDigest: h32(actionDigest),
        authorizationNullifier: h32(authorizationNullifier),
        hsk: h32(identity.hsk),
        signingAddress: h32(BigInt(identity.signerAddress)),
        signingSalt: h32(this.#signingSalt)
      },
      { artifactBaseUrl: input.artifactBaseUrl, fetcher: input.fetcher, signal: input.signal, releaseContext: input.releaseContext }
    );
    if (!validProof(ownershipProof)) throw Error("Family private owner proof is malformed.");
    return Object.freeze({
      kind: input.kind,
      handle: identity.handle,
      handleId: identity.handleId,
      ownerCommitment,
      authorizationCommitment: identity.authorizationCommitment,
      receiverCommitment: identity.receiverCommitment,
      routingCommitment: identity.routingCommitment,
      salt: claim?.salt,
      fees: input.fees,
      assetIndex: scope.assetIndex,
      revision: input.revision,
      deadline: input.deadline,
      actionDigest,
      authorizationNullifier,
      ownershipProof,
      policyScope: scope
    });
  }
  /** Authorize app visibility without an on-chain transaction. The same
   * seven-input owner relation is reused, with a distinct action domain. */
  async approveFamilyPartnerAssetConfiguration(input) {
    if (isFamilyWithdrawalOnlyContext(input.releaseContext)) throw Error("Historical generations cannot change app settings.");
    const scope = familyWalletScope(input.releaseContext), release = getCompiledFamilyEvmRelease(input.releaseContext), inventory = getCompiledVantaFamilyProofResources(release, input.releaseContext);
    const identity = await this.#partnerIdentity(input.handle, scope.handleRegistry, BigInt(scope.profile.chainId));
    const all = inventory.funding.pools.map((p) => getAddress7(p.asset).toLowerCase()), selected = input.visibleAssets.map((p) => getAddress7(p).toLowerCase());
    if (new Set(selected).size !== selected.length || selected.some((p) => !all.includes(p))) throw Error("Select assets from the signed SDK inventory.");
    const now = BigInt(Math.floor(Date.now() / 1e3));
    if (input.deadline <= now || input.deadline > now + 3600n) throw Error("Configuration approval must expire within one hour.");
    const configuration = {
      schema: input.app ? "stealthos-partner-app-assets-v2" : "stealthos-partner-app-assets-v1",
      ...input.app ? { app: input.app } : {},
      networkId: release.pins.networkId,
      setupId: release.pins.setupId,
      generationId: release.pins.generationId,
      genesisHash: release.pins.genesisHash,
      registrar: scope.registrar,
      handle: identity.handle,
      handleId: identity.handleId,
      visibleAssets: all.filter((p) => selected.includes(p)),
      revision: input.revision.toString(),
      deadline: Number(input.deadline)
    };
    const ownerCommitment = h32(await poseidonAsync([identity.hsk, BigInt(identity.handleId), BigInt(scope.profile.chainId)]));
    const actionDigest = partnerAssetConfigurationDigest(configuration, identity.authorizationCommitment), authorizationNullifier = await poseidonAsync([identity.hsk, actionDigest]);
    const ownershipProof = await proveFamilyPartnerOwner(
      {
        chainId: scope.profile.chainId,
        familyTag: scope.profile.familyTag,
        handleId: identity.handleId,
        ownerCommitment,
        authorizationCommitment: h32(identity.authorizationCommitment),
        actionDigest: h32(actionDigest),
        authorizationNullifier: h32(authorizationNullifier),
        hsk: h32(identity.hsk),
        signingAddress: h32(BigInt(identity.signerAddress)),
        signingSalt: h32(this.#signingSalt)
      },
      { artifactBaseUrl: input.artifactBaseUrl, fetcher: input.fetcher, signal: input.signal, releaseContext: input.releaseContext }
    );
    if (!validProof(ownershipProof)) throw Error("Private configuration ownership proof is malformed.");
    return Object.freeze({
      configuration,
      ownerCommitment,
      authorizationCommitment: h32(identity.authorizationCommitment),
      actionDigest: h32(actionDigest),
      authorizationNullifier: h32(authorizationNullifier),
      ownershipProof: Object.freeze(ownershipProof.map((p) => h32(p)))
    });
  }
  /** Authorize exactly one deposit under the app's current operation policy. */
  async signFamilyDepositQuoteAuthorization(input) {
    this.#requireWallet();
    const release = getCompiledFamilyEvmRelease(), inventory = getCompiledVantaFamilyProofResources(release);
    if (input.networkId !== release.pins.networkId || input.generationId !== release.pins.generationId)
      throw Error("Partner deposit request differs from the compiled activation.");
    const pools = inventory.funding.pools.filter((p) => p.assetSymbol === input.asset);
    if (pools.length !== 1) throw Error("Partner deposit asset is not uniquely signed.");
    const asset = BigInt(pools[0].asset) === 0n ? "native" : pools[0].asset;
    const resources = selectVantaFamilyFundingResources(release, inventory, asset);
    return signFamilyDepositPartnerAuthorization({
      release,
      resources,
      asset,
      handleId: input.handleId,
      request: input.request,
      signer: new Wallet(hexlify3(this.#quoteKey)),
      signerSalt: this.#signingSalt,
      deadline: input.deadline ?? Math.floor(Date.now() / 1e3) + 120,
      requestNonce: input.requestNonce
    });
  }
  dispose() {
    this.#root.fill(0);
    this.#quoteKey.fill(0);
    this.#signingSalt = 0n;
    this.#receiverSalt = 0n;
  }
};
var createVantaFreshPrivateWallet = () => VantaFreshPrivateWallet.create();
var restoreVantaFreshPrivateWallet = (phrase) => VantaFreshPrivateWallet.restore(phrase);
export {
  VantaFreshPrivateWallet,
  createFamilyBootstrapCredentialScope,
  createVantaFreshPrivateWallet,
  restoreVantaFreshPrivateWallet
};
