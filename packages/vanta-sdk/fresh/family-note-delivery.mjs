/** Internal disposable DogeOS note transport. No package export or execution
 * activation. Reuses the established 829-byte X25519/HKDF/AES-GCM wire. */
import { x25519 } from "@noble/curves/ed25519";
import { AbiCoder, getAddress, getBytes, hexlify, keccak256, toUtf8Bytes } from "ethers";

const FR = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const FAMILY = "0x0d7e28190dad8c216f3b244bf15b182aebe3698b85e928461c3b148b4439c445";
const CHAIN = 6281971, MAX_AMOUNT = (1n << 120n) - 1n;
const HASH = /^0x[0-9a-f]{64}$/u, DIGEST = /^[0-9a-f]{64}$/u;
const ZERO = "0x" + "00".repeat(20);
const DOMAIN = "STEALTHOS_VANTA_FAMILY_NOTE_DELIVERY_V1";
const RECORD_BYTES = 768, ENVELOPE_BYTES = 829;
const coder = AbiCoder.defaultAbiCoder(), encoder = new TextEncoder(), decoder = new TextDecoder("utf-8", { fatal: true });
const buffer = value => new Uint8Array(value).buffer;
const OPENING = ["schema", "npk", "commitment", "random", "token_hash", "amount_units", "nonspendable",
  "chain_id", "family_tag", "research_only", "safe_for_funds"];
const CONTEXT = ["schema", "safeForFunds", "familyTag", "chainId", "genesisHash", "generationId", "setupId",
  "pool", "asset", "poolCodehash", "nativeGlueSha256", "nativeWasmSha256"];
const RECIPIENT = ["schema", "familyTag", "chainId", "genesisHash", "generationId", "setupId", "pool", "asset",
  "masterPublicKey", "viewingPublicKey"];

export const FAMILY_PRIVATE_MEMO_MAX_BYTES = 80;
const MEMO_HEADER = "\r\n\t\r \t\n\r";
const JSON_WHITESPACE = " \t\n\r";
const memoControl = /[\u0000-\u001f\u007f]/u;

export function normalizeFamilyPrivateMemo(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > FAMILY_PRIVATE_MEMO_MAX_BYTES ||
      memoControl.test(value.trim())) throw Error("Private transfer: Use up to 80 UTF-8 bytes for the memo.");
  const memo = value.trim(), bytes = encoder.encode(memo);
  try {
    if (bytes.length > FAMILY_PRIVATE_MEMO_MAX_BYTES || decoder.decode(bytes) !== memo)
      throw Error("Private transfer: Use up to 80 UTF-8 bytes for the memo.");
  } finally { bytes.fill(0); }
  return memo || undefined;
}

// A trailer built from the four JSON whitespace characters is still valid
// JSON in the released strict reader. The ciphertext format, size, recipient/
// commitment binding and required opening fields stay identical.
function encodeMemoTrailer(memo) {
  if (!memo) return "";
  const bytes = encoder.encode(memo);
  try {
    let text = MEMO_HEADER;
    for (const byte of bytes)
      for (let shift = 6; shift >= 0; shift -= 2) text += JSON_WHITESPACE[(byte >> shift) & 3];
    return text;
  } finally { bytes.fill(0); }
}

function decodeMemoTrailer(json) {
  const trailer = json.slice(json.lastIndexOf("}") + 1);
  if (!trailer.startsWith(MEMO_HEADER)) return undefined;
  const encoded = trailer.slice(MEMO_HEADER.length);
  if (!encoded.length || encoded.length % 4 || encoded.length / 4 > FAMILY_PRIVATE_MEMO_MAX_BYTES) return undefined;
  const bytes = new Uint8Array(encoded.length / 4);
  try {
    for (let index = 0; index < encoded.length; index++) {
      const digit = JSON_WHITESPACE.indexOf(encoded[index]);
      if (digit < 0) return undefined;
      const offset = Math.floor(index / 4);
      bytes[offset] = (bytes[offset] << 2) | digit;
    }
    return normalizeFamilyPrivateMemo(decoder.decode(bytes));
  } catch { return undefined; }
  finally { bytes.fill(0); }
}

export class FamilyNoteDeliveryError extends Error {
  constructor(code = "INVALID_INPUT") { super("Family note delivery rejected the request."); this.name = "FamilyNoteDeliveryError"; this.code = code; }
}
const fail = code => { throw new FamilyNoteDeliveryError(code); };
const freeze = value => {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
function exact(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key)) ||
      Object.values(Object.getOwnPropertyDescriptors(value)).some(item => item.get || item.set)) fail("INVALID_INPUT");
}
function word(value, nonzero = true) {
  if (typeof value !== "string" || !HASH.test(value) || (nonzero && BigInt(value) === 0n)) fail("INVALID_INPUT");
  return value;
}
function field(value) {
  const result = word(value);
  if (BigInt(result) >= FR) fail("INVALID_INPUT");
  return result;
}
function fieldOf(value) {
  if (typeof value !== "bigint" || value <= 0n || value >= FR) fail("INVALID_INPUT");
  return "0x" + value.toString(16).padStart(64, "0");
}
function address(value, zero = false) {
  let result;
  try { result = getAddress(value).toLowerCase(); } catch { fail("INVALID_INPUT"); }
  if (!zero && result === ZERO) fail("INVALID_INPUT");
  return result;
}
function amount(value) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,36})$/u.test(value) || BigInt(value) > MAX_AMOUNT) fail("INVALID_INPUT");
  return value;
}
export function validateFamilyNoteDomain(raw) {
  exact(raw, CONTEXT);
  if (raw.schema !== "vanta-family-note-domain-v1" || raw.safeForFunds !== false || raw.chainId !== CHAIN || raw.familyTag !== FAMILY ||
      !DIGEST.test(raw.nativeGlueSha256) || !DIGEST.test(raw.nativeWasmSha256)) fail("DOMAIN_MISMATCH");
  for (const name of ["genesisHash", "generationId", "setupId", "poolCodehash"]) word(raw[name]);
  return freeze({ ...raw, pool: address(raw.pool), asset: address(raw.asset, true) });
}
export function familyNoteTokenHash(raw) {
  const context = validateFamilyNoteDomain(raw);
  const encoded = coder.encode(["bytes32", "uint256", "address", "uint256", "address", "uint256", "uint256"],
    [keccak256(toUtf8Bytes("STEALTHOS_VANTA_TOKEN_HASH_V0")), context.chainId, context.pool, 0, context.asset, 0, 0]);
  return fieldOf(BigInt(keccak256(encoded)) % FR);
}
function opening(raw, tokenHash) {
  exact(raw, OPENING);
  if (raw.schema !== "vanta-family-note-opening-v1" || raw.chain_id !== CHAIN || raw.family_tag !== FAMILY ||
      raw.research_only !== true || raw.safe_for_funds !== false || raw.token_hash !== tokenHash ||
      raw.nonspendable !== (amount(raw.amount_units) === "0")) fail("DOMAIN_MISMATCH");
  for (const name of ["npk", "commitment", "random", "token_hash"]) field(raw[name]);
  return freeze({ ...raw });
}
function nativeCall(engine, name, request, schema) {
  let result;
  try { const raw = engine[name](request); if (typeof raw !== "string") fail("NATIVE_NOTE_REJECTED"); result = JSON.parse(raw); }
  catch { fail("NATIVE_NOTE_REJECTED"); }
  if (!result || typeof result !== "object" || Array.isArray(result) || result.schema !== schema ||
      result.chain_id !== CHAIN || result.family_tag !== FAMILY || result.research_only !== true || result.safe_for_funds !== false)
    fail("NATIVE_NOTE_REJECTED");
  return result;
}
function nativeOpening(note) {
  return { npk: note.npk, commitment: note.commitment, random: note.random, token_hash: note.token_hash,
    amount_units: note.amount_units, nonspendable: note.nonspendable };
}
async function walletKeys(wallet) {
  if (!wallet || typeof wallet.privateWalletKeys !== "function") fail("INVALID_INPUT");
  const keys = await wallet.privateWalletKeys();
  if (!keys || !Array.isArray(keys.spendingPublicKey) || keys.spendingPublicKey.length !== 2 ||
      !(keys.viewingPrivateKey instanceof Uint8Array) || keys.viewingPrivateKey.length !== 32 ||
      !(keys.viewingPublicKey instanceof Uint8Array) || keys.viewingPublicKey.length !== 32 ||
      hexlify(x25519.getPublicKey(keys.viewingPrivateKey)) !== hexlify(keys.viewingPublicKey)) fail("OWNER_MISMATCH");
  const owner = { spend_secret_scalar: fieldOf(keys.spendSecretScalar), pub_key_x: fieldOf(keys.spendingPublicKey[0]),
    pub_key_y: fieldOf(keys.spendingPublicKey[1]), nullifying_key: fieldOf(keys.nullifyingKey) };
  return { owner, masterPublicKey: fieldOf(keys.masterPublicKey), viewingPublicKey: hexlify(keys.viewingPublicKey),
    viewingPrivateKey: new Uint8Array(keys.viewingPrivateKey) };
}
async function cipherKey(shared, usage) {
  if (shared.length !== 32 || shared.every(byte => byte === 0)) fail("CIPHERTEXT_REJECTED");
  try {
    const imported = await crypto.subtle.importKey("raw", buffer(shared), "HKDF", false, ["deriveKey"]);
    return await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: buffer(encoder.encode(DOMAIN)),
      info: buffer(encoder.encode("family-note-opening-v1")) }, imported, { name: "AES-GCM", length: 256 }, false, [usage]);
  } finally { shared.fill(0); }
}

/** Only a local host may supply the measured native engine and pinned domain.
 * Neither is a model-tool argument. This internal module does not enable funds. */
export function createFamilyNoteDelivery({ domain, engine }) {
  const context = validateFamilyNoteDomain(domain), tokenHash = familyNoteTokenHash(context);
  if (!engine || engine.glueSha256 !== context.nativeGlueSha256 || engine.wasmSha256 !== context.nativeWasmSha256 ||
      ["createVantaFamilyOwnedNote", "createVantaFamilyRecipientNote", "verifyVantaFamilyOwnedNote", "verifyVantaFamilyRecipientNote"]
        .some(name => typeof engine[name] !== "function")) fail("NATIVE_NOTE_REJECTED");
  const base = { chain_id: CHAIN, family_tag: FAMILY };
  const recipient = raw => {
    exact(raw, RECIPIENT);
    if (raw.schema !== "vanta-family-note-recipient-v1") fail("DOMAIN_MISMATCH");
    for (const name of ["familyTag", "chainId", "genesisHash", "generationId", "setupId", "pool", "asset"])
      if (raw[name] !== context[name]) fail("DOMAIN_MISMATCH");
    field(raw.masterPublicKey); word(raw.viewingPublicKey);
    return freeze({ ...raw });
  };
  const recipientOf = keys => recipient({ schema: "vanta-family-note-recipient-v1", familyTag: FAMILY, chainId: CHAIN,
    genesisHash: context.genesisHash, generationId: context.generationId, setupId: context.setupId,
    pool: context.pool, asset: context.asset, masterPublicKey: keys.masterPublicKey, viewingPublicKey: keys.viewingPublicKey });
  const aad = (target, commitment) => getBytes(coder.encode(
    ["string", "bytes32", "uint256", "bytes32", "bytes32", "bytes32", "address", "address", "bytes32", "bytes32", "bytes32", "bytes32"],
    [DOMAIN, FAMILY, CHAIN, context.genesisHash, context.generationId, context.setupId, context.pool, context.asset,
      tokenHash, field(commitment), target.masterPublicKey, target.viewingPublicKey]));
  const verifiedRecipient = (target, note) => {
    const checked = nativeCall(engine, "verifyVantaFamilyRecipientNote", { schema: "vanta-family-recipient-note-check-v1",
      ...base, recipient_master_public_key: target.masterPublicKey, ...nativeOpening(note) }, "vanta-family-recipient-note-verified-v1");
    if (checked.master_public_key !== target.masterPublicKey || checked.commitment !== note.commitment ||
        checked.nonspendable !== note.nonspendable) fail("OWNER_MISMATCH");
  };
  const verifiedOwner = (keys, note) => {
    const checked = nativeCall(engine, "verifyVantaFamilyOwnedNote", { schema: "vanta-family-owned-note-check-v1",
      ...base, ...keys.owner, ...nativeOpening(note) }, "vanta-family-owned-note-verified-v1");
    if (checked.master_public_key !== keys.masterPublicKey || checked.commitment !== note.commitment ||
        checked.nonspendable !== note.nonspendable || (note.nonspendable ? checked.nullifier !== null : !HASH.test(checked.nullifier)))
      fail("OWNER_MISMATCH");
    if (!note.nonspendable) field(checked.nullifier);
    return freeze({ commitment: note.commitment, masterPublicKey: keys.masterPublicKey,
      nullifier: checked.nullifier, nonspendable: note.nonspendable });
  };
  return Object.freeze({ context, tokenHash,
    async walletRecipient(wallet) {
      const keys = await walletKeys(wallet);
      try {
        // Verify the established wallet's MPK against the exact native engine
        // before another sender can encrypt an irreversible funded output.
        const note = opening(nativeCall(engine, "createVantaFamilyOwnedNote", { schema: "vanta-family-owned-note-request-v1",
          ...base, ...keys.owner, token_hash: tokenHash, amount_units: "1", nonspendable: false }, "vanta-family-note-opening-v1"), tokenHash);
        verifiedOwner(keys, note); return recipientOf(keys);
      } finally { keys.viewingPrivateKey.fill(0); }
    },
    async createOwnedNote({ wallet, amountAtomic }) {
      const value = amount(amountAtomic), keys = await walletKeys(wallet);
      try {
        const note = opening(nativeCall(engine, "createVantaFamilyOwnedNote", { schema: "vanta-family-owned-note-request-v1",
          ...base, ...keys.owner, token_hash: tokenHash, amount_units: value, nonspendable: value === "0" }, "vanta-family-note-opening-v1"), tokenHash);
        if (note.amount_units !== value) fail("NATIVE_NOTE_REJECTED"); verifiedOwner(keys, note); return note;
      } finally { keys.viewingPrivateKey.fill(0); }
    },
    createRecipientNote({ recipient: raw, amountAtomic }) {
      const target = recipient(raw), value = amount(amountAtomic);
      const note = opening(nativeCall(engine, "createVantaFamilyRecipientNote", { schema: "vanta-family-recipient-note-request-v1",
        ...base, recipient_master_public_key: target.masterPublicKey, token_hash: tokenHash,
        amount_units: value, nonspendable: value === "0" }, "vanta-family-note-opening-v1"), tokenHash);
      if (note.amount_units !== value) fail("NATIVE_NOTE_REJECTED"); verifiedRecipient(target, note); return note;
    },
    verifyRecipientNote({ recipient: raw, note: supplied }) {
      const target = recipient(raw), note = opening(supplied, tokenHash); verifiedRecipient(target, note); return note;
    },
    async verifyOwnedNote({ wallet, note: supplied }) {
      const note = opening(supplied, tokenHash), keys = await walletKeys(wallet);
      try { return verifiedOwner(keys, note); } finally { keys.viewingPrivateKey.fill(0); }
    },
    async encrypt({ recipient: raw, note: supplied, memo }) {
      const target = recipient(raw), note = opening(supplied, tokenHash); verifiedRecipient(target, note);
      const trailer = encodeMemoTrailer(normalizeFamilyPrivateMemo(memo));
      const payload = encoder.encode(JSON.stringify({ schema: note.schema, ...nativeOpening(note) }) + trailer);
      if (payload.length > RECORD_BYTES - 2) { payload.fill(0); fail("INVALID_INPUT"); }
      const clear = new Uint8Array(RECORD_BYTES), ephemeral = crypto.getRandomValues(new Uint8Array(32));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      clear[0] = payload.length >> 8; clear[1] = payload.length & 255; clear.set(payload, 2); payload.fill(0);
      try {
        const publicKey = x25519.getPublicKey(ephemeral), shared = x25519.getSharedSecret(ephemeral, getBytes(target.viewingPublicKey));
        const key = await cipherKey(shared, "encrypt");
        const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: buffer(iv),
          additionalData: buffer(aad(target, note.commitment)), tagLength: 128 }, key, buffer(clear)));
        if (ciphertext.length !== 784) fail("CIPHERTEXT_REJECTED");
        const wire = new Uint8Array(ENVELOPE_BYTES); wire[0] = 1; wire.set(publicKey, 1); wire.set(iv, 33); wire.set(ciphertext, 45);
        return hexlify(wire);
      } catch { fail("CIPHERTEXT_REJECTED"); }
      finally { clear.fill(0); ephemeral.fill(0); iv.fill(0); }
    },
    async decrypt({ wallet, envelope, commitment }) {
      field(commitment);
      if (typeof envelope !== "string" || !/^0x[0-9a-f]+$/u.test(envelope) || envelope.length !== 2 + ENVELOPE_BYTES * 2)
        fail("CIPHERTEXT_REJECTED");
      const wire = getBytes(envelope); if (wire[0] !== 1) fail("CIPHERTEXT_REJECTED");
      const keys = await walletKeys(wallet), target = recipientOf(keys); let clear;
      try {
        try {
          const shared = x25519.getSharedSecret(keys.viewingPrivateKey, wire.slice(1, 33)), key = await cipherKey(shared, "decrypt");
          clear = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: buffer(wire.slice(33, 45)),
            additionalData: buffer(aad(target, commitment)), tagLength: 128 }, key, buffer(wire.slice(45))));
        } catch { return null; } // Another wallet's envelope is an ordinary scan miss.
        if (clear.length !== RECORD_BYTES) fail("CIPHERTEXT_REJECTED");
        const length = (clear[0] << 8) | clear[1];
        if (length < 1 || length > RECORD_BYTES - 2 || clear.slice(length + 2).some(byte => byte !== 0)) fail("CIPHERTEXT_REJECTED");
        let decoded, json;
        try { json = decoder.decode(clear.subarray(2, length + 2)); decoded = JSON.parse(json); } catch { fail("CIPHERTEXT_REJECTED"); }
        exact(decoded, ["schema", "npk", "commitment", "random", "token_hash", "amount_units", "nonspendable"]);
        const note = opening({ ...decoded, ...base, research_only: true, safe_for_funds: false }, tokenHash);
        if (note.commitment !== commitment) fail("CIPHERTEXT_REJECTED");
        const verification = verifiedOwner(keys, note);
        const memo = note.nonspendable ? undefined : decodeMemoTrailer(json);
        return freeze({ note, verification, ...(memo ? {memo} : {}) });
      } finally { keys.viewingPrivateKey.fill(0); clear?.fill(0); }
    },
  });
}
