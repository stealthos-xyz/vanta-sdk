// packages/sdk/src/vanta/unified-bound4-shard-worker.ts
function installVantaBound4ShardWorker(scope2, wasm) {
  let initialized = !1, shard, allocatorPeakBytes, measure = () => {
    if (typeof shard?.memoryStats != "function") return;
    let raw = shard.memoryStats(), peak = raw instanceof Map ? raw.get("peak_bytes") : raw.peak_bytes;
    typeof peak == "number" && Number.isSafeInteger(peak) && peak >= 0 && (allocatorPeakBytes = Math.max(allocatorPeakBytes ?? 0, peak));
  }, release = () => {
    try {
      shard?.free();
    } catch {
    } finally {
      shard = void 0;
    }
  };
  scope2.addEventListener("message", (event) => {
    let message = event.data;
    if (!(!message || !Number.isSafeInteger(message.id) || message.id <= 0))
      try {
        let result = !0;
        if (message.type === "init") {
          if (initialized || message.width !== 8 && message.width !== 32)
            throw Error("invalid shard initialization");
          initialized = !0;
        } else if (message.type === "start") {
          if (!initialized || shard || message.curve !== "G1" && message.curve !== "G2" || !Number.isSafeInteger(message.windowBits) || !Number.isSafeInteger(message.from) || !Number.isSafeInteger(message.to) || !Number.isSafeInteger(message.points))
            throw Error("invalid shard session");
          shard = new wasm.VantaM2MsmShard(
            message.curve,
            message.windowBits,
            message.from,
            message.to,
            message.points
          );
        } else if (message.type === "push") {
          if (!shard || !(message.query instanceof ArrayBuffer) || !(message.digits instanceof ArrayBuffer) || !Number.isSafeInteger(message.pointStart) || !Number.isSafeInteger(message.pointCount) || message.pointCount < 1 || message.pointCount > 512)
            throw Error("invalid MSM subchunk");
          let query = new Uint8Array(message.query), digits = new Int16Array(message.digits);
          try {
            shard.pushVerifiedChunkDigits(
              query,
              digits,
              message.pointStart,
              message.pointCount
            );
          } finally {
            query.fill(0), digits.fill(0);
          }
        } else if (message.type === "finish") {
          if (!shard) throw Error("shard session not started");
          try {
            measure(), result = shard.finish().slice().buffer, measure();
          } finally {
            release();
          }
        } else
          throw Error("unknown shard request");
        measure(), scope2.postMessage(
          {
            id: message.id,
            type: "success",
            result,
            ...allocatorPeakBytes === void 0 ? {} : { allocatorPeakBytes }
          },
          result instanceof ArrayBuffer ? [result] : []
        );
      } catch {
        release(), scope2.postMessage({ id: message.id, type: "error" });
      }
  });
}

// node_modules/ethers/lib.esm/_version.js
var version = "6.17.0";

// node_modules/ethers/lib.esm/utils/properties.js
function checkType(value, type, name) {
  let types = type.split("|").map((t) => t.trim());
  for (let i = 0; i < types.length; i++)
    switch (type) {
      case "any":
        return;
      case "bigint":
      case "boolean":
      case "number":
      case "string":
        if (typeof value === type)
          return;
    }
  let error = new Error(`invalid value for type ${type}`);
  throw error.code = "INVALID_ARGUMENT", error.argument = `value.${name}`, error.value = value, error;
}
function defineProperties(target, values, types) {
  for (let key in values) {
    let value = values[key], type = types ? types[key] : null;
    type && checkType(value, type, key), Object.defineProperty(target, key, { enumerable: !0, value, writable: !1 });
  }
}

// node_modules/ethers/lib.esm/utils/errors.js
function stringify(value, seen) {
  if (value == null)
    return "null";
  if (seen == null && (seen = /* @__PURE__ */ new Set()), typeof value == "object") {
    if (seen.has(value))
      return "[Circular]";
    seen.add(value);
  }
  if (Array.isArray(value))
    return "[ " + value.map((v) => stringify(v, seen)).join(", ") + " ]";
  if (value instanceof Uint8Array) {
    let HEX = "0123456789abcdef", result = "0x";
    for (let i = 0; i < value.length; i++)
      result += HEX[value[i] >> 4], result += HEX[value[i] & 15];
    return result;
  }
  if (typeof value == "object" && typeof value.toJSON == "function")
    return stringify(value.toJSON(), seen);
  switch (typeof value) {
    case "boolean":
    case "number":
    case "symbol":
      return value.toString();
    case "bigint":
      return BigInt(value).toString();
    case "string":
      return JSON.stringify(value);
    case "object": {
      let keys = Object.keys(value);
      return keys.sort(), "{ " + keys.map((k) => `${stringify(k, seen)}: ${stringify(value[k], seen)}`).join(", ") + " }";
    }
  }
  return "[ COULD NOT SERIALIZE ]";
}
function makeError(message, code, info) {
  let shortMessage = message;
  {
    let details = [];
    if (info) {
      if ("message" in info || "code" in info || "name" in info)
        throw new Error(`value will overwrite populated values: ${stringify(info)}`);
      for (let key in info) {
        if (key === "shortMessage")
          continue;
        let value = info[key];
        details.push(key + "=" + stringify(value));
      }
    }
    details.push(`code=${code}`), details.push(`version=${version}`), details.length && (message += " (" + details.join(", ") + ")");
  }
  let error;
  switch (code) {
    case "INVALID_ARGUMENT":
      error = new TypeError(message);
      break;
    case "NUMERIC_FAULT":
    case "BUFFER_OVERRUN":
      error = new RangeError(message);
      break;
    default:
      error = new Error(message);
  }
  return defineProperties(error, { code }), info && Object.assign(error, info), error.shortMessage == null && defineProperties(error, { shortMessage }), error;
}
function assert(check, message, code, info) {
  if (!check)
    throw makeError(message, code, info);
}
function assertArgument(check, message, name, value) {
  assert(check, message, "INVALID_ARGUMENT", { argument: name, value });
}
var _normalizeForms = ["NFD", "NFC", "NFKD", "NFKC"].reduce((accum, form) => {
  try {
    if ("test".normalize(form) !== "test")
      throw new Error("bad");
    if (form === "NFD" && "\xE9".normalize("NFD") !== "e\u0301")
      throw new Error("broken");
    accum.push(form);
  } catch {
  }
  return accum;
}, []);

// node_modules/ethers/lib.esm/utils/data.js
function _getBytes(value, name, copy) {
  if (value instanceof Uint8Array)
    return copy ? new Uint8Array(value) : value;
  if (typeof value == "string" && value.length % 2 === 0 && value.match(/^0x[0-9a-f]*$/i)) {
    let result = new Uint8Array((value.length - 2) / 2), offset = 2;
    for (let i = 0; i < result.length; i++)
      result[i] = parseInt(value.substring(offset, offset + 2), 16), offset += 2;
    return result;
  }
  assertArgument(!1, "invalid BytesLike value", name || "value", value);
}
function getBytes(value, name) {
  return _getBytes(value, name, !1);
}
var HexCharacters = "0123456789abcdef";
function hexlify(data) {
  let bytes2 = getBytes(data), result = "0x";
  for (let i = 0; i < bytes2.length; i++) {
    let v = bytes2[i];
    result += HexCharacters[(v & 240) >> 4] + HexCharacters[v & 15];
  }
  return result;
}

// node_modules/ethers/node_modules/@noble/hashes/esm/_assert.js
function bytes(b, ...lengths) {
  if (!(b instanceof Uint8Array))
    throw new Error("Expected Uint8Array");
  if (lengths.length > 0 && !lengths.includes(b.length))
    throw new Error(`Expected Uint8Array of length ${lengths}, not of length=${b.length}`);
}
function exists(instance, checkFinished = !0) {
  if (instance.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (checkFinished && instance.finished)
    throw new Error("Hash#digest() has already been called");
}
function output(out, instance) {
  bytes(out);
  let min = instance.outputLen;
  if (out.length < min)
    throw new Error(`digestInto() expects output buffer of length at least ${min}`);
}

// node_modules/ethers/node_modules/@noble/hashes/esm/utils.js
var u8a = (a) => a instanceof Uint8Array;
var createView = (arr) => new DataView(arr.buffer, arr.byteOffset, arr.byteLength), rotr = (word, shift) => word << 32 - shift | word >>> shift, isLE = new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68;
if (!isLE)
  throw new Error("Non little-endian hardware is not supported");
function utf8ToBytes(str) {
  if (typeof str != "string")
    throw new Error(`utf8ToBytes expected string, got ${typeof str}`);
  return new Uint8Array(new TextEncoder().encode(str));
}
function toBytes(data) {
  if (typeof data == "string" && (data = utf8ToBytes(data)), !u8a(data))
    throw new Error(`expected Uint8Array, got ${typeof data}`);
  return data;
}
var Hash = class {
  // Safe version that clones internal state
  clone() {
    return this._cloneInto();
  }
}, toStr = {}.toString;
function wrapConstructor(hashCons) {
  let hashC = (msg) => hashCons().update(toBytes(msg)).digest(), tmp = hashCons();
  return hashC.outputLen = tmp.outputLen, hashC.blockLen = tmp.blockLen, hashC.create = () => hashCons(), hashC;
}

// node_modules/ethers/node_modules/@noble/hashes/esm/_sha2.js
function setBigUint64(view, byteOffset, value, isLE2) {
  if (typeof view.setBigUint64 == "function")
    return view.setBigUint64(byteOffset, value, isLE2);
  let _32n2 = BigInt(32), _u32_max = BigInt(4294967295), wh = Number(value >> _32n2 & _u32_max), wl = Number(value & _u32_max), h = isLE2 ? 4 : 0, l = isLE2 ? 0 : 4;
  view.setUint32(byteOffset + h, wh, isLE2), view.setUint32(byteOffset + l, wl, isLE2);
}
var SHA2 = class extends Hash {
  constructor(blockLen, outputLen, padOffset, isLE2) {
    super(), this.blockLen = blockLen, this.outputLen = outputLen, this.padOffset = padOffset, this.isLE = isLE2, this.finished = !1, this.length = 0, this.pos = 0, this.destroyed = !1, this.buffer = new Uint8Array(blockLen), this.view = createView(this.buffer);
  }
  update(data) {
    exists(this);
    let { view, buffer, blockLen } = this;
    data = toBytes(data);
    let len = data.length;
    for (let pos = 0; pos < len; ) {
      let take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        let dataView = createView(data);
        for (; blockLen <= len - pos; pos += blockLen)
          this.process(dataView, pos);
        continue;
      }
      buffer.set(data.subarray(pos, pos + take), this.pos), this.pos += take, pos += take, this.pos === blockLen && (this.process(view, 0), this.pos = 0);
    }
    return this.length += data.length, this.roundClean(), this;
  }
  digestInto(out) {
    exists(this), output(out, this), this.finished = !0;
    let { buffer, view, blockLen, isLE: isLE2 } = this, { pos } = this;
    buffer[pos++] = 128, this.buffer.subarray(pos).fill(0), this.padOffset > blockLen - pos && (this.process(view, 0), pos = 0);
    for (let i = pos; i < blockLen; i++)
      buffer[i] = 0;
    setBigUint64(view, blockLen - 8, BigInt(this.length * 8), isLE2), this.process(view, 0);
    let oview = createView(out), len = this.outputLen;
    if (len % 4)
      throw new Error("_sha2: outputLen should be aligned to 32bit");
    let outLen = len / 4, state = this.get();
    if (outLen > state.length)
      throw new Error("_sha2: outputLen bigger than state");
    for (let i = 0; i < outLen; i++)
      oview.setUint32(4 * i, state[i], isLE2);
  }
  digest() {
    let { buffer, outputLen } = this;
    this.digestInto(buffer);
    let res = buffer.slice(0, outputLen);
    return this.destroy(), res;
  }
  _cloneInto(to) {
    to || (to = new this.constructor()), to.set(...this.get());
    let { blockLen, buffer, length, finished, destroyed, pos } = this;
    return to.length = length, to.pos = pos, to.finished = finished, to.destroyed = destroyed, length % blockLen && to.buffer.set(buffer), to;
  }
};

// node_modules/ethers/node_modules/@noble/hashes/esm/sha256.js
var Chi = (a, b, c) => a & b ^ ~a & c, Maj = (a, b, c) => a & b ^ a & c ^ b & c, SHA256_K = /* @__PURE__ */ new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]), IV = /* @__PURE__ */ new Uint32Array([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]), SHA256_W = /* @__PURE__ */ new Uint32Array(64), SHA256 = class extends SHA2 {
  constructor() {
    super(64, 32, 8, !1), this.A = IV[0] | 0, this.B = IV[1] | 0, this.C = IV[2] | 0, this.D = IV[3] | 0, this.E = IV[4] | 0, this.F = IV[5] | 0, this.G = IV[6] | 0, this.H = IV[7] | 0;
  }
  get() {
    let { A, B, C, D, E, F, G, H } = this;
    return [A, B, C, D, E, F, G, H];
  }
  // prettier-ignore
  set(A, B, C, D, E, F, G, H) {
    this.A = A | 0, this.B = B | 0, this.C = C | 0, this.D = D | 0, this.E = E | 0, this.F = F | 0, this.G = G | 0, this.H = H | 0;
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4)
      SHA256_W[i] = view.getUint32(offset, !1);
    for (let i = 16; i < 64; i++) {
      let W15 = SHA256_W[i - 15], W2 = SHA256_W[i - 2], s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3, s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
      SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
    }
    let { A, B, C, D, E, F, G, H } = this;
    for (let i = 0; i < 64; i++) {
      let sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25), T1 = H + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0, T2 = (rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22)) + Maj(A, B, C) | 0;
      H = G, G = F, F = E, E = D + T1 | 0, D = C, C = B, B = A, A = T1 + T2 | 0;
    }
    A = A + this.A | 0, B = B + this.B | 0, C = C + this.C | 0, D = D + this.D | 0, E = E + this.E | 0, F = F + this.F | 0, G = G + this.G | 0, H = H + this.H | 0, this.set(A, B, C, D, E, F, G, H);
  }
  roundClean() {
    SHA256_W.fill(0);
  }
  destroy() {
    this.set(0, 0, 0, 0, 0, 0, 0, 0), this.buffer.fill(0);
  }
};
var sha256 = /* @__PURE__ */ wrapConstructor(() => new SHA256());

// node_modules/ethers/node_modules/@noble/hashes/esm/_u64.js
var U32_MASK64 = /* @__PURE__ */ BigInt(4294967295), _32n = /* @__PURE__ */ BigInt(32);
function fromBig(n, le = !1) {
  return le ? { h: Number(n & U32_MASK64), l: Number(n >> _32n & U32_MASK64) } : { h: Number(n >> _32n & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
}
function split(lst, le = !1) {
  let Ah = new Uint32Array(lst.length), Al = new Uint32Array(lst.length);
  for (let i = 0; i < lst.length; i++) {
    let { h, l } = fromBig(lst[i], le);
    [Ah[i], Al[i]] = [h, l];
  }
  return [Ah, Al];
}
var toBig = (h, l) => BigInt(h >>> 0) << _32n | BigInt(l >>> 0), shrSH = (h, _l, s) => h >>> s, shrSL = (h, l, s) => h << 32 - s | l >>> s, rotrSH = (h, l, s) => h >>> s | l << 32 - s, rotrSL = (h, l, s) => h << 32 - s | l >>> s, rotrBH = (h, l, s) => h << 64 - s | l >>> s - 32, rotrBL = (h, l, s) => h >>> s - 32 | l << 64 - s, rotr32H = (_h, l) => l, rotr32L = (h, _l) => h, rotlSH = (h, l, s) => h << s | l >>> 32 - s, rotlSL = (h, l, s) => l << s | h >>> 32 - s, rotlBH = (h, l, s) => l << s - 32 | h >>> 64 - s, rotlBL = (h, l, s) => h << s - 32 | l >>> 64 - s;
function add(Ah, Al, Bh, Bl) {
  let l = (Al >>> 0) + (Bl >>> 0);
  return { h: Ah + Bh + (l / 2 ** 32 | 0) | 0, l: l | 0 };
}
var add3L = (Al, Bl, Cl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0), add3H = (low, Ah, Bh, Ch) => Ah + Bh + Ch + (low / 2 ** 32 | 0) | 0, add4L = (Al, Bl, Cl, Dl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0), add4H = (low, Ah, Bh, Ch, Dh) => Ah + Bh + Ch + Dh + (low / 2 ** 32 | 0) | 0, add5L = (Al, Bl, Cl, Dl, El) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0) + (El >>> 0), add5H = (low, Ah, Bh, Ch, Dh, Eh) => Ah + Bh + Ch + Dh + Eh + (low / 2 ** 32 | 0) | 0;
var u64 = {
  fromBig,
  split,
  toBig,
  shrSH,
  shrSL,
  rotrSH,
  rotrSL,
  rotrBH,
  rotrBL,
  rotr32H,
  rotr32L,
  rotlSH,
  rotlSL,
  rotlBH,
  rotlBL,
  add,
  add3L,
  add3H,
  add4L,
  add4H,
  add5H,
  add5L
}, u64_default = u64;

// node_modules/ethers/node_modules/@noble/hashes/esm/sha512.js
var [SHA512_Kh, SHA512_Kl] = u64_default.split([
  "0x428a2f98d728ae22",
  "0x7137449123ef65cd",
  "0xb5c0fbcfec4d3b2f",
  "0xe9b5dba58189dbbc",
  "0x3956c25bf348b538",
  "0x59f111f1b605d019",
  "0x923f82a4af194f9b",
  "0xab1c5ed5da6d8118",
  "0xd807aa98a3030242",
  "0x12835b0145706fbe",
  "0x243185be4ee4b28c",
  "0x550c7dc3d5ffb4e2",
  "0x72be5d74f27b896f",
  "0x80deb1fe3b1696b1",
  "0x9bdc06a725c71235",
  "0xc19bf174cf692694",
  "0xe49b69c19ef14ad2",
  "0xefbe4786384f25e3",
  "0x0fc19dc68b8cd5b5",
  "0x240ca1cc77ac9c65",
  "0x2de92c6f592b0275",
  "0x4a7484aa6ea6e483",
  "0x5cb0a9dcbd41fbd4",
  "0x76f988da831153b5",
  "0x983e5152ee66dfab",
  "0xa831c66d2db43210",
  "0xb00327c898fb213f",
  "0xbf597fc7beef0ee4",
  "0xc6e00bf33da88fc2",
  "0xd5a79147930aa725",
  "0x06ca6351e003826f",
  "0x142929670a0e6e70",
  "0x27b70a8546d22ffc",
  "0x2e1b21385c26c926",
  "0x4d2c6dfc5ac42aed",
  "0x53380d139d95b3df",
  "0x650a73548baf63de",
  "0x766a0abb3c77b2a8",
  "0x81c2c92e47edaee6",
  "0x92722c851482353b",
  "0xa2bfe8a14cf10364",
  "0xa81a664bbc423001",
  "0xc24b8b70d0f89791",
  "0xc76c51a30654be30",
  "0xd192e819d6ef5218",
  "0xd69906245565a910",
  "0xf40e35855771202a",
  "0x106aa07032bbd1b8",
  "0x19a4c116b8d2d0c8",
  "0x1e376c085141ab53",
  "0x2748774cdf8eeb99",
  "0x34b0bcb5e19b48a8",
  "0x391c0cb3c5c95a63",
  "0x4ed8aa4ae3418acb",
  "0x5b9cca4f7763e373",
  "0x682e6ff3d6b2b8a3",
  "0x748f82ee5defb2fc",
  "0x78a5636f43172f60",
  "0x84c87814a1f0ab72",
  "0x8cc702081a6439ec",
  "0x90befffa23631e28",
  "0xa4506cebde82bde9",
  "0xbef9a3f7b2c67915",
  "0xc67178f2e372532b",
  "0xca273eceea26619c",
  "0xd186b8c721c0c207",
  "0xeada7dd6cde0eb1e",
  "0xf57d4f7fee6ed178",
  "0x06f067aa72176fba",
  "0x0a637dc5a2c898a6",
  "0x113f9804bef90dae",
  "0x1b710b35131c471b",
  "0x28db77f523047d84",
  "0x32caab7b40c72493",
  "0x3c9ebe0a15c9bebc",
  "0x431d67c49c100d4c",
  "0x4cc5d4becb3e42b6",
  "0x597f299cfc657e2a",
  "0x5fcb6fab3ad6faec",
  "0x6c44198c4a475817"
].map((n) => BigInt(n))), SHA512_W_H = /* @__PURE__ */ new Uint32Array(80), SHA512_W_L = /* @__PURE__ */ new Uint32Array(80), SHA512 = class extends SHA2 {
  constructor() {
    super(128, 64, 16, !1), this.Ah = 1779033703, this.Al = -205731576, this.Bh = -1150833019, this.Bl = -2067093701, this.Ch = 1013904242, this.Cl = -23791573, this.Dh = -1521486534, this.Dl = 1595750129, this.Eh = 1359893119, this.El = -1377402159, this.Fh = -1694144372, this.Fl = 725511199, this.Gh = 528734635, this.Gl = -79577749, this.Hh = 1541459225, this.Hl = 327033209;
  }
  // prettier-ignore
  get() {
    let { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
    return [Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl];
  }
  // prettier-ignore
  set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl) {
    this.Ah = Ah | 0, this.Al = Al | 0, this.Bh = Bh | 0, this.Bl = Bl | 0, this.Ch = Ch | 0, this.Cl = Cl | 0, this.Dh = Dh | 0, this.Dl = Dl | 0, this.Eh = Eh | 0, this.El = El | 0, this.Fh = Fh | 0, this.Fl = Fl | 0, this.Gh = Gh | 0, this.Gl = Gl | 0, this.Hh = Hh | 0, this.Hl = Hl | 0;
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4)
      SHA512_W_H[i] = view.getUint32(offset), SHA512_W_L[i] = view.getUint32(offset += 4);
    for (let i = 16; i < 80; i++) {
      let W15h = SHA512_W_H[i - 15] | 0, W15l = SHA512_W_L[i - 15] | 0, s0h = u64_default.rotrSH(W15h, W15l, 1) ^ u64_default.rotrSH(W15h, W15l, 8) ^ u64_default.shrSH(W15h, W15l, 7), s0l = u64_default.rotrSL(W15h, W15l, 1) ^ u64_default.rotrSL(W15h, W15l, 8) ^ u64_default.shrSL(W15h, W15l, 7), W2h = SHA512_W_H[i - 2] | 0, W2l = SHA512_W_L[i - 2] | 0, s1h = u64_default.rotrSH(W2h, W2l, 19) ^ u64_default.rotrBH(W2h, W2l, 61) ^ u64_default.shrSH(W2h, W2l, 6), s1l = u64_default.rotrSL(W2h, W2l, 19) ^ u64_default.rotrBL(W2h, W2l, 61) ^ u64_default.shrSL(W2h, W2l, 6), SUMl = u64_default.add4L(s0l, s1l, SHA512_W_L[i - 7], SHA512_W_L[i - 16]), SUMh = u64_default.add4H(SUMl, s0h, s1h, SHA512_W_H[i - 7], SHA512_W_H[i - 16]);
      SHA512_W_H[i] = SUMh | 0, SHA512_W_L[i] = SUMl | 0;
    }
    let { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
    for (let i = 0; i < 80; i++) {
      let sigma1h = u64_default.rotrSH(Eh, El, 14) ^ u64_default.rotrSH(Eh, El, 18) ^ u64_default.rotrBH(Eh, El, 41), sigma1l = u64_default.rotrSL(Eh, El, 14) ^ u64_default.rotrSL(Eh, El, 18) ^ u64_default.rotrBL(Eh, El, 41), CHIh = Eh & Fh ^ ~Eh & Gh, CHIl = El & Fl ^ ~El & Gl, T1ll = u64_default.add5L(Hl, sigma1l, CHIl, SHA512_Kl[i], SHA512_W_L[i]), T1h = u64_default.add5H(T1ll, Hh, sigma1h, CHIh, SHA512_Kh[i], SHA512_W_H[i]), T1l = T1ll | 0, sigma0h = u64_default.rotrSH(Ah, Al, 28) ^ u64_default.rotrBH(Ah, Al, 34) ^ u64_default.rotrBH(Ah, Al, 39), sigma0l = u64_default.rotrSL(Ah, Al, 28) ^ u64_default.rotrBL(Ah, Al, 34) ^ u64_default.rotrBL(Ah, Al, 39), MAJh = Ah & Bh ^ Ah & Ch ^ Bh & Ch, MAJl = Al & Bl ^ Al & Cl ^ Bl & Cl;
      Hh = Gh | 0, Hl = Gl | 0, Gh = Fh | 0, Gl = Fl | 0, Fh = Eh | 0, Fl = El | 0, { h: Eh, l: El } = u64_default.add(Dh | 0, Dl | 0, T1h | 0, T1l | 0), Dh = Ch | 0, Dl = Cl | 0, Ch = Bh | 0, Cl = Bl | 0, Bh = Ah | 0, Bl = Al | 0;
      let All = u64_default.add3L(T1l, sigma0l, MAJl);
      Ah = u64_default.add3H(All, T1h, sigma0h, MAJh), Al = All | 0;
    }
    ({ h: Ah, l: Al } = u64_default.add(this.Ah | 0, this.Al | 0, Ah | 0, Al | 0)), { h: Bh, l: Bl } = u64_default.add(this.Bh | 0, this.Bl | 0, Bh | 0, Bl | 0), { h: Ch, l: Cl } = u64_default.add(this.Ch | 0, this.Cl | 0, Ch | 0, Cl | 0), { h: Dh, l: Dl } = u64_default.add(this.Dh | 0, this.Dl | 0, Dh | 0, Dl | 0), { h: Eh, l: El } = u64_default.add(this.Eh | 0, this.El | 0, Eh | 0, El | 0), { h: Fh, l: Fl } = u64_default.add(this.Fh | 0, this.Fl | 0, Fh | 0, Fl | 0), { h: Gh, l: Gl } = u64_default.add(this.Gh | 0, this.Gl | 0, Gh | 0, Gl | 0), { h: Hh, l: Hl } = u64_default.add(this.Hh | 0, this.Hl | 0, Hh | 0, Hl | 0), this.set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl);
  }
  roundClean() {
    SHA512_W_H.fill(0), SHA512_W_L.fill(0);
  }
  destroy() {
    this.buffer.fill(0), this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  }
};
var sha512 = /* @__PURE__ */ wrapConstructor(() => new SHA512());

// node_modules/ethers/lib.esm/crypto/crypto-browser.js
function getGlobal() {
  if (typeof self < "u")
    return self;
  if (typeof window < "u")
    return window;
  if (typeof global < "u")
    return global;
  throw new Error("unable to locate global object");
}
var anyGlobal = getGlobal(), crypto = anyGlobal.crypto || anyGlobal.msCrypto;
function createHash(algo) {
  switch (algo) {
    case "sha256":
      return sha256.create();
    case "sha512":
      return sha512.create();
  }
  assertArgument(!1, "invalid hashing algorithm name", "algorithm", algo);
}

// node_modules/ethers/lib.esm/crypto/sha2.js
var _sha256 = function(data) {
  return createHash("sha256").update(data).digest();
}, _sha512 = function(data) {
  return createHash("sha512").update(data).digest();
}, __sha256 = _sha256, __sha512 = _sha512, locked256 = !1, locked512 = !1;
function sha2562(_data) {
  let data = getBytes(_data, "data");
  return hexlify(__sha256(data));
}
sha2562._ = _sha256;
sha2562.lock = function() {
  locked256 = !0;
};
sha2562.register = function(func) {
  if (locked256)
    throw new Error("sha256 is locked");
  __sha256 = func;
};
Object.freeze(sha2562);
function sha5122(_data) {
  let data = getBytes(_data, "data");
  return hexlify(__sha512(data));
}
sha5122._ = _sha512;
sha5122.lock = function() {
  locked512 = !0;
};
sha5122.register = function(func) {
  if (locked512)
    throw new Error("sha512 is locked");
  __sha512 = func;
};
Object.freeze(sha2562);

// packages/sdk/src/vanta/public-artifact-reader.ts
var HASH = /^[a-f0-9]{64}$/iu, MAX_RANGE = 2 * 1024 * 1024, fail = () => {
  throw Error("Vanta pinned public artifact unavailable or invalid");
}, VantaPublicArtifactIntegrityError = class extends Error {
  constructor() {
    super("Vanta public artifact SHA-256 mismatch"), this.name = "VantaPublicArtifactIntegrityError";
  }
};
function createVantaPinnedPublicArtifactReader(input) {
  let base = new URL(input.baseUrl), local = input.allowLocalhostHttp === !0 && base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname);
  if (base.protocol !== "https:" && !local || base.username || base.password || base.search || base.hash || input.credentials !== void 0 && !["omit", "same-origin"].includes(input.credentials))
    throw Error("Vanta public artifacts require a credential-free HTTPS base URL");
  base.pathname.endsWith("/") || (base.pathname += "/");
  let url = (path) => {
    if (!/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/u.test(path) || path.split("/").some((v) => v === "." || v === "..")) return fail();
    let result = new URL(path, base);
    return result.origin !== base.origin || !result.pathname.startsWith(base.pathname) ? fail() : result.href;
  }, fetchBytes = async (path, maxBytes, range) => {
    if (input.signal?.aborted) throw Error("Vanta proof cancelled");
    let response;
    try {
      response = await (input.fetcher ?? fetch)(url(path), {
        credentials: input.credentials ?? "omit",
        redirect: "error",
        signal: input.signal,
        ...range ? { headers: { Range: "bytes=" + range.offset + "-" + (range.offset + range.length - 1) } } : {}
      });
    } catch {
      if (input.signal?.aborted) throw Error("Vanta proof cancelled");
      return fail();
    }
    if (response.redirected || response.type === "opaque" || response.status !== (range ? 206 : 200) || range && response.headers.get("content-range") !== "bytes " + range.offset + "-" + (range.offset + range.length - 1) + "/" + range.total) return fail();
    let size = response.headers.get("content-length");
    if (size !== null && (!/^[0-9]+$/u.test(size) || Number(size) > maxBytes || range && Number(size) !== range.length)) return fail();
    let reader = response.body?.getReader();
    if (!reader) return fail();
    let parts = [], length = 0;
    try {
      for (; ; ) {
        let item = await reader.read();
        if (item.done) break;
        if (length += item.value.byteLength, length > maxBytes)
          return await reader.cancel(), fail();
        parts.push(item.value);
      }
    } finally {
      reader.releaseLock();
    }
    if (length < 1 || range && length !== range.length) return fail();
    let bytes2 = new Uint8Array(length), position = 0;
    for (let part of parts)
      bytes2.set(part, position), position += part.byteLength;
    return bytes2;
  };
  return Object.freeze({
    url,
    async read(path, expected, maxBytes) {
      if (!HASH.test(expected) || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 64 * 1024 * 1024) return fail();
      let bytes2 = await fetchBytes(path, maxBytes);
      if (sha2562(bytes2).slice(2).toLowerCase() !== expected.toLowerCase())
        throw bytes2.fill(0), new VantaPublicArtifactIntegrityError();
      return bytes2;
    },
    async range(path, offset, length, total) {
      return !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > MAX_RANGE || !Number.isSafeInteger(total) || total < 1 || total > 128 * 1024 * 1024 || offset + length > total ? fail() : fetchBytes(path, length, { offset, length, total });
    }
  });
}

// packages/sdk/src/vanta/unified-bound4-bootstrap-worker.ts
var scope = globalThis, HASH2 = /^[0-9a-f]{64}$/iu, fail2 = (message) => {
  throw Error("Vanta browser worker: " + message);
}, started = !1, routed = null, verified = async (url, sha, max) => {
  let u = new URL(url, scope.location.href);
  (!(u.protocol === "https:" || u.origin === scope.location.origin && u.protocol === "http:") || u.username || u.password || u.search || u.hash) && fail2("insecure release asset");
  let bytes2 = await createVantaPinnedPublicArtifactReader({
    baseUrl: u.origin + "/",
    credentials: "omit",
    allowLocalhostHttp: !0
  }).read(u.pathname.slice(1), sha, max);
  return (bytes2.length < 1e3 || bytes2.length > max) && fail2("release asset size invalid"), bytes2;
};
async function supplied(value, sha, max) {
  if (!(value instanceof Uint8Array) || value.length < 1e3 || value.length > max) return fail2("release asset size invalid");
  let digest = new Uint8Array(await scope.crypto.subtle.digest("SHA-256", value));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("") !== sha.toLowerCase() && fail2("release asset hash invalid"), value;
}
async function start(input) {
  (input.type !== "vanta-bound4-bootstrap" || input.researchOnly !== !0 || input.profileName !== "8x5" && input.profileName !== "32x5" || typeof input.glueUrl != "string" || typeof input.wasmUrl != "string" || typeof input.glueSha256 != "string" || !HASH2.test(input.glueSha256) || typeof input.wasmSha256 != "string" || !HASH2.test(input.wasmSha256)) && fail2("invalid pinned bootstrap");
  let provided = input.glueBytes !== void 0 || input.wasmBytes !== void 0, glue = await (provided ? supplied(input.glueBytes, input.glueSha256, 5e5) : verified(input.glueUrl, input.glueSha256, 5e5)), wasmBytes = await (provided ? supplied(input.wasmBytes, input.wasmSha256, 2e7) : verified(input.wasmUrl, input.wasmSha256, 2e7)), objectUrl = URL.createObjectURL(new Blob([new Uint8Array(glue)], { type: "text/javascript" }));
  try {
    let module = await import(
      /* webpackIgnore: true */
      /* @vite-ignore */
      objectUrl
    );
    (typeof module.default != "function" || typeof module.VantaM2MsmShard != "function") && fail2("pinned WASM module exports invalid"), await module.default({ module_or_path: wasmBytes }), installVantaBound4ShardWorker({
      addEventListener(_type, listener) {
        routed = (event) => listener(event);
      },
      postMessage: (data, transfer) => scope.postMessage(data, transfer)
    }, module);
  } finally {
    URL.revokeObjectURL(objectUrl), glue.fill(0), wasmBytes.fill(0);
  }
  scope.postMessage({ type: "vanta-bound4-ready", profileName: input.profileName });
}
scope.addEventListener("message", (event) => {
  if (!started) {
    started = !0, start(event.data).catch((error) => {
      let memory = error instanceof RangeError && /memory|allocation/i.test(error.message);
      scope.postMessage({ type: "vanta-bound4-fatal", reason: memory ? "memory" : "startup" });
    });
    return;
  }
  routed && routed(event);
});
/*! Bundled license information:

@noble/hashes/esm/utils.js:
  (*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) *)
*/
