/** Reviewed software extension; never rewrites the frozen deployment inventory. */
import{keccak256}from'ethers';
import{canonicalFamilyProvider}from'./family-rpc.mjs';
import{FAMILY_CHIKYU_BRIDGE_GATEWAY as pin}from'./generated-family-bridge-gateway.mjs';
const fail=()=>{throw Error('Family bridge gateway: The reviewed bridge deployment differs.');};
const scoped=release=>['networkId','genesisHash','setupId','generationId','lockId'].every(k=>release?.pins?.[k]===pin[k]);
export function familyBridgeRoutes(release,routes,operation=5){
 if(operation!==5||!scoped(release))return routes;
 if(routes?.gateway?.address!==pin.previousGateway||routes.gateway.codehash!==pin.previousCodehash||routes.maximumDeliveryFee!=='30000000000000000000')fail();
 return Object.freeze({...routes,gateway:pin.gateway,maximumDeliveryFee:pin.maximumDeliveryFee});
}
/** Retain exact historical targets for saved, authorized bridge transactions. */
export function familyBridgeRoutesForTarget(release,routes,target){
 if(target===routes?.gateway?.address)return routes;
 const current=familyBridgeRoutes(release,routes);if(target!==current.gateway.address)fail();return current;
}
export async function verifyFamilyBridgeGateway({providers,release,routes,block}){
 const current=familyBridgeRoutes(release,routes);
 if(current===routes)return;
 if(!Number.isSafeInteger(block?.number)||block.number<pin.gateway.deploymentBlock||!/^0x[0-9a-f]{64}$/u.test(block.hash??''))fail();
 const sources=[...new Set(providers.map(canonicalFamilyProvider))];if(!sources.length)fail();
 await Promise.all(sources.map(async provider=>{
  if(keccak256(await provider.getCode(current.gateway.address,block.number))!==current.gateway.codehash||
   (await provider.getBlock(block.number))?.hash!==block.hash)fail();
 }));
}
