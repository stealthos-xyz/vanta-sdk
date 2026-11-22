/** Public app presentation settings, authorized by the existing private-owner
 * relation. They never select contracts, keys, fee rates or withdrawal rights. */
import {AbiCoder,Interface,getAddress,keccak256,toUtf8Bytes} from 'ethers';
import {getSharedConfirmedBlock} from './transaction-confirmations.mjs';
import {normalizePartnerApplication,partnerApplicationHash} from './partner-application.mjs';
const coder=AbiCoder.defaultAbiCoder(),FR=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const abi=new Interface([
 'function partnerIdentity(bytes32) view returns(uint256 authorizationCommitment,uint256 receiverCommitment,bytes32 routingCommitment,bytes32 salt,uint64 nextRevision,bool exists)',
 'function registeredAssetMask(bytes32) view returns(uint8)',
 'function getHandleState(bytes32) view returns(bytes32 recordCommitment,bytes32 ownerCommitment,uint64 epoch,bool exists)',
 'function verifyProof(uint256[2],uint256[2][2],uint256[2],uint256[7]) view returns(bool)'
]);
const fail=()=>{throw Error('Partner asset configuration is not authorized for the signed deployment.');};
export function partnerAssetConfigurationDigest(configuration,authorizationCommitment){
 const c=configuration;
 const application=c?.schema==='stealthos-partner-app-assets-v2';
 if(!c||Object.keys(c).sort().join()!==(application?'app,':'')+'deadline,generationId,genesisHash,handle,handleId,networkId,registrar,revision,schema,setupId,visibleAssets'||
   !['stealthos-partner-app-assets-v1','stealthos-partner-app-assets-v2'].includes(c.schema)||!/^eip155:[1-9][0-9]*$/u.test(c.networkId)||
   !/^[a-z0-9][a-z0-9.-]{1,63}$/u.test(c.handle)||!Array.isArray(c.visibleAssets)||c.visibleAssets.length>8||
   new Set(c.visibleAssets.map(a=>getAddress(a).toLowerCase())).size!==c.visibleAssets.length||
   !/^[1-9][0-9]{0,19}$/u.test(c.revision)||BigInt(c.revision)>=(1n<<64n)||
   !Number.isSafeInteger(c.deadline)||c.deadline<1||BigInt(c.deadline)>=(1n<<64n))fail();
 const digest=BigInt(keccak256(coder.encode(
  ['bytes32','uint256','address','bytes32','bytes32','bytes32','bytes32','bytes32','uint256','address[]','uint64','uint64'],
  [keccak256(toUtf8Bytes('STEALTHOS_PARTNER_APP_ASSETS_V1')),BigInt(c.networkId.split(':')[1]),c.registrar,c.setupId,c.generationId,c.genesisHash,
   c.handleId,keccak256(toUtf8Bytes(c.handle)),authorizationCommitment,c.visibleAssets,BigInt(c.revision),BigInt(c.deadline)])))%FR;
 return application?BigInt(keccak256(coder.encode(['bytes32','uint256','bytes32'],
  [keccak256(toUtf8Bytes('STEALTHOS_PARTNER_APPLICATION_V2')),digest,partnerApplicationHash(c.app)])))%FR:digest;
}
export async function verifyPartnerAssetConfigurationCore({authorization,release,inventory,provider,verificationProvider,allowExpired=false,now=Math.floor(Date.now()/1000)}){
 const a=authorization,c=a?.configuration;if(!a||Object.keys(a).sort().join()!=='actionDigest,authorizationCommitment,authorizationNullifier,configuration,ownerCommitment,ownershipProof')fail();
 const role=name=>{const r=release.lock.contracts.filter(p=>p.name===name);if(r.length!==1)fail();return r[0];};
 const registrar=role('partner-registrar'),handles=role('handle-registry'),verifier=role('partner-owner');
 if(c.networkId!==release.pins.networkId||c.generationId!==release.pins.generationId||c.setupId!==release.pins.setupId||
   !same(c.genesisHash,release.pins.genesisHash)||!same(c.registrar,registrar.address)||
   !Array.isArray(a.ownershipProof)||a.ownershipProof.length!==8||a.ownershipProof.some(v=>!/^0x[0-9a-f]{64}$/iu.test(v)&&!/^(0|[1-9][0-9]{0,77})$/u.test(String(v))))fail();
 const digest=partnerAssetConfigurationDigest(c,BigInt(a.authorizationCommitment));
 if(digest!==BigInt(a.actionDigest)||digest===0n||BigInt(a.authorizationNullifier)<=0n||BigInt(a.authorizationNullifier)>=FR||
   BigInt(a.ownerCommitment)<=0n||BigInt(a.ownerCommitment)>=FR||BigInt(a.authorizationCommitment)<=0n||BigInt(a.authorizationCommitment)>=FR||
   !allowExpired&&(c.deadline<=now||c.deadline>now+3600))fail();
 const all=inventory.funding.pools.map(p=>getAddress(p.asset).toLowerCase()),selected=c.visibleAssets.map(p=>getAddress(p).toLowerCase());
 if(selected.some(p=>!all.includes(p))||JSON.stringify(all.filter(p=>selected.includes(p)))!==JSON.stringify(selected))fail();
 if(provider===verificationProvider)fail();
 const clients=[provider,verificationProvider],head=await getSharedConfirmedBlock(provider,verificationProvider);
 for(const client of clients){
  const network=await client.getNetwork(),genesis=await client.getBlock(0);
  if(BigInt(network.chainId)!==BigInt(c.networkId.split(':')[1])||!same(genesis?.hash,c.genesisHash))fail();
  for(const pin of [registrar,handles,verifier])if(!same(keccak256(await client.getCode(pin.address,head.number)),pin.codehash))fail();
 }
 const read=async(to,name,args)=>{const responses=await Promise.all(clients.map(p=>p.call({to,data:abi.encodeFunctionData(name,args),blockTag:head.number})));
  if(!same(responses[0],responses[1]))fail();return abi.decodeFunctionResult(name,responses[0]);};
 const [identity,handle,mask]=await Promise.all([read(registrar.address,'partnerIdentity',[c.handleId]),read(handles.address,'getHandleState',[c.handleId]),read(registrar.address,'registeredAssetMask',[c.handleId])]);
 if(!identity.exists||!handle.exists||handle.epoch!==1n||identity.authorizationCommitment!==BigInt(a.authorizationCommitment)||
   BigInt(handle.ownerCommitment)!==BigInt(a.ownerCommitment)||selected.some(p=>(Number(mask[0])&(1<<all.indexOf(p)))===0))fail();
 const p=a.ownershipProof.map(BigInt),inputs=[BigInt(release.setup.family.tag),BigInt(c.networkId.split(':')[1]),BigInt(c.handleId),BigInt(a.ownerCommitment),BigInt(a.authorizationCommitment),digest,BigInt(a.authorizationNullifier)];
 const [valid]=await read(verifier.address,'verifyProof',[p.slice(0,2),[p.slice(2,4),p.slice(4,6)],p.slice(6,8),inputs]);if(valid!==true)fail();
 const blocks=await Promise.all(clients.map(p=>p.getBlock(head.number)));if(blocks.some(b=>!same(b?.hash,head.hash)))fail();
 return Object.freeze({...c,...(c.app?{app:normalizePartnerApplication(c.app)}:{}),visibleAssets:Object.freeze([...selected]),verifiedOnChain:true});
}
