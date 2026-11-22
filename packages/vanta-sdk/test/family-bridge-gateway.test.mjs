import test,{mock}from'node:test';import assert from'node:assert/strict';import{keccak256}from'ethers';
const a=n=>'0x'+n.toString(16).padStart(40,'0'),w=n=>'0x'+n.toString(16).padStart(64,'0'),code='0x6000',hash=w(90);
const pin={networkId:'eip155:6281971',genesisHash:w(1),setupId:w(2),generationId:w(3),lockId:w(4),previousGateway:a(1),previousCodehash:w(5),gateway:{address:a(2),codehash:keccak256(code),deploymentBlock:20},maximumDeliveryFee:'50000000000000000000'};
mock.module('../fresh/generated-family-bridge-gateway.mjs',{namedExports:{FAMILY_CHIKYU_BRIDGE_GATEWAY:pin}});
const{familyBridgeRoutes:routes,familyBridgeRoutesForTarget:target,verifyFamilyBridgeGateway:verify}=await import('../fresh/family-bridge-gateway.mjs');
const release={pins:Object.fromEntries(['networkId','genesisHash','setupId','generationId','lockId'].map(k=>[k,pin[k]]))},old=Object.freeze({gateway:Object.freeze({address:pin.previousGateway,codehash:pin.previousCodehash,deploymentBlock:10}),maximumDeliveryFee:'30000000000000000000',bnmPool:a(3)});
test('bridge extension changes only the reviewed gateway and cap within its exact frozen scope',()=>{
 const next=routes(release,old);assert.equal(next.gateway,pin.gateway);assert.equal(next.maximumDeliveryFee,pin.maximumDeliveryFee);assert.equal(next.bnmPool,old.bnmPool);assert.equal(old.maximumDeliveryFee,'30000000000000000000');assert.ok(Object.isFrozen(next));
 assert.equal(routes(release,old,4),old);
 for(const key of['networkId','genesisHash','setupId','generationId','lockId'])assert.equal(routes({pins:{...release.pins,[key]:'other'}},old),old);
 for(const changed of[{...old,gateway:{...old.gateway,address:a(9)}},{...old,gateway:{...old.gateway,codehash:w(9)}},{...old,maximumDeliveryFee:'31000000000000000000'}])assert.throws(()=>routes(release,changed),/gateway/);
});
test('historical bridge journals retain their original exact target; other targets are rejected',()=>{
 assert.equal(target(release,old,pin.previousGateway),old);assert.equal(target(release,old,pin.gateway.address).gateway,pin.gateway);assert.throws(()=>target(release,old,a(99)),/gateway/);
});
test('the extra gateway is checked at a fresh canonical anchor, with shared providers deduplicated',async()=>{
 let reads=0,changed=false,badCode=false;
 const provider={getCode:async(address,block)=>{assert.equal(address,pin.gateway.address);assert.equal(block,25);reads++;return badCode?'0x6001':code;},getBlock:async()=>({hash:changed?w(91):hash})},input={providers:[provider,provider],release,routes:old,block:{number:25,hash}};
 await verify(input);assert.equal(reads,1);await verify(input);assert.equal(reads,2,'No persisted trusted boolean');badCode=true;await assert.rejects(verify(input),/gateway/);badCode=false;changed=true;await assert.rejects(verify(input),/gateway/);await assert.rejects(verify({...input,block:{number:19,hash}}),/gateway/);
});
