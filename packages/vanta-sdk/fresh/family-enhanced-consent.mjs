/** Exact account-relayer EIP-191 binding. This pure builder does not choose an
 * activation or request a signature. The trusted UI approves one intent. */
import {getAddress,keccak256} from "ethers";
const WORD=/^0x[0-9a-f]{64}$/u,ID=/^[A-Za-z0-9:_-]{8,128}$/u,BYTES=/^0x(?:[0-9a-f]{2})+$/u;
const fail=()=>{throw Error("Enhanced consent does not match the compiled family release.");};
export function buildVantaFamilyEnhancedConsentMessage(release,context,request,approvedIntentId){
  if(!release||!context||!request||Object.keys(request).sort().join()!=="asset,calldata,intentId,pool,requestId"||
    !ID.test(request.requestId)||!ID.test(request.intentId)||request.intentId!==approvedIntentId||
    release.schema!=="stealthos-family-sdk-release-v2"||release.setup?.family?.id!=="dogeos"||
    release.pins?.networkId!=="eip155:6281971"||release.activation?.network?.id!==release.pins.networkId||
    context.networkId!==release.pins.networkId||!WORD.test(release.setup.family.tag)||BigInt(release.setup.family.tag)===0n||
    release.setup.family.tag!==release.activation.familyTag||release.setup.family.tag!==release.lock?.familyTag||
    !WORD.test(release.pins.genesisHash)||BigInt(release.pins.genesisHash)===0n||
    release.activation.network.genesisHash!==release.pins.genesisHash||
    !WORD.test(release.pins.generationId)||BigInt(release.pins.generationId)===0n||
    release.pins.generationId!==context.generationId||!BYTES.test(request.calldata)||request.calldata.length>512*1024)fail();
  let pool,asset;
  try{
    pool=getAddress(request.pool).toLowerCase();asset=getAddress(request.asset).toLowerCase();
    if(pool!==getAddress(context.pool).toLowerCase()||asset!==getAddress(context.assetAddress).toLowerCase()||
      !release.lock.contracts.some(c=>c.kind==="pool"&&getAddress(c.address).toLowerCase()===pool))fail();
  }catch{fail();}
  return "Vanta private settlement authorization v1\n"+JSON.stringify([
    release.setup.family.tag,6281971,release.pins.genesisHash,release.pins.generationId,
    pool,asset,request.requestId,keccak256(request.calldata),
  ]);
}
