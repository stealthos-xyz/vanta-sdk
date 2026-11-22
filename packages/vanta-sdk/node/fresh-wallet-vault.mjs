/** Local phrase adapter for the fresh public SDK. Never expose through MCP. */
const WALLET_ID=/^[A-Za-z0-9_.:-]{1,128}$/u;
const GENERATION=/^0x[0-9a-f]{64}$/u;
export function createVantaFreshSqliteWalletVault({store,walletId,generationId}={}){
  if(!store||typeof store.read!=="function"||
     typeof store.transact!=="function"||
     typeof walletId!=="string"||!WALLET_ID.test(walletId)||
     !GENERATION.test(generationId)||BigInt(generationId)===0n)
    throw Error("Trusted encrypted generation-scoped fresh wallet store required.");
  // An older generation's sealed phrase is never read by this vault.
  const namespace="fresh-wallet:"+generationId+":"+walletId;
  const pendingNamespace=namespace+":onboarding";
  const phrase=rows=>{
    if(!Array.isArray(rows)||rows.length>1||
       rows.some(x=>!x||x.kind!=="phrase"||
         x.generationId!==generationId||
         typeof x.value!=="string"||x.value.length>1024))
      throw Error("Invalid sealed fresh wallet record.");
    return rows[0]?.value??null;
  };
  return Object.freeze({
    async hasRecoveryPhrase(){return phrase(await store.read(namespace))!==null;},
    async saveRecoveryPhraseLocally(value){
      if(typeof value!=="string"||value.trim().split(/\s+/u).length!==12)
        throw Error("Invalid fresh wallet recovery phrase.");
      await store.transact(namespace,rows=>{
        if(phrase(rows)!==null)throw Error("Fresh wallet already initialized.");
        return {next:[{kind:"phrase",generationId,value}],result:undefined};
      });
    },
    async loadRecoveryPhraseLocally(){
      const value=phrase(await store.read(namespace));
      if(value===null)throw Error("No sealed fresh wallet phrase.");
      return value;
    },
    async savePendingLocally(value){
      if(!value||value.schema!=="vanta-fresh-partner-pending-v1"||
         JSON.stringify(value).length>32768)
        throw Error("Invalid fresh partner pending journal.");
      await store.transact(pendingNamespace,rows=>{
        if(!Array.isArray(rows)||rows.length>1)
          throw Error("Invalid sealed fresh partner pending journal.");
        return {next:[{kind:"pending",generationId,value}],result:undefined};
      });
      if(JSON.stringify(await this.loadPendingLocally())!==JSON.stringify(value))
        throw Error("Fresh partner pending journal did not persist.");
    },
    async loadPendingLocally(){
      const rows=await store.read(pendingNamespace);
      if(!Array.isArray(rows)||rows.length>1||
         rows.some(item=>item?.kind!=="pending"||
           item.generationId!==generationId||
           item.value?.schema!=="vanta-fresh-partner-pending-v1"))
        throw Error("Invalid sealed fresh partner pending journal.");
      return rows[0]?.value??null;
    },
    async clearPendingLocally(){
      await store.transact(pendingNamespace,rows=>{
        if(!Array.isArray(rows)||rows.length>1)
          throw Error("Invalid sealed fresh partner pending journal.");
        return {next:[],result:undefined};
      });
    },
  });
}
