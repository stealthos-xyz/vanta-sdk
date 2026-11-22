/** Wallet transport only. No login, privacy-key derivation, or RPC polling. */
import {getAddress,hexlify,toUtf8Bytes} from "ethers";

const queues=new WeakMap();
const HASH=/^0x[0-9a-f]{64}$/iu;
const HEX=/^0x(?:[0-9a-f]{2})*$/iu;
const QUANTITY=/^0x(?:0|[1-9a-f][0-9a-f]*)$/iu;
const TX_KEYS=new Set(["from","to","value","data","chainId","gas","gasPrice",
  "maxFeePerGas","maxPriorityFeePerGas","nonce","type","accessList"]);
const error=(code,message,extra={})=>Object.assign(new Error(message),{code,...extra});
function chainNumber(value){
  let parsed;
  try{parsed=BigInt(value);}catch{throw error("HOST_CONTEXT_INVALID","Invalid active chain.");}
  if(parsed<1n||parsed>BigInt(Number.MAX_SAFE_INTEGER))
    throw error("HOST_CONTEXT_INVALID","Invalid active chain.");
  return Number(parsed);
}
function serial(provider,task){
  const pending=(queues.get(provider)??Promise.resolve()).then(task,task);
  queues.set(provider,pending.catch(()=>{}));
  return pending;
}
function publicTransaction(input,context){
  if(!input||typeof input!=="object"||Array.isArray(input)||
     Object.keys(input).some(key=>!TX_KEYS.has(key)))
    throw error("HOST_TRANSACTION_INVALID","Invalid public transaction fields.");
  const tx={...input};
  if(getAddress(tx.from??context.address)!==context.address||
     chainNumber(tx.chainId??context.chainId)!==context.chainId)
    throw error("HOST_CONTEXT_CHANGED","Transaction account or chain differs.");
  tx.from=context.address;tx.to=getAddress(tx.to);
  tx.chainId="0x"+context.chainId.toString(16);
  tx.value??="0x0";tx.data??="0x";
  if(!HEX.test(tx.data)||tx.data.length>2+2*1024*1024)
    throw error("HOST_TRANSACTION_INVALID","Invalid transaction calldata.");
  for(const key of ["value","gas","gasPrice","maxFeePerGas",
    "maxPriorityFeePerGas","nonce","type"]){
    if(tx[key]!==undefined&&(!QUANTITY.test(tx[key])||tx[key].length>66))
      throw error("HOST_TRANSACTION_INVALID","Transaction quantities must be bounded RPC hex quantities.");
  }
  if(tx.gasPrice!==undefined&&(tx.maxFeePerGas!==undefined||
     tx.maxPriorityFeePerGas!==undefined))
    throw error("HOST_TRANSACTION_INVALID","Conflicting transaction fee fields.");
  if(tx.accessList!==undefined){
    if(!Array.isArray(tx.accessList)||tx.accessList.length>1024)
      throw error("HOST_TRANSACTION_INVALID","Invalid transaction access list.");
    tx.accessList=tx.accessList.map(entry=>{
      if(!entry||Object.keys(entry).sort().join()!=="address,storageKeys"||
         !Array.isArray(entry.storageKeys)||entry.storageKeys.length>4096||
         !entry.storageKeys.every(key=>HASH.test(key)))
        throw error("HOST_TRANSACTION_INVALID","Invalid transaction access list.");
      return {address:getAddress(entry.address),storageKeys:[...entry.storageKeys]};
    });
  }
  return tx;
}

/** Use an already-selected standard wallet, including the official DogeOS
 * SDK's currentProvider. It never calls eth_requestAccounts or social login.
 * Snapshot checks supplement events on MyDoge builds that omit them.
 * The native host must still invalidate on lock/background/account changes.
 */
export function createEip1193HostWallet({provider,onInvalidated,
  transactionRejectionIsDefinitive=false}={}){
  if(!provider||typeof provider.request!=="function")
    throw error("HOST_PROVIDER_REQUIRED","An active EIP-1193 provider is required.");
  if(typeof transactionRejectionIsDefinitive!=="boolean")
    throw error("HOST_PROVIDER_REQUIRED","Invalid wallet error capability.");
  let revision=0,closed=false,lastIdentity=null;
  const listeners=new Set();
  if(typeof onInvalidated==="function")listeners.add(onInvalidated);
  const notify=reason=>{
    for(const listener of listeners){try{listener(reason);}catch{/* UI cannot prevent lock. */}}
  };
  function invalidate(reason="host-invalidated"){
    if(closed)return;
    revision++;notify(reason);
  }
  const events=["accountsChanged","chainChanged","disconnect"].map(name=>{
    const callback=()=>invalidate(name);
    provider.on?.(name,callback);return [name,callback];
  });
  const live=()=>{if(closed)throw error("HOST_CLOSED","Wallet adapter is closed.");};
  async function snapshot(){
    live();const started=revision;
    const first=await provider.request({method:"eth_accounts"});
    live();
    const chainId=chainNumber(await provider.request({method:"eth_chainId"}));
    live();
    const second=await provider.request({method:"eth_accounts"});
    live();
    const finalChain=chainNumber(await provider.request({method:"eth_chainId"}));
    live();
    if(started!==revision||chainId!==finalChain||!Array.isArray(first)||!Array.isArray(second)||
       !first.length||!second.length||getAddress(first[0])!==getAddress(second[0]))
      throw error("HOST_CONTEXT_CHANGED","Active wallet changed or is unavailable.");
    const address=getAddress(second[0]),identity=chainId+":"+address;
    if(lastIdentity!==null&&lastIdentity!==identity)invalidate("wallet-changed");
    lastIdentity=identity;
    return Object.freeze({address,chainId,networkId:"eip155:"+chainId,revision});
  }
  async function assertContext(expected){
    const actual=await snapshot();
    if(!expected||expected.revision!==actual.revision||
       expected.address!==actual.address||expected.chainId!==actual.chainId||
       expected.networkId!==actual.networkId)
      throw error("HOST_CONTEXT_CHANGED","Wallet context must be refreshed before approval.");
    return actual;
  }
  return Object.freeze({
    getContext:()=>serial(provider,snapshot),
    personalSign({message,context}={}){
      if(typeof message!=="string"||!message.length||toUtf8Bytes(message).length>16384)
        return Promise.reject(error("HOST_MESSAGE_INVALID","Invalid exact signing message."));
      return serial(provider,async()=>{
        await assertContext(context);
        live();if(context.revision!==revision)
          throw error("HOST_CONTEXT_CHANGED","Wallet context changed before approval.");
        let signature;
        try{signature=await provider.request({method:"personal_sign",
          params:[hexlify(toUtf8Bytes(message)),context.address]});}
        catch(reason){throw error(reason?.code===4001?"HOST_USER_REJECTED":"HOST_SIGNING_FAILED",
          reason?.code===4001?"Wallet approval was declined.":"Wallet signing failed.");}
        await assertContext(context);
        if(typeof signature!=="string"||!HEX.test(signature)||
           signature.length<4||signature.length>32770)
          throw error("HOST_SIGNATURE_INVALID","Wallet returned an invalid signature.");
        return signature;
      });
    },
    sendTransaction({transaction,context,onSubmitted}={}){
      return serial(provider,async()=>{
        await assertContext(context);
        const tx=publicTransaction(transaction,context);
        live();if(context.revision!==revision)
          throw error("HOST_CONTEXT_CHANGED","Wallet context changed before approval.");
        let hash;
        try{hash=await provider.request({method:"eth_sendTransaction",params:[tx]});}
        catch(reason){
          // MyDoge 3.1.0 also uses 4001 after approval failures. Only a
          // confirmed host guarantee can classify this as never submitted.
          if(reason?.code===4001&&transactionRejectionIsDefinitive)
            throw error("HOST_USER_REJECTED","Wallet approval was declined.");
          throw error("HOST_BROADCAST_UNCERTAIN","Reconcile the durable intent before any retry.",
            {outcomeUnknown:true});
        }
        if(!HASH.test(hash??""))throw error("HOST_BROADCAST_UNCERTAIN",
          "Wallet submission returned no valid transaction hash.",{outcomeUnknown:true});
        // Persist a known hash even if a lock/account event happened while
        // the wallet was approving. Never attribute it to the new account.
        try{await onSubmitted?.(hash);await assertContext(context);}
        catch{throw error("HOST_BROADCAST_UNCERTAIN",
          "Submission requires reconciliation in its original wallet context.",
          {outcomeUnknown:true,transactionHash:hash});}
        return hash;
      });
    },
    subscribe(listener){
      live();if(typeof listener!=="function")throw TypeError("Listener required.");
      listeners.add(listener);return ()=>listeners.delete(listener);
    },
    invalidate,
    dispose(){
      if(closed)return;closed=true;revision++;notify("disposed");
      for(const [name,callback] of events){
        try{provider.removeListener?.(name,callback);}catch{/* Still revoke the adapter. */}
      }
      listeners.clear();
    },
  });
}

/** Proposed framework-neutral native contract, implemented by the partner.
 * These are StealthOS host adapter methods, not claimed MyDoge APIs.
 * The host must bind every approval to its monotonic wallet revision.
 */
export function createNativeHostWallet({host,onInvalidated}={}){
  if(!host||["getActiveAccount","approvePersonalSign","approveTransaction",
    "subscribe"].some(method=>typeof host[method]!=="function"))
    throw error("HOST_NATIVE_INTERFACE_REQUIRED","Native wallet host interfaces are required.");
  let adapter,active=null,hostEpoch=0;
  async function read(){
    const next=await host.getActiveAccount();
    if(!next||next.locked!==false||typeof next.accountId!=="string"||
       !next.accountId.length||next.accountId.length>256||
       !Number.isSafeInteger(next.revision)||next.revision<0)
      throw error("HOST_LOCKED","Unlock the active native wallet first.");
    const value=Object.freeze({accountId:next.accountId,address:getAddress(next.address),
      chainId:chainNumber(next.chainId),revision:next.revision,locked:false});
    if(active&&JSON.stringify(active)!==JSON.stringify(value)){
      hostEpoch++;adapter?.invalidate("native-context-changed");
    }
    active=value;return value;
  }
  const provider={request({method,params}){return serial(host,async()=>{
    const expected=active,started=hostEpoch,current=await read();
    if(method==="eth_accounts")return [current.address];
    if(method==="eth_chainId")return "0x"+current.chainId.toString(16);
    if(!expected||started!==hostEpoch||JSON.stringify(expected)!==JSON.stringify(current))
      throw error("HOST_CONTEXT_CHANGED","Native wallet changed before approval.");
    if(method==="personal_sign")return host.approvePersonalSign({
      context:expected,messageHex:params[0],address:params[1]});
    if(method==="eth_sendTransaction")return host.approveTransaction({
      context:expected,transaction:params[0]});
    throw error("HOST_METHOD_UNSUPPORTED","Native wallet method is not exposed.");
  });}};
  adapter=createEip1193HostWallet({provider,onInvalidated,
    transactionRejectionIsDefinitive:host.capabilities?.transactionRejectionIsDefinitive===true});
  const unsubscribe=host.subscribe(()=>{hostEpoch++;adapter.invalidate("native-lifecycle-changed");});
  if(typeof unsubscribe!=="function"){
    adapter.dispose();throw error("HOST_NATIVE_INTERFACE_REQUIRED","Native lifecycle subscription must be disposable.");
  }
  let disposed=false;
  return Object.freeze({...adapter,dispose(){
    if(disposed)return;disposed=true;
    try{unsubscribe();}finally{adapter.dispose();}
  }});
}
