/** Internal KZG fee composition. Production dependencies are fixed by the
 * public factory; dependency injection here is only for isolated unit tests. */
import {isFamilyAssetSelection} from './family-funding-resources.mjs';
const FR=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const required=(condition,message)=>{if(!condition)throw Error(message);};
export function composeVantaFamilyEnhancedFeeProver({registry,proofRuntime,signal}={}){
  let disposed=false,active=false,preparations=new WeakMap();
  const live=()=>{signal?.throwIfAborted();required(!disposed,"Enhanced fee prover is disposed.");};
  const api={
    async inspectMembership({asset,basePartnerId,operation}){
      live();const {policyLookup:_privateLookup,...membership}=await registry.resolveMembership({asset,basePartnerId,operation,relation:"enhanced"});
      live();return Object.freeze(membership);
    },
    async prepare(input){
      live();required(!active,"An enhanced fee proof is already running.");
      required(input&&Object.keys(input).filter(v=>v!=="signal").sort().join()===
        ["asset","basePartnerId","operation","width","fee","partner","protocolBps"].sort().join(),"Unexpected typed fee preparation fields.");
      required(isFamilyAssetSelection(input.asset)&&[0,3].includes(input.operation)&&[8,32].includes(input.width)&&
        typeof input.basePartnerId==="bigint"&&input.basePartnerId>0n&&input.basePartnerId<FR,"Invalid typed fee scope.");
      const {signal:requestSignal,...raw}=input,snapshot=structuredClone(raw);active=true;
      try{
        requestSignal?.throwIfAborted();
        const membership=await registry.resolveMembership({asset:snapshot.asset,basePartnerId:snapshot.basePartnerId,operation:snapshot.operation,relation:"enhanced"});
        live();requestSignal?.throwIfAborted();
        const walletWitness=registry.bindEnhancedWitness({membership,fee:snapshot.fee,partner:snapshot.partner,protocolBps:snapshot.protocolBps});
        const prepared=await proofRuntime.prepareEnhancedFee({walletWitness,signal:requestSignal});live();
        preparations.set(prepared,{...snapshot,signal:requestSignal,expectedPublicSignals:[...prepared.publicSignals]});return prepared;
      }finally{active=false;}
    },
    async provePrepared({prepared}){
      const input=preparations.get(prepared);required(input,"Fee was not prepared by this local prover.");
      try{return await api.prove(input);}finally{preparations.delete(prepared);}
    },
    async prove(input){
      live();required(!active,"An enhanced fee proof is already running.");
      required(input&&typeof input==="object"&&!Array.isArray(input),"Invalid enhanced fee request.");
      const names=["asset","basePartnerId","operation","width","fee","partner","protocolBps","expectedPublicSignals"];
      required(Object.keys(input).filter(v=>v!=="signal").sort().join()===names.sort().join(),"Unexpected enhanced fee request fields.");
      const {asset,basePartnerId,operation,width,protocolBps,signal:requestSignal}=input;
      requestSignal?.throwIfAborted();
      required(isFamilyAssetSelection(asset)&&typeof basePartnerId==="bigint"&&basePartnerId>0n&&basePartnerId<FR&&
        [0,3].includes(operation)&&[8,32].includes(width)&&Number.isInteger(protocolBps)&&protocolBps>=0&&protocolBps<=10000,
        "Enhanced fee scope must be a withdrawal or public batch.");
      required(Array.isArray(input.expectedPublicSignals)&&input.expectedPublicSignals.length===41&&
        input.expectedPublicSignals.every(v=>typeof v==="string"&&/^(?:0|[1-9][0-9]*|0x[0-9a-f]+)$/u.test(v)&&BigInt(v)>=0n&&BigInt(v)<FR),
        "Enhanced KZG fee requires exactly 41 canonical field inputs.");
      const expected=Object.freeze([...input.expectedPublicSignals]);
      const fee=structuredClone(input.fee),partner=structuredClone(input.partner);
      required(partner&&typeof partner==="object"&&!Array.isArray(partner)&&!Object.hasOwn(partner,"siblings"),
        "Enhanced partner witness must use the KZG policy schema.");
      active=true;
      try{
        const membership=await registry.resolveMembership({asset,basePartnerId,operation,relation:"enhanced"});
        live();requestSignal?.throwIfAborted();
        // Exact public ordering is EnhancedFeeCircuit::public_signals. The
        // remaining signals are independently checked by the pinned prover.
        for(const [index,value] of [[0,registry.chainId],[1,membership.pool],[6,width],[7,operation],
          [26,membership.registry],[27,membership.asset],[28,membership.root],[39,protocolBps],[40,membership.policyContext]])
          required(BigInt(expected[index])===BigInt(value),"Enhanced fee public inputs differ from authenticated KZG scope.");
        const walletWitness=registry.bindEnhancedWitness({membership,fee,partner,protocolBps});
        const proof=await proofRuntime.prove({relation:"enhanced-fee-partner",width,
          request:{walletWitness,expectedPublicSignals:expected},signal:requestSignal});
        live();requestSignal?.throwIfAborted();return proof;
      }finally{active=false;}
    },
    dispose(){if(!disposed){disposed=true;preparations=new WeakMap();registry.dispose();proofRuntime.dispose();}},
  };
  return Object.freeze(api);
}
