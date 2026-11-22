import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir, mkdtempDisposable, readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {AbiCoder, keccak256, toBeHex, ZeroAddress} from 'ethers';
import {canonicalJson} from '../fresh/canonical-json.mjs';
import * as currentNormal from '../fresh/family-normal-wire.mjs';
import * as currentExit from '../fresh/family-exit-wire.mjs';
import * as currentEnhanced from '../fresh/family-enhanced-wire.mjs';
import {normalizeFreshHandle} from '../fresh/family-deposit-route.mjs';

const sdk = resolve(import.meta.dirname, '..');
const root = resolve(sdk, '../..');
const word = n => toBeHex(n, 32);
const address = n => toBeHex(n, 20);
const field = currentEnhanced.enhancedField;
const addressPool = address(12);
const domain = {pool: addressPool, asset: address(9), familyTag: field(8), chainId: 6281971};

function wireFixture(width) {
  let sequence = 30;
  const g1 = () => ({x: sequence++, y: sequence++});
  const g2 = () => ({xIm: sequence++, xRe: sequence++, yIm: sequence++, yRe: sequence++});
  const flags = {verified_locally: true, browser_generated: true};
  const vk = {alpha_g1: g1(), beta_g2: g2(), gamma_g2: g2(), delta_g2: g2(), gamma_abc_g1: [g1(), g1()]};
  const commitment = g1();
  const source = {...commitment, rows: 4};
  const preview = {width, public_statement: field(16), output_commitments: [3,4,5,6,7], nullifiers: Array.from({length: width}, (_,i) => i+8)};
  const envelopes = ['0x11','0x22','0x33','0x44','0x55'];
  const bundle = {research_only: true, safe_for_funds: false, chain_id: domain.chainId, family_tag: domain.familyTag,
    source_epoch: 1, checkpoint_ref: 2, slot_count: source.rows,
    gate0: {...flags, public_statement: preview.public_statement, vk, a:g1(), b:g2(), c:g1(), d:g1()},
    gate1: {...flags, table:{n:4,commitment,z_h_g1:g1()},query:g1(),srs:{g1:[g1()],g2:[g2(),g2()]},
      proof:{z_i:g1(),c_i:g1(),u:g1(),w:g2(),h:g1(),v1:sequence++,v2:sequence++,pi1:g1(),pi2:g1(),pi3:g1()}, transcript_context_hex:'0x1234'},
    cp_link:{...flags,pi:g1(),a2:g2(),c1:g2(),c2:g2()},
    public_inputs:[preview.public_statement,field(0,true),field(0,true),field(7),domain.familyTag,field(domain.chainId)]};
  const rowKeys = envelopes.map(() => ({a:g1(),u:g1(),aCompressed:word(sequence++),uCompressed:word(sequence++),siblings:Array.from({length:16},()=>word(sequence++))}));
  const q = Object.fromEntries(currentNormal.FAMILY_NORMAL_FIELDS.map(({name,type}) => [name,type==='address'?address(1):type==='bytes32'?word(1):1]));
  Object.assign(q,{...domain,width,mode:1,payout:0,recipient:ZeroAddress,sourceEpoch:1,sourceCheckpoint:2,saltedAmountHash:7,
    protocolFeeCap:0,partnerFeeCap:0,nullifiersHash:currentEnhanced.enhancedHashNullifiers(preview.nullifiers,width),
    outputsHash:currentEnhanced.enhancedHashOutputs(preview.output_commitments),envelopesHash:currentEnhanced.enhancedHashEnvelopes(envelopes),
    feeSlotsHash:keccak256(AbiCoder.defaultAbiCoder().encode(['uint8[3]'],[[1,2,3]]))});
  const feeProof = {safe_for_funds:false,verified_locally:true,selected_proof_path:'STREAM_BOUND4',commitment_scheme:'ccgroth16-policy-v1',committed_witnesses:1,proof:'0x'+'ab'.repeat(1088)};
  const normal = {domain,preview,source,q,bundle,rowKeys,envelopes,signature:'0x'+'bc'.repeat(65),expectedFeeSignals:Array(40).fill(1),
    combined:{...feeProof, relation:'combined-fee-partner', public_signals:Array(40).fill(1)}};
  const exitQ = {...q,recipient:address(3),payout:5,protocolFee:0,partnerFee:0,relayer:ZeroAddress};
  const exit = {...normal,q:exitQ,aggregate:{relation:'payout-aggregate',selected_proof_path:'STREAM_BOUND4',safe_for_funds:false,verified_locally:true,
    vk:{alpha:vk.alpha_g1,beta:vk.beta_g2,gamma:vk.gamma_g2,delta:vk.delta_g2,ic:vk.gamma_abc_g1},
    public_signals:[currentExit.familyExitBatchField(exitQ),field(1),field(5),field(7),...Array(7).fill(field(0,true)),domain.familyTag,field(domain.chainId)],
    proof:'0x'+'00'.repeat(256)}};
  const enhanced = {...normal,header:{...q,amountHash:7,authorizationDigest:9,reservationCommitment:1},
    protocolRecipient:address(3),partnerRecipient:address(4),signedDigest:word(2),feeSignals:Array(41).fill(2),
    fee:{...feeProof,relation:'enhanced-fee-partner',public_signals:Array(41).fill(2)},authorizationSignals:[8],
    authorization:{safeForFunds:false,verified:true,role:'enhanced-authorization',publicSignals:[8],proof:'0x'+'01'.repeat(256)}};
  return {normal,exit,enhanced};
}

test('released calldata and handle behavior remain byte-compatible',async()=>{
  const archive=join(root,'releases/0.4.57/stealthos-vanta-sdk-0.4.57.tgz');
  assert.equal(createHash('sha256').update(await readFile(archive)).digest('hex'),'ebd277014ddf18a8d25e9c9166162900070918df6f4d9b855c53f3c86443b9e0');
  const directory=join(root,'.build');await mkdir(directory,{recursive:true});
  await using old=await mkdtempDisposable(join(directory,'release-vectors-'));
  execFileSync('tar',['-xzf',archive,'-C',old.path]);
  const oldModule=name=>import(pathToFileURL(join(old.path,'package/fresh',name+'.mjs')).href);
  const [normal,exit,enhanced,route]=await Promise.all(['family-normal-wire','family-exit-wire','family-enhanced-wire','family-deposit-route'].map(oldModule));
  for(const width of [8,32]){
    const data=wireFixture(width);
    for(const [name,actual,previous,input] of [
      ['normal',currentNormal.encodeFamilyPrivateSend,normal.encodeFamilyPrivateSend,data.normal],
      ['exit',currentExit.encodeFamilyExit,exit.encodeFamilyExit,data.exit],
      ['enhanced',currentEnhanced.encodeEnhancedFundingProof,enhanced.encodeEnhancedFundingProof,data.enhanced]
    ]) {
      assert.equal(actual(input),previous(input),name+' width '+width);
      const changed={...input,bundle:{...input.bundle,public_inputs:Array(6).fill(0)}};
      assert.throws(()=>actual(changed));
    }
  }
  for(const value of [null,undefined,0,'',' ','ALICE',' ALICE.STEALTH ','alice.stealth','abc','ab','a','a.b','ab.cd','ab.cd.stealth','a-b','-abc','abc-','x.y.z','a'.repeat(32),'a'.repeat(33),'a'.repeat(24)+'.'+'b'.repeat(24),'ééé','a b','a/b','abc.']){
    let expected;
    try {expected=route.normalizeFreshHandle(value);} catch(error){assert.throws(()=>normalizeFreshHandle(value),{message:error.message});continue;}
    assert.equal(normalizeFreshHandle(value),expected);
  }
});
test('canonical metadata preserves array order, escaped text, UTF-8 and sorted keys',()=>{
  const value={z:[{b:2,a:1},null,true],a:'é"\\'};
  const expected='{"a":"é\\"\\\\","z":[{"a":1,"b":2},null,true]}';
  assert.equal(canonicalJson(value),expected);
  assert.equal(createHash('sha256').update(canonicalJson(value)).digest('hex'),'d7001093b3a0fa9401dba9761ac5d6d6d8e2f52cf65824a0096e66cbec085176');
});
