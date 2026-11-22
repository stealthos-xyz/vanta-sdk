import {getConfirmedBlock} from './transaction-confirmations.mjs';
/** Current rates come from the code-pinned on-chain policy, never a relayer
 * response or an app override. Reads use one common canonical block. */
import {Interface,getAddress,keccak256,AbiCoder} from 'ethers';
const abi=new Interface([
 'function protocolFeePolicy() view returns(address)', 'function feePolicyHash() view returns(bytes32)',
 'function exitFeePolicyHash() view returns(bytes32)', 'function policyHash() view returns(bytes32)',
 'function administrator() view returns(address)', 'function basePolicyHash() view returns(bytes32)',
 'function revision() view returns(uint64)', 'function ratesAt(uint64) view returns(uint16[6])',
 'function enhancedFeeVerifier() view returns(address)', 'function protocolBps() view returns(uint16)',
 'function releaseSetupId() view returns(bytes32)', 'function releaseGenerationId() view returns(bytes32)',
 'function releaseFamilyTag() view returns(bytes32)', 'function releaseChainId() view returns(uint256)',
 'function releaseGenesisHash() view returns(bytes32)'
]);
const policyBlock=(provider,tag)=>['confirmed','latest','safe','finalized'].includes(tag)?getConfirmedBlock(provider):provider.getBlock(tag);
const lower=v=>String(v).toLowerCase();
const fail=()=>{throw Error('Protocol fee policy differs from the signed deployment or canonical chain state.');};
/** Only the public wrapper may select this adapter, and only for a branded
 * withdrawal-only KZG generation whose signed lock has no mutable policy. */
export async function readFixedFamilyProtocolFeesCore({provider,verificationProvider,pool,blockTag='confirmed',release}={}){
 if(!provider||!verificationProvider||provider===verificationProvider||release.lock.contracts.some(r=>r.name==='protocol-fee-policy'))fail();
 pool=getAddress(pool);
 const pin=release.lock.contracts.find(r=>r.kind==='pool'&&lower(r.address)===lower(pool));if(!pin)fail();
 const chain=BigInt(release.pins.networkId.split(':')[1]);
 const [a,b,ga,gb,ha,hb]=await Promise.all([provider.getNetwork(),verificationProvider.getNetwork(),
  provider.getBlock(0),verificationProvider.getBlock(0),policyBlock(provider,blockTag),policyBlock(verificationProvider,blockTag)]);
 if(a.chainId!==chain||b.chainId!==chain||lower(ga?.hash)!==lower(release.pins.genesisHash)||lower(gb?.hash)!==lower(release.pins.genesisHash))fail();
 const height=Math.min(ha?.number,hb?.number);if(!Number.isSafeInteger(height))fail();
 const [x,y]=await Promise.all([provider.getBlock(height),verificationProvider.getBlock(height)]);
 if(!x?.hash||lower(x.hash)!==lower(y?.hash))fail();
 async function call(to,name){const tx={to,data:abi.encodeFunctionData(name),blockTag:height};
  const [u,v]=await Promise.all([provider.call(tx),verificationProvider.call(tx)]);if(lower(u)!==lower(v))fail();return abi.decodeFunctionResult(name,u)[0];}
 const adapterAddress=await call(pool,'enhancedFeeVerifier');
 const adapter=release.lock.contracts.find(r=>r.kind==='verifier'&&lower(r.address)===lower(adapterAddress));if(!adapter)fail();
 for(const item of [pin,adapter]){
  const codes=await Promise.all([provider.getCode(item.address,height),verificationProvider.getCode(item.address,height)]);
  if(codes.some(c=>!c||c==='0x'||lower(keccak256(c))!==lower(item.codehash)))fail();
  for(const [method,value]of [['releaseSetupId',release.pins.setupId],['releaseGenerationId',release.pins.generationId],
   ['releaseFamilyTag',release.setup.family.tag],['releaseChainId',chain]])if(BigInt(await call(item.address,method))!==BigInt(value))fail();
  if(lower(await call(item.address,'releaseGenesisHash'))!==lower(release.pins.genesisHash))fail();
 }
 const policyHash=await call(pool,'feePolicyHash'),rate=Number(await call(adapter.address,'protocolBps'));
 if(policyHash!==await call(adapter.address,'policyHash')||!Number.isInteger(rate)||rate<0||rate>10000)fail();
 const heads=await Promise.all([provider.getBlock(height),verificationProvider.getBlock(height)]);
 if(heads.some(v=>lower(v?.hash)!==lower(x.hash)))fail();
 // Unavailable operations are explicit; they must never inherit another rate.
 return Object.freeze({address:getAddress(adapter.address),administrator:release.setup.family.activationAuthority,revision:'0',
  rates:Object.freeze([rate,null,0,rate,null,null]),policyHash,basePolicyHash:policyHash,
  withdrawalOnly:true,blockNumber:height,blockHash:x.hash});
}
export async function readFamilyProtocolFeesCore({provider,verificationProvider,pool,blockTag='confirmed',release}={}){
 if(!provider||!verificationProvider||provider===verificationProvider)fail();
 pool=getAddress(pool);
 const policies=release.lock.contracts.filter(r=>r.name==='protocol-fee-policy');
 const pools=release.lock.contracts.filter(r=>lower(r.address)===lower(pool)&&r.kind==='pool');
 if(policies.length!==1||pools.length!==1)fail();
 const p=policies[0],networkId=BigInt(release.pins.networkId.split(':')[1]);
 const [networkA,networkB,genesisA,genesisB]=await Promise.all([
  provider.getNetwork(),verificationProvider.getNetwork(),provider.getBlock(0),verificationProvider.getBlock(0)]);
 if(networkA.chainId!==networkId||networkB.chainId!==networkId||
  lower(genesisA?.hash)!==lower(release.pins.genesisHash)||lower(genesisB?.hash)!==lower(release.pins.genesisHash))fail();
 const [a,b]=await Promise.all([policyBlock(provider,blockTag),policyBlock(verificationProvider,blockTag)]);
 const height=Math.min(a?.number,b?.number);if(!Number.isSafeInteger(height))fail();
 const [x,y]=await Promise.all([provider.getBlock(height),verificationProvider.getBlock(height)]);
 if(!x?.hash||lower(x.hash)!==lower(y?.hash))fail();
 async function call(to,name,args=[]){
  const tx={to,data:abi.encodeFunctionData(name,args),blockTag:height};
  const [u,v]=await Promise.all([provider.call(tx),verificationProvider.call(tx)]);
  if(lower(u)!==lower(v))fail();return abi.decodeFunctionResult(name,u)[0];
 }
 for(const pin of [p,pools[0]]){
  const codes=await Promise.all([provider.getCode(pin.address,height),verificationProvider.getCode(pin.address,height)]);
  if(codes.some(code=>code==='0x'||lower(keccak256(code))!==lower(pin.codehash)))fail();
 }
 if(lower(await call(pool,'protocolFeePolicy'))!==lower(p.address))fail();
 for(const [name,value] of [['releaseSetupId',release.pins.setupId],['releaseGenerationId',release.pins.generationId],
  ['releaseFamilyTag',release.setup.family.tag],['releaseChainId',networkId]])
  if(BigInt(await call(p.address,name))!==BigInt(value))fail();
 const administrator=getAddress(await call(p.address,'administrator'));
 if(lower(administrator)!==lower(release.setup.family.activationAuthority))fail();
 const revision=await call(p.address,'revision'),rates=Array.from(await call(p.address,'ratesAt',[revision]),Number);
 if(revision<1n||rates.length!==6||rates[2]!==0||rates.some(n=>n<0||n>=10000))fail();
 const basePolicyHash=await call(p.address,'basePolicyHash');
 if(basePolicyHash!==await call(pool,'exitFeePolicyHash'))fail();
 const digest=keccak256(AbiCoder.defaultAbiCoder().encode(
  ['string','uint256','address','bytes32','bytes32','bytes32','uint64','uint16[6]'],
  ['STEALTHOS_PROTOCOL_FEE_POLICY_V1',networkId,p.address,release.pins.setupId,release.pins.generationId,basePolicyHash,revision,rates]));
 if(digest!==await call(p.address,'policyHash')||digest!==await call(pool,'feePolicyHash'))fail();
 const current=await Promise.all([provider.getBlock(height),verificationProvider.getBlock(height)]);
 if(current.some(v=>lower(v?.hash)!==lower(x.hash)))fail();
 return Object.freeze({address:getAddress(p.address),administrator,revision:revision.toString(),rates:Object.freeze(rates),
  policyHash:digest,basePolicyHash,blockNumber:height,blockHash:x.hash});
}
