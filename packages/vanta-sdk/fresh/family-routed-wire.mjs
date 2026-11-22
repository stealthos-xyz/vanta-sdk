/** Exact public external-route ABI. Targets come only from the signed release;
 * the private-source payout remains protected by the original proof relations. */
import {Interface,AbiCoder,keccak256,toUtf8Bytes} from 'ethers';
import {FAMILY_NORMAL_QUOTE,familyNormalProofType,familyNormalAbi,familyNormalDigest} from './family-normal-wire.mjs';
import {PRIVATE_SWAP_ROUTE,privateSwapOutputAbi} from './family-private-swap-output-wire.mjs';
const coder=AbiCoder.defaultAbiCoder();
export const familyRouteAbi=routes=>routes.privateOutput?privateSwapOutputAbi:familyRoutedAbi;
export const familyRoutePredictMethod=routes=>routes.privateOutput?'predictFundingEscrow':'predictEscrow';
export const FAMILY_ROUTE='(uint8 operation,address sourcePool,address sourceAsset,address payer,address receiver,uint128 amount,uint128 minimumOutput,uint64 deadline,bytes32 nonce,uint256 maximumDeliveryFee)';
export const familyRoutedAbi=new Interface([
 ...[8,32].map(w=>`function execute${w}(${FAMILY_NORMAL_QUOTE},${familyNormalProofType(w)},bytes,${FAMILY_ROUTE}) payable`),
 `function predictEscrow(${FAMILY_ROUTE}) view returns(address)`,`function routeHash(${FAMILY_ROUTE}) view returns(bytes32)`,
 'event RoutedSettlement(bytes32 indexed quoteNonce,bytes32 indexed routeHash,address indexed sourcePool,uint8 operation,address receiver,uint256 inputAmount,uint256 outputAmount,bytes32 messageId,uint256 deliveryFee)'
]);
export function familyRouteHash(gateway,route){return keccak256(coder.encode(['bytes32','uint256','address',route.outputPool?PRIVATE_SWAP_ROUTE:FAMILY_ROUTE],
 [keccak256(toUtf8Bytes(route.outputPool?'STEALTHOS_FAMILY_PRIVATE_SWAP_ROUTE_V1':'STEALTHOS_FAMILY_CHIKYU_PUBLIC_ROUTE_V1')),6281971,gateway,route]));}
const fail=()=>{throw Error('External route differs from the signed private-source settlement.');};
export function validateFamilyRoute({routes,route,q,payer,operation}){
 if(![4,5].includes(operation)||route?.operation!==operation||route.payer!==payer||q.mode!==operation||q.relayer!==routes.gateway.address||q.chainId!==6281971||
  q.pool!==route.sourcePool||q.asset!==route.sourceAsset||q.nonce!==route.nonce||q.deadline!==route.deadline||BigInt(q.payout)!==BigInt(route.amount)||
  !/^0x[0-9a-f]{40}$/u.test(route.receiver)||BigInt(route.receiver)===0n||[route.sourcePool,routes.gateway.address,q.recipient].includes(route.receiver)||
  BigInt(route.amount)<=0n||BigInt(route.minimumOutput)<=0n||BigInt(q.relayerFeeCap)<=0n)fail();
 if(routes.privateOutput&&(!route.outputPool||!route.owner||!route.salt||operation!==4||route.outputPool!== (route.sourcePool===routes.nativePool?routes.usdcPool:routes.nativePool)))fail();
 if(operation===4){
  if(BigInt(route.maximumDeliveryFee)!==0n||!((route.sourcePool===routes.nativePool&&BigInt(route.sourceAsset)===0n)||
   (route.sourcePool===routes.usdcPool&&route.sourceAsset===routes.usdc)))fail();
 }else if(route.sourcePool!==routes.bnmPool||route.sourceAsset!==routes.bnm||BigInt(route.minimumOutput)!==BigInt(route.amount)||
  BigInt(route.maximumDeliveryFee)<=0n||BigInt(route.maximumDeliveryFee)>BigInt(routes.maximumDeliveryFee))fail();
 return route;
}
export function encodeFamilyRoutedCall({routes,route,q,payer,operation,poolCalldata}){
 validateFamilyRoute({routes,route,q,payer,operation});
 const decoded=familyNormalAbi.parseTransaction({data:poolCalldata});
 if(decoded?.name!=='settleNormalEpoch'+q.width||familyNormalDigest(decoded.args[0])!==familyNormalDigest(q))fail();
 return familyRouteAbi(routes).encodeFunctionData('execute'+q.width,[decoded.args[0],decoded.args[1],decoded.args[2],route]);
}
export function validateSavedFamilyRoutedCall({routes,route,q,payer,operation,calldata}){
 validateFamilyRoute({routes,route,q,payer,operation});
 const abi=familyRouteAbi(routes),decoded=abi.parseTransaction({data:calldata});
 if(decoded?.name!=='execute'+q.width||familyNormalDigest(decoded.args[0])!==familyNormalDigest(q)||
  familyRouteHash(routes.gateway.address,decoded.args[3])!==familyRouteHash(routes.gateway.address,route)||
  abi.encodeFunctionData(decoded.name,decoded.args)!==calldata)fail();
 return decoded;
}
