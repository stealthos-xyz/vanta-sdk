import test from 'node:test';
import assert from 'node:assert/strict';
import {ZeroAddress, keccak256} from 'ethers';
import {familyNormalAbi} from '../fresh/family-normal-wire.mjs';
import {familyBatchPayoutAbi, familyBatchEscrowAddress, encodeFamilyBatchPayout, decodeFamilyBatchPayout,
  verifyFamilyBatchPayout,familyBatchPayoutScope} from '../fresh/family-batch-payout-wire.mjs';
import {A, W, row, setup} from './family-normal-host-fixture.mjs';

test('a replacement bootstrap uses its signed batch gateway rather than the preceding generation',()=>{
 const release={pins:{networkId:'eip155:6281971',setupId:W(1),generationId:W(2),genesisHash:W(3)},setup:{family:{tag:W(4)}},
  lock:{contracts:[{name:'batch-payout-gateway',address:A(50),codehash:W(5)},{name:'batch-payout-escrow',address:A(51),codehash:W(6)}]}};
 const actual=familyBatchPayoutScope(release);assert.equal(actual.generationId,W(2));assert.equal(actual.gateway,A(50));assert.equal(actual.escrowImplementation,A(51));
 assert.throws(()=>familyBatchPayoutScope(release,{...actual,generationId:W(8)}));
});

test('batch wraps a normal proof and authenticates the exact ordered payouts', () => {
  setup(0);
  const previous = row(), gateway = {gateway:A(50), escrowImplementation:A(51)};
  const batch = {recipients:[A(5),A(6),A(7)], amounts:['20','30','50']};
  const quote = {...previous.q, relayer:gateway.gateway};
  quote.recipient = familyBatchEscrowAddress(gateway, quote, batch);
  const original = familyNormalAbi.parseTransaction({data:previous.calldata});
  const poolCalldata = familyNormalAbi.encodeFunctionData(original.fragment,[quote,original.args[1],'0x']);
  const calldata = encodeFamilyBatchPayout(gateway, quote, batch, poolCalldata);
  const decoded = decodeFamilyBatchPayout(gateway, quote, batch, calldata);
  assert.equal(decoded.name, 'execute8');
  assert.equal(decoded.args[0].mode, 0n);
  assert.equal(familyNormalAbi.encodeFunctionData(original.fragment,decoded.args.slice(0,3)),poolCalldata);
  const changed = {...batch,recipients:[A(6),A(5),A(7)]};
  assert.notEqual(familyBatchEscrowAddress(gateway,quote,changed),quote.recipient);
  assert.throws(() => decodeFamilyBatchPayout(gateway,quote,changed,calldata),/binding differs/);
  const altered = familyBatchPayoutAbi.encodeFunctionData(decoded.fragment,[...decoded.args.slice(0,3),changed]);
  assert.throws(() => decodeFamilyBatchPayout(gateway,quote,batch,altered),/binding differs/);
  assert.throws(() => decodeFamilyBatchPayout(gateway,quote,batch,calldata+'00'),/binding differs/);
  assert.throws(() => encodeFamilyBatchPayout(gateway,quote,{...batch,amounts:['20','29','50']},poolCalldata),/binding differs/);
});

test('verification checks both frozen bytecodes and the pinned source pool', async () => {
  const gateCode='0x6010',escrowCode='0x6020',pool=A(1),pin=W(812);
  const deployment={gateway:A(50),escrowImplementation:A(51),gatewayCodehash:keccak256(gateCode),escrowCodehash:keccak256(escrowCode)};
  const provider={
    getCode:async(address,block)=>{assert.equal(block,100);return address===deployment.gateway?gateCode:escrowCode;},
    call:async({to,data,blockTag})=>{
      assert.equal(to,deployment.gateway);
      assert.equal(blockTag,100);
      assert.equal(familyBatchPayoutAbi.decodeFunctionData('poolCodeHash',data)[0],pool);
      return familyBatchPayoutAbi.encodeFunctionResult('poolCodeHash',[pin]);
    },
  };
  await verifyFamilyBatchPayout(provider,deployment,pool,pin,100);
  await assert.rejects(verifyFamilyBatchPayout(provider,deployment,pool,W(11),100),/binding differs/);
  await assert.rejects(verifyFamilyBatchPayout(provider,{...deployment,escrowCodehash:W(5)},pool,pin,100),/binding differs/);
});
