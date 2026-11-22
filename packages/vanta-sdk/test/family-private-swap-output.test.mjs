import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TypedDataEncoder,id,keccak256,ZeroAddress} from 'ethers';
import {depositPoolAbi} from '../fresh/family-deposit-wire.mjs';
import {privateSwapOutputScope,privateSwapOutputEscrow,privateSwapOutputDomain,privateSwapOutputClaimTypes,privateSwapOutputAbi,
 derivePrivateSwapOutputSigner,inspectPrivateSwapOutputClaim} from '../fresh/family-private-swap-output-wire.mjs';
const scope={networkId:'eip155:6281971',genesisHash:id('genesis'),generationId:id('generation'),setupId:id('setup'),familyTag:id('family'),
 gateway:'0x1111111111111111111111111111111111111111',gatewayCodehash:id('gateway'),escrowImplementation:'0x2222222222222222222222222222222222222222',escrowCodehash:id('escrow')};
const pool='0x3333333333333333333333333333333333333333',relayer='0x4444444444444444444444444444444444444444',salt=id('route');
const wallet={privateWalletKeys:async()=>({masterSeed:new Uint8Array(32).fill(17)})};
const zero='0x'+'00'.repeat(32);
async function packet(quoteFields={}){
 const signer=await derivePrivateSwapOutputSigner(wallet,scope,{pool,salt}),owner=signer.owner;
 const payer=privateSwapOutputEscrow(scope,{pool,owner,salt});
 const quote={chainId:6281971,pool,asset:ZeroAddress,epoch:1,checkpoint:1,payer,count:1,gross:19,protocolFeeCap:0,partnerFeeCap:0,
  protocolRecipient:relayer,partnerRecipient:relayer,outputsHash:zero,envelopesHash:zero,feeSlotsHash:zero,feeTermsHash:1,partnerRegistryRoot:1,nonce:id('credit'),deadline:1500,feePolicyHash:zero,...quoteFields};
 const key={a:{x:0,y:0},u:{x:0,y:0},aCompressed:zero,uCompressed:zero,siblings:Array(16).fill(zero)};
 const data=depositPoolAbi.encodeFunctionData('depositWithPrivateFeeNotes',[quote,[1,2,3,0,0],['0x','0x','0x','0x','0x'],Array(5).fill(key),[1,2],'0xab','0xcd']);
 const credit={pool,owner,salt,amount:'20'},value={creditId:id('credit'),nonce:0,deadline:1500,relayer,reimbursement:1,depositHash:keccak256(data)};
 const signature=signer.sign(TypedDataEncoder.hash(privateSwapOutputDomain(scope),privateSwapOutputClaimTypes,value));
 return {args:[id('credit'),0,1500,relayer,1,data,signature],quote,payer,credit};
}
test('absence or different signed release fails before funding a receiver',()=>{
 const release={pins:{...scope},setup:{family:{tag:scope.familyTag}}};
 assert.throws(()=>privateSwapOutputScope(release));
 assert.equal(privateSwapOutputScope(release,scope),scope);
 assert.throws(()=>privateSwapOutputScope({...release,pins:{...release.pins,generationId:id('other')}},scope));
});
test('claim identity is portable from the phrase and separated by route, pool, chain and generation',async()=>{
 const key=await derivePrivateSwapOutputSigner(wallet,scope,{pool,salt});
 assert.equal((await derivePrivateSwapOutputSigner(wallet,scope,{pool,salt})).owner,key.owner);
 for(const [differentScope,differentRoute]of [[{...scope,generationId:id('new')},{pool,salt}],
  [{...scope,networkId:'eip155:1'},{pool,salt}],[scope,{pool:relayer,salt}],[scope,{pool,salt:id('new-route')}]]){
  assert.notEqual((await derivePrivateSwapOutputSigner(wallet,differentScope,differentRoute)).owner,key.owner);
 }
});
test('exact factory packet authenticates private payer, deposit and reimbursement',async()=>{
 const {args,payer,credit}=await packet(),data=privateSwapOutputAbi.encodeFunctionData('claim',args);
 const parsed=inspectPrivateSwapOutputClaim(scope,data,credit);
 assert.equal(parsed.escrow,payer);assert.equal(parsed.q.gross,19n);assert.equal(parsed.reimbursement,1n);
});
test('redirected output, reimbursement, relayer, chain, factory and appended bytes fail',async()=>{
 const {args,credit}=await packet();
 for(const [index,value] of [[0,id('other-credit')],[3,pool],[4,2],[1,1]]){
  const changed=[...args];changed[index]=value;
  assert.throws(()=>inspectPrivateSwapOutputClaim(scope,privateSwapOutputAbi.encodeFunctionData('claim',changed),credit));
 }
 const data=privateSwapOutputAbi.encodeFunctionData('claim',args);
 assert.throws(()=>inspectPrivateSwapOutputClaim({...scope,networkId:'eip155:1'},data,credit));
 assert.throws(()=>inspectPrivateSwapOutputClaim({...scope,gateway:relayer},data,credit));
 assert.throws(()=>inspectPrivateSwapOutputClaim(scope,data+'00',credit));
});
test('even an owner-signed swap output cannot add a deposit fee',async()=>{
 for(const quoteFields of [{protocolFeeCap:1},{partnerFeeCap:1}]){
  const {args,credit}=await packet(quoteFields);
  assert.throws(()=>inspectPrivateSwapOutputClaim(scope,privateSwapOutputAbi.encodeFunctionData('claim',args),credit));
 }
});
