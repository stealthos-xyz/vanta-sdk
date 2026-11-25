import {test} from "node:test";
import assert from "node:assert/strict";
import {directDepositNonceMethod,depositPoolAbi} from "../fresh/family-deposit-wire.mjs";

test("signed legacy and isolated deposit nonce modes select different selectors",()=>{
 assert.equal(directDepositNonceMethod({}),"usedNonce");
 assert.equal(directDepositNonceMethod({depositNonceMode:"isolated-v2"}),"usedDepositNonce");
 assert.notEqual(depositPoolAbi.getFunction("usedNonce").selector,depositPoolAbi.getFunction("usedDepositNonce").selector);
 assert.throws(()=>directDepositNonceMethod({depositNonceMode:"unknown"}));
 assert.throws(()=>directDepositNonceMethod(null));
});
