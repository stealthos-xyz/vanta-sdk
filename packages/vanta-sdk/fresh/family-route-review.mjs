/** Public venue quotes only; the amount here is the post-fee route input. */
import{Interface,AbiCoder,getAddress,ZeroAddress}from'ethers';
import{getCompiledFamilyEvmRelease,verifyCompiledFamilyOperationRuntime}from'./family-network.mjs';
import{getCompiledVantaFamilyProofResources}from'./family-proof-resources.mjs';
import{getSharedConfirmedBlock}from'./transaction-confirmations.mjs';
import{familyBridgeRoutes,verifyFamilyBridgeGateway}from'./family-bridge-gateway.mjs';
/** Verify the route while the ordinary Send fee/note/gas checks are running.
 * This closure retains one explicit canonical anchor for this review only. */
export async function prepareFamilyNetRoute({provider,verificationProvider,releaseContext,asset,operation,slippageBps=100,receiver}){
 const fail=()=>{throw Error('Family route review: A current quote for the amount after fees is required.');};
 if(![4,5].includes(operation)||!Number.isInteger(slippageBps)||slippageBps<1||slippageBps>5000)fail();
 const release=getCompiledFamilyEvmRelease(releaseContext),r=getCompiledVantaFamilyProofResources(release,releaseContext).funding,
  d=r.pools.find(p=>asset==='native'?BigInt(p.asset)===0n:p.asset.toLowerCase()===(asset==='token'?release.lock.contracts.find(c=>c.name==='canonical-token')?.address.toLowerCase():asset.toLowerCase())),routes=familyBridgeRoutes(release,r.routes,operation);
 if(!routes||!d||(operation===4?![routes.nativePool,routes.usdcPool].includes(d.pool):d.pool!==routes.bnmPool))fail();
 await Promise.all([provider,verificationProvider].map(p=>verifyCompiledFamilyOperationRuntime(p,d.pool,releaseContext,operation===4?['route-gateway','route-muchfi','route-wrappeddoge','usdc-asset']:['route-gateway','route-ccip','ccip-bnm-asset'])));
 const at=await getSharedConfirmedBlock(provider,verificationProvider);
 if(operation===5)await verifyFamilyBridgeGateway({providers:[provider,verificationProvider],release,routes:r.routes,block:at});
 const read=async(to,abi,method,args)=>{
  const tx={to,data:abi.encodeFunctionData(method,args),blockTag:at.number},[a,b]=await Promise.all([provider.call(tx),verificationProvider.call(tx)]);if(a!==b)fail();return abi.decodeFunctionResult(method,a);
 };
 return async amountAtomic=>{
 if(typeof amountAtomic!=='string'||!/^[1-9][0-9]{0,36}$/u.test(amountAtomic)||BigInt(amountAtomic)>=(1n<<120n))fail();
 let result;
 if(operation===4){
  const native=d.pool===routes.nativePool,abi=new Interface(['function getAmountsOut(uint256,address[]) view returns(uint256[])']),[amounts]=await read(routes.muchFi.address,abi,'getAmountsOut',[amountAtomic,native?[routes.wrappedDoge.address,routes.usdc]:[routes.usdc,routes.wrappedDoge.address]]);
  if(amounts.length!==2||amounts[0]!==BigInt(amountAtomic)||amounts[1]<=0n)fail();
  const minimum=amounts[1]*BigInt(10000-slippageBps)/10000n;if(minimum<=0n)fail();
  result={amountOutAtomic:amounts[1].toString(),minimumOutputAtomic:minimum.toString(),maximumDeliveryFeeAtomic:'0',outputDecimals:r.pools.find(p=>p.pool===(native?routes.usdcPool:routes.nativePool)).assetDecimals};
 }else{
  const abi=new Interface(['function getFee(uint64,tuple(bytes receiver,bytes data,tuple(address token,uint256 amount)[] tokenAmounts,address feeToken,bytes extraArgs)) view returns(uint256)']),coder=AbiCoder.defaultAbiCoder(),[fee]=await read(routes.ccip.address,abi,'getFee',[routes.destination.selector,{receiver:coder.encode(['address'],[getAddress(receiver)]),data:'0x',tokenAmounts:[{token:routes.bnm,amount:amountAtomic}],feeToken:ZeroAddress,extraArgs:'0x181dcf10'+coder.encode(['uint256','bool'],[0,true]).slice(2)}]);
  const limit=BigInt(routes.maximumDeliveryFee);
  if(fee>limit)throw Object.assign(Error('Family route review: The current CCIP delivery fee exceeds the signed delivery limit.'),{code:'CCIP_DELIVERY_LIMIT'});
  // The signed ceiling limits actual delivery spend. Optional price padding
  // must not reject a live fee that still fits it. Submission checks the live
  // router fee again against this reviewed maximum before any funds move.
  const padded=fee*110n/100n+1n,maximum=padded<limit?padded:limit;
  result={amountOutAtomic:amountAtomic,minimumOutputAtomic:amountAtomic,maximumDeliveryFeeAtomic:maximum.toString(),outputDecimals:d.assetDecimals};
 }
 const [a,b]=await Promise.all([provider.getBlock(at.number),verificationProvider.getBlock(at.number)]);if(a?.hash!==at.hash||b?.hash!==at.hash)fail();return Object.freeze(result);
 };
}
export async function quoteFamilyNetRoute(input){
 return (await prepareFamilyNetRoute(input))(input.amountAtomic);
}
