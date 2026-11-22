/** One readwrite IndexedDB transaction per fresh wallet journal mutation.
 * Callers must await transaction completion before signing or broadcasting. */
const DATABASE="stealthos-vanta-fresh-deposits-v1";
const TABLE="journals";

function requestResult(request){
  return new Promise((resolve,reject)=>{
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error??Error("IndexedDB request failed."));
  });
}
function complete(transaction){
  return new Promise((resolve,reject)=>{
    transaction.oncomplete=resolve;
    transaction.onabort=()=>reject(transaction.error??Error(
      "Fresh deposit journal transaction aborted."));
    transaction.onerror=()=>reject(transaction.error??Error(
      "Fresh deposit journal transaction failed."));
  });
}
export async function createFreshIndexedDbDepositStore({indexedDB:
  factory=globalThis.indexedDB}={}){
  if(!factory||typeof factory.open!=="function")
    throw Error("A durable IndexedDB store is required for fresh deposits.");
  const opening=factory.open(DATABASE,1);
  opening.onupgradeneeded=()=>{
    if(!opening.result.objectStoreNames.contains(TABLE))
      opening.result.createObjectStore(TABLE);
  };
  const database=await new Promise((resolve,reject)=>{
    opening.onsuccess=()=>resolve(opening.result);
    opening.onerror=()=>reject(opening.error??Error(
      "Fresh deposit journal database could not open."));
    opening.onblocked=()=>reject(Error(
      "Fresh deposit journal database upgrade is blocked."));
  });
  let closed=false;
  database.onversionchange=()=>{closed=true;database.close();};
  const live=()=>{if(closed)throw Error("Fresh deposit journal database closed.");};
  return Object.freeze({
    async read(namespace){
      live();
      const transaction=database.transaction(TABLE,"readonly");
      const done=complete(transaction);
      try{
        const value=await requestResult(transaction.objectStore(TABLE)
          .get(namespace));
        await done;
        if(value===undefined)return [];
        if(!Array.isArray(value))throw Error("Fresh deposit store is corrupt.");
        return value;
      }catch(error){await done.catch(()=>{});throw error;}
    },
    async transact(namespace,update){
      live();
      if(typeof update!=="function")throw Error("Fresh deposit update is invalid.");
      // Read and write are enclosed in the SAME transaction, so two tabs
      // cannot reserve the same quote or payer nonce concurrently.
      const transaction=database.transaction(TABLE,"readwrite",{
        durability:"strict"});
      const done=complete(transaction);
      try{
        const entries=await requestResult(transaction.objectStore(TABLE)
          .get(namespace));
        if(entries!==undefined&&!Array.isArray(entries))
          throw Error("Fresh deposit store is corrupt.");
        const change=update(entries??[]);
        if(!change||!Array.isArray(change.next))
          throw Error("Fresh deposit store update is invalid.");
        await requestResult(transaction.objectStore(TABLE)
          .put(change.next,namespace));
        await done;
        return change.result;
      }catch(error){
        try{transaction.abort();}catch{}
        await done.catch(()=>{});
        throw error;
      }
    },
    close(){if(closed)return;closed=true;database.close();},
  });
}
