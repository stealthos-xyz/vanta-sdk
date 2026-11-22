/** Internal receipt check; callers first authenticate the signed intent,
 * canonical receipt, registrar, calldata and registry log address. */
import {vantaPolicyPoseidon,policyHex} from './partner-policy-kzg.mjs';
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
export async function verifyFamilyPartnerPolicyChanges({prepared,changes}){
      const perAsset=Number.isInteger(prepared.assetIndex),policyCount=perAsset?6:prepared.approval.policyScope.pools.length*6;
      if(changes.length!==policyCount)throw Error("Family transaction did not update every asset policy atomically.");
      for(let index=0;index<policyCount;index++){
        const event=changes[index].args,pool=perAsset?prepared.assetIndex:Math.floor(index/6),operation=index%6,fee=prepared.approval.fees[operation];
        const id=policyHex(await vantaPolicyPoseidon([BigInt(prepared.handleId),BigInt(operation)]));
        if(!same(event.pool,prepared.approval.policyScope.pools[pool])||!same(event.partnerId,id)||
           event.version!==prepared.expectedVersions[index]||event.receiverCommitment!==prepared.approval.receiverCommitment||
           event.active!==(prepared.kind!=="revoke")||prepared.kind!=="revoke"&&
           (event.feeBps!==BigInt(fee.feeBps)||event.feeMinimum!==fee.minimumFee||event.feeMaximum!==fee.maximumFee))
          throw Error("Family partner receipt differs from its owner-authorized policy.");
        if(operation===5&&event.root!==prepared.expectedRoots[perAsset?0:pool])throw Error("Family partner KZG checkpoint differs.");
      }
}
