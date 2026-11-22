import test,{mock}from'node:test';import assert from'node:assert/strict';import{Interface}from'ethers';
const a=n=>'0x'+n.toString(16).padStart(40,'0'),hash='0x'+'ab'.repeat(32);
const routes={nativePool:a(1),usdcPool:a(2),bnmPool:a(3),usdc:a(12),bnm:a(13),muchFi:{address:a(4)},wrappedDoge:{address:a(5)},ccip:{address:a(6)},maximumDeliveryFee:'100',destination:{selector:'1'}};
const funding={routes,pools:[{pool:a(1),asset:a(0),assetDecimals:18},{pool:a(2),asset:a(12),assetDecimals:6},{pool:a(3),asset:a(13),assetDecimals:18}]};
let verifications=0,changed=false,deliveryFee=10n;
mock.module('../fresh/family-network.mjs',{namedExports:{getCompiledFamilyEvmRelease:()=>({}),verifyCompiledFamilyOperationRuntime:async()=>{verifications++;}}});
mock.module('../fresh/family-proof-resources.mjs',{namedExports:{getCompiledVantaFamilyProofResources:()=>({funding})}});
mock.module('../fresh/transaction-confirmations.mjs',{namedExports:{getSharedConfirmedBlock:async()=>({number:10,hash})}});
const {prepareFamilyNetRoute}=await import('../fresh/family-route-review.mjs');
const dex=new Interface(['function getAmountsOut(uint256,address[]) view returns(uint256[])']),ccip=new Interface(['function getFee(uint64,tuple(bytes receiver,bytes data,tuple(address token,uint256 amount)[] tokenAmounts,address feeToken,bytes extraArgs)) view returns(uint256)']);
const provider={getBlock:async()=>({hash:changed?'0x'+'cd'.repeat(32):hash}),call:async tx=>{assert.equal(tx.blockTag,10);if(tx.to===routes.muchFi.address){const p=dex.parseTransaction(tx);return dex.encodeFunctionResult('getAmountsOut',[[p.args[0],p.args[0]*2n]]);}return ccip.encodeFunctionResult('getFee',[deliveryFee]);}};
test('prepared route reads exact post-fee amounts at its canonical anchor and rejects a reorg',async()=>{
 for(const operation of[4,5]){changed=false;const quote=await prepareFamilyNetRoute({provider,verificationProvider:provider,operation,asset:operation===4?'native':a(13),receiver:a(8)});
  const result=await quote('80');assert.equal(result.amountOutAtomic,operation===4?'160':'80');assert.equal(result.maximumDeliveryFeeAtomic,operation===4?'0':'12');
  changed=true;await assert.rejects(quote('80'),/current quote/);
 }assert.equal(verifications,4);
});

test('bridge padding respects the signed ceiling while the actual fee must fit',async()=>{
 changed=false;
 const quote=await prepareFamilyNetRoute({provider,verificationProvider:provider,operation:5,asset:a(13),receiver:a(8)});
 for(const fee of[91n,99n,100n]){
  deliveryFee=fee;
  const result=await quote('80');
  assert.equal(result.maximumDeliveryFeeAtomic,'100');
  assert.equal(result.amountOutAtomic,'80');
 }
 deliveryFee=101n;
 await assert.rejects(quote('80'),{code:'CCIP_DELIVERY_LIMIT'});
 deliveryFee=10n;
 assert.equal((await quote('80')).maximumDeliveryFeeAtomic,'12');
});
