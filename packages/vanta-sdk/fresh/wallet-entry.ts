import {vantaPolicyOwnerAction,type VantaPolicyOwnerScope} from "./partner-policy-kzg.mjs";
/** Current-family wallet identity. It has no pool, chain, or artifact defaults. */
import {AbiCoder,HDNodeWallet,Interface,Wallet,concat,getAddress,getBytes,
  hexlify,keccak256,
  toUtf8Bytes} from "ethers";
import {deriveKeysFromSeed} from "../../sdk/src/crypto/keys.ts";
import {poseidonAsync} from "../../sdk/src/crypto/poseidon.ts";
import {normalizeVantaFamilyHandle as normalizeFreshHandle} from "./family-handle.mjs";
import {proveFamilyHandleClaim,proveFamilyPartnerOwner}
  from "./partner-credential-prover.mjs";
import {getFamilyBootstrapCredentialContext} from "./bootstrap-credential-scope.mjs";
export {createFamilyBootstrapCredentialScope} from "./bootstrap-credential-scope.mjs";

import {getCompiledFamilyEvmRelease,isFamilyWithdrawalOnlyContext,type FamilyReleaseContext} from "./family-network.mjs";
import {getCompiledVantaFamilyProofResources} from "./family-proof-resources.mjs";
import {selectVantaFamilyFundingResources} from "./family-funding-resources.mjs";
import {signFamilyDepositPartnerAuthorization} from "./family-deposit-partner-auth.mjs";
import {partnerAssetConfigurationDigest} from './family-partner-app-config-core.mjs';
function familyWalletScope(releaseContext?:FamilyReleaseContext){
  const release=getCompiledFamilyEvmRelease(releaseContext),inventory=getCompiledVantaFamilyProofResources(release,releaseContext);
  const role=(name:string)=>{
    const rows=release.lock.contracts.filter((row:{name:string})=>row.name===name);
    if(rows.length!==1)throw Error("Compiled family wallet role is missing or duplicated.");
    return rows[0].address as string;
  };
  return {profile:inventory.partnerPolicyKzg,handleRegistry:role("handle-registry"),
    registrar:role("partner-registrar"),registry:role("partner-registry"),pools:inventory.funding.pools.map((p:{pool:string})=>getAddress(p.pool))};
}

const ROOT_DOMAIN="StealthOS Vanta V8 partner root v1";
const AUTH_PATH="m/44'/60'/0'/0/7";
const AUTH_SALT_DOMAIN="STEALTHOS_VANTA_V8_PARTNER_SIGNER_SALT_V1";
const RECEIVER_SALT_DOMAIN="STEALTHOS_VANTA_V8_RECEIVER_SALT_V2";
const RECORD_SALT_DOMAIN="STEALTHOS_VANTA_V8_PARTNER_RECORD_SALT_V1";
const OWNER_DOMAIN="stealthos-vanta-v8-handle-owner-v1";
const RELAY_DOMAIN="STEALTHOS_VANTA_V8_HANDLE_RELAY_V1";
const RECORD_DOMAIN=keccak256(toUtf8Bytes("VANTA_PARTNER_HANDLE_BINDING_V3"));
const ROUTE_DOMAIN=keccak256(toUtf8Bytes("VANTA_PRIVATE_RECEIVING_ROUTE_V2"));
const COLLECTOR_ROLE_DOMAIN=keccak256(toUtf8Bytes("VANTA_FEE_COLLECTOR_ROLE_ACTIVATE_V1"));
const BOOTSTRAP_IDENTITIES=["protocol","relayer"] as const;
const SCOPE=0x565243563201n;
const coder=AbiCoder.defaultAbiCoder();
const handleAbi=new Interface([
  "function registerAnonymous(bytes32,bytes32,bytes32,uint256[8],bytes32,uint64)",
]);
const collectorAbi=new Interface([
  "function activateFeeCollector(address,uint8,bytes32,uint256,uint256,uint256,bytes32,bytes32,uint64,uint256[8],uint256)",
]);
const FR=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const FQ=21888242871839275222246405745257275088696311157297823662689037894645226208583n;
const h32=(value:bigint)=>"0x"+value.toString(16).padStart(64,"0");
const validProof=(proof:readonly bigint[])=>Array.isArray(proof)&&
  proof.length===8&&proof.every(x=>typeof x==="bigint"&&x>=0n&&x<FQ);
export class VantaFreshPrivateWallet {
  #root:Uint8Array;
  #quoteKey:Uint8Array;
  #signingSalt:bigint;
  #receiverSalt:bigint;
  private constructor(root:Uint8Array,quoteKey:Uint8Array,
    signingSalt:bigint,receiverSalt:bigint){
    this.#root=root;this.#quoteKey=quoteKey;
    this.#signingSalt=signingSalt;this.#receiverSalt=receiverSalt;
  }
  static async create():Promise<Readonly<{
    wallet:VantaFreshPrivateWallet;recoveryPhrase:string;
  }>>{
    const temporary=HDNodeWallet.createRandom();
    const phrase=temporary.mnemonic?.phrase;
    if(!phrase||phrase.trim().split(/\s+/u).length!==12)
      throw Error("Unable to create fresh wallet recovery phrase.");
    return Object.freeze({wallet:await this.restore(phrase),recoveryPhrase:phrase});
  }
  static async restore(phrase:string):Promise<VantaFreshPrivateWallet>{
    if(typeof phrase!=="string"||phrase.trim().split(/\s+/u).length!==12)
      throw Error("Enter the twelve-word wallet recovery phrase.");
    const signer=HDNodeWallet.fromPhrase(phrase.trim(),undefined,AUTH_PATH);
    const seed=signer.mnemonic?.computeSeed();
    if(!seed)throw Error("Invalid wallet recovery phrase.");
    const root=getBytes(keccak256(concat([toUtf8Bytes(ROOT_DOMAIN),
      getBytes(seed)])));
    if(root.length!==32||!root.some(x=>x!==0))
      throw Error("Invalid fresh wallet root.");
    const signingSalt=BigInt(keccak256(AbiCoder.defaultAbiCoder().encode(
      ["string","bytes32"],[AUTH_SALT_DOMAIN,hexlify(root)])))%FR;
    if(signingSalt===0n)throw Error("Invalid fresh partner signing salt.");
    const receiverSalt=BigInt(keccak256(coder.encode(
      ["string","bytes32"],[RECEIVER_SALT_DOMAIN,hexlify(root)])))%FR;
    if(receiverSalt===0n)throw Error("Invalid fresh receiver salt.");
    return new VantaFreshPrivateWallet(root,getBytes(signer.privateKey),
      signingSalt,receiverSalt);
  }
  async privateWalletKeys(){
    if(this.#root.length!==32||!this.#root.some(x=>x!==0))
      throw Error("Fresh wallet is locked.");
    return deriveKeysFromSeed(this.#root);
  }
  async publicReceivingIdentity(){
    const keys=await this.privateWalletKeys();
    return Object.freeze({masterPublicKey:keys.masterPublicKey,
      viewingPublicKey:new Uint8Array(keys.viewingPublicKey)});
  }
  /** Public constructor commitments for an operator's local bootstrap wallet.
   * Recovery material, MPK, receiver salt and quote signer remain local. */
  async publicBootstrapIdentity(){
    this.#requireWallet();
    const keys=await this.privateWalletKeys();
    const authorizationCommitment=BigInt(await poseidonAsync([
      BigInt(new Wallet(hexlify(this.#quoteKey)).address),this.#signingSalt]));
    const proofCommitment=BigInt(await poseidonAsync([BigInt(keys.masterPublicKey),this.#receiverSalt]));
    if([authorizationCommitment,proofCommitment].some(value=>value<=0n||value>=FR))
      throw Error('Invalid public bootstrap wallet commitments.');
    return Object.freeze({authorizationCommitment,proofCommitment});
  }
  #requireWallet(){
    if(this.#root.length!==32||!this.#root.some(x=>x!==0)||
       this.#quoteKey.length!==32||!this.#quoteKey.some(x=>x!==0))
      throw Error("Fresh partner wallet is locked.");
  }
  #handleSecret(handle:string,registry:string,chainId:bigint){
    this.#requireWallet();
    const hsk=BigInt(keccak256(coder.encode(
      ["string","uint256","address","bytes32","string"],
      [OWNER_DOMAIN,chainId,registry,hexlify(this.#root),handle])))%FR;
    if(hsk===0n)throw Error("Invalid fresh handle secret.");
    return hsk;
  }
  async #partnerIdentity(handleInput:string,registryInput:string,chainId:bigint){
    this.#requireWallet();
    const handle=normalizeFreshHandle(handleInput),
      registry=getAddress(registryInput);
    if(registry==="0x0000000000000000000000000000000000000000")
      throw Error("Fresh receiving route requires the compiled handle registry.");
    const handleId=h32(BigInt(await poseidonAsync([
      BigInt(keccak256(toUtf8Bytes(handle))),chainId])));
    const signer=new Wallet(hexlify(this.#quoteKey));
    const authorizationCommitment=BigInt(await poseidonAsync([
      BigInt(signer.address),this.#signingSalt]));
    const keys=await this.privateWalletKeys();
    const mpk=BigInt(keys.masterPublicKey);
    if(mpk<=0n||mpk>=FR||authorizationCommitment<=0n||
       authorizationCommitment>=FR)throw Error("Invalid fresh partner identity.");
    const scope=BigInt(await poseidonAsync([BigInt(handleId),SCOPE]));
    const receiverCommitment=BigInt(await poseidonAsync([
      mpk,this.#receiverSalt,scope]));
    const viewingPublicKey=hexlify(keys.viewingPublicKey).toLowerCase();
    const routingCommitment=keccak256(coder.encode([
      "bytes32","uint256","address","bytes32","uint256","bytes32",
      "bytes32","uint256"],[ROUTE_DOMAIN,chainId,registry,handleId,mpk,
      viewingPublicKey,h32(this.#receiverSalt),receiverCommitment])).toLowerCase();
    return {handle,handleId,registry,signerAddress:signer.address,
      authorizationCommitment,receiverCommitment,routingCommitment,
      collectorMpk:mpk,viewingPublicKey,hsk:this.#handleSecret(handle,registry,chainId)};
  }
  async #preparePartnerHandleClaim({handle,registry,artifactBaseUrl,fetcher,signal,chainId,prove,bootstrapIdentity,releaseContext}:{
    handle:string;registry:string;artifactBaseUrl:string;chainId:bigint;
    fetcher?:typeof fetch;signal?:AbortSignal;
    prove:typeof proveFamilyHandleClaim;
    bootstrapIdentity?:typeof BOOTSTRAP_IDENTITIES[number];releaseContext?:FamilyReleaseContext;
  }){
    const identity=await this.#partnerIdentity(handle,registry,chainId);
    if(bootstrapIdentity!==undefined&&(!BOOTSTRAP_IDENTITIES.includes(bootstrapIdentity)||
       identity.handle!==bootstrapIdentity+".stealth"))
      throw Error("Invalid bootstrap infrastructure identity.");
    if(bootstrapIdentity===undefined&&["protocol.stealth","relayer.stealth"].includes(identity.handle))
      throw Error("Bootstrap fee handles cannot be claimed by partner onboarding.");
    const salt=keccak256(coder.encode([
      "string","uint256","address","bytes32","string"],
      [RECORD_SALT_DOMAIN,chainId,identity.registry,
        hexlify(this.#root),identity.handle]));
    const labelHash=keccak256(toUtf8Bytes(identity.handle));
    const recordHash=keccak256(coder.encode([
      "bytes32","uint256","address","bytes32","uint256",
      "uint256","bytes32","bytes32"],[RECORD_DOMAIN,chainId,
      identity.registry,identity.handleId,identity.authorizationCommitment,
      identity.receiverCommitment,identity.routingCommitment,salt]));
    const recordCommitment=h32(BigInt(await poseidonAsync([
      BigInt(recordHash),1n,chainId])));
    const ownerCommitment=h32(BigInt(await poseidonAsync([
      identity.hsk,BigInt(identity.handleId),chainId])));
    const nullifier=h32(BigInt(await poseidonAsync([
      identity.hsk,BigInt(identity.handleId),1n,1n,chainId])));
    const proof=await prove({chainId:Number(chainId),epoch:1,
      handleId:identity.handleId,handleLabelHash:labelHash,recordHash,
      recordCommitment,ownerCommitment,nullifier,hsk:h32(identity.hsk)},
    {artifactBaseUrl,fetcher,signal,releaseContext});
    if(!validProof(proof))throw Error("Fresh handle proof is malformed.");
    const calldata=handleAbi.encodeFunctionData("registerAnonymous",[
      identity.handleId,recordCommitment,ownerCommitment,proof,nullifier,1]);
    const settlementNonce=keccak256(coder.encode([
      "string","uint256","address","bytes32"],[RELAY_DOMAIN,chainId,
      identity.registry,keccak256(calldata)])).toLowerCase();
    return Object.freeze({handle:identity.handle,handleId:identity.handleId,
      registry:identity.registry,recordHash,recordCommitment,
      ownerCommitment,nullifier,
      authorizationCommitment:identity.authorizationCommitment,
      receiverCommitment:identity.receiverCommitment,
      routingCommitment:identity.routingCommitment,salt,calldata,
      settlementNonce});
  }
  /** Reconstruct public handle ownership from recovery keys without proving,
   * signing, or contacting a service. The caller must authenticate it on chain. */
  async exportFamilyHandleBinding({handle,releaseContext}:{handle:string;releaseContext?:FamilyReleaseContext}){
    const scope=familyWalletScope(releaseContext),chainId=BigInt(scope.profile.chainId);
    const identity=await this.#partnerIdentity(handle,scope.handleRegistry,chainId);
    const salt=keccak256(coder.encode(["string","uint256","address","bytes32","string"],
      [RECORD_SALT_DOMAIN,chainId,identity.registry,hexlify(this.#root),identity.handle]));
    const recordHash=keccak256(coder.encode(["bytes32","uint256","address","bytes32","uint256","uint256","bytes32","bytes32"],
      [RECORD_DOMAIN,chainId,identity.registry,identity.handleId,identity.authorizationCommitment,identity.receiverCommitment,identity.routingCommitment,salt]));
    return Object.freeze({authorizationCommitment:h32(identity.authorizationCommitment),salt,
      ownerCommitment:h32(BigInt(await poseidonAsync([identity.hsk,BigInt(identity.handleId),chainId]))),
      recordCommitment:h32(BigInt(await poseidonAsync([BigInt(recordHash),1n,chainId])))});
  }
  async exportFamilyPartnerReceivingRoute({handle,releaseContext}:{handle:string;releaseContext?:FamilyReleaseContext}){
    const scope=familyWalletScope(releaseContext);
    const identity=await this.#partnerIdentity(handle,scope.handleRegistry,BigInt(scope.profile.chainId));
    return Object.freeze({schema:"vanta-family-private-route-v1",chainId:scope.profile.chainId,
      familyTag:scope.profile.familyTag,generationId:scope.profile.generationId,
      registry:identity.registry,handle:identity.handle,handleId:identity.handleId,
      receiverCommitment:h32(identity.receiverCommitment),routingCommitment:identity.routingCommitment,
      collectorMpk:h32(identity.collectorMpk),viewingPublicKey:identity.viewingPublicKey,
      receiverSalt:h32(this.#receiverSalt)});
  }
  /** Public receiving data only; the bootstrap's exact credential capability
   * selects the new generation before a sealed SDK exists. */
  async exportFamilyBootstrapReceivingRoute({identity:role,credentialScope}:{identity:"protocol"|"relayer";credentialScope:unknown}){
    if(!BOOTSTRAP_IDENTITIES.includes(role))throw Error("Unknown bootstrap identity.");
    const scope=getFamilyBootstrapCredentialContext(credentialScope),identity=await this.#partnerIdentity(role+".stealth",scope.handleRegistry,BigInt(scope.chainId));
    return Object.freeze({schema:"vanta-family-private-route-v1",chainId:scope.chainId,familyTag:scope.familyTag,generationId:scope.generationId,
      registry:identity.registry,handle:identity.handle,handleId:identity.handleId,receiverCommitment:h32(identity.receiverCommitment),
      routingCommitment:identity.routingCommitment,collectorMpk:h32(identity.collectorMpk),viewingPublicKey:identity.viewingPublicKey,receiverSalt:h32(this.#receiverSalt)});
  }
  async prepareFamilyPartnerHandleClaim(input:{handle:string;artifactBaseUrl:string;releaseContext?:FamilyReleaseContext;
    fetcher?:typeof fetch;signal?:AbortSignal;}){
    if(isFamilyWithdrawalOnlyContext(input.releaseContext))throw Error("Historical generations cannot register new partners.");
    const scope=familyWalletScope(input.releaseContext);
    return this.#preparePartnerHandleClaim({...input,registry:scope.handleRegistry,
      chainId:BigInt(scope.profile.chainId),prove:proveFamilyHandleClaim,bootstrapIdentity:undefined});
  }
  /** Bootstrap uses the same actual credential relation, never an admin bypass.
   * The two returned claims are submitted in one namespace-factory CREATE. */
  async prepareFamilyBootstrapHandleClaim(input:{identity:typeof BOOTSTRAP_IDENTITIES[number];
    credentialScope:object;artifactBaseUrl:string;fetcher?:typeof fetch;signal?:AbortSignal;}){
    if(!BOOTSTRAP_IDENTITIES.includes(input.identity))throw Error("Unknown bootstrap identity.");
    const scope=getFamilyBootstrapCredentialContext(input.credentialScope);
    return this.#preparePartnerHandleClaim({handle:input.identity+".stealth",registry:scope.handleRegistry,
      chainId:BigInt(scope.chainId),prove:(witness:any,options:any)=>proveFamilyHandleClaim(witness,
        {...options,credentialScope:input.credentialScope}),bootstrapIdentity:input.identity,
      artifactBaseUrl:input.artifactBaseUrl,fetcher:input.fetcher,signal:input.signal});
  }
  /** Prepare one genuine owner proof for one infrastructure role on one pool. */
  async prepareFamilyBootstrapCollector(input:{identity:typeof BOOTSTRAP_IDENTITIES[number];
    credentialScope:object;pool:string;deadline:bigint;artifactBaseUrl:string;fetcher?:typeof fetch;signal?:AbortSignal;}){
    const role=input.identity==="protocol"?0:input.identity==="relayer"?2:-1;
    if(role<0)throw Error("Unknown bootstrap collector role.");
    const scope=getFamilyBootstrapCredentialContext(input.credentialScope),
      chainId=BigInt(scope.chainId),pool=getAddress(input.pool);
    if(!scope.pools.includes(pool))
      throw Error("Bootstrap collector pool is outside the compiled generation.");
    const now=BigInt(Math.floor(Date.now()/1000));
    if(input.deadline<=now||input.deadline>now+3600n)throw Error("Collector proof must expire within one hour.");
    const identity=await this.#partnerIdentity(input.identity+".stealth",scope.handleRegistry,chainId);
    const salt=keccak256(coder.encode(["string","uint256","address","bytes32","string"],
      [RECORD_SALT_DOMAIN,chainId,identity.registry,hexlify(this.#root),identity.handle]));
    const ownerCommitment=h32(BigInt(await poseidonAsync([identity.hsk,BigInt(identity.handleId),chainId])));
    const keys=await this.privateWalletKeys(),proofCommitment=BigInt(await poseidonAsync([
      BigInt(keys.masterPublicKey),this.#receiverSalt]));
    if(proofCommitment<=0n||proofCommitment>=FR)throw Error("Invalid collector proof commitment.");
    const actionDigest=BigInt(keccak256(coder.encode([
      "bytes32","uint256","address","bytes32","bytes32","bytes32","address","uint8",
      "bytes32","uint256","uint256","uint256","bytes32","bytes32","uint64"],
      [COLLECTOR_ROLE_DOMAIN,chainId,scope.registrar,scope.setupId,scope.generationId,
        scope.genesisHash,pool,role,identity.handleId,identity.authorizationCommitment,
        identity.receiverCommitment,proofCommitment,identity.routingCommitment,salt,input.deadline])))%FR;
    const authorizationNullifier=BigInt(await poseidonAsync([identity.hsk,actionDigest]));
    const ownershipProof=await proveFamilyPartnerOwner({chainId:Number(chainId),familyTag:scope.familyTag,
      handleId:identity.handleId,ownerCommitment,authorizationCommitment:h32(identity.authorizationCommitment),
      actionDigest:h32(actionDigest),authorizationNullifier:h32(authorizationNullifier),hsk:h32(identity.hsk),
      signingAddress:h32(BigInt(identity.signerAddress)),signingSalt:h32(this.#signingSalt)},
      {credentialScope:input.credentialScope,artifactBaseUrl:input.artifactBaseUrl,fetcher:input.fetcher,signal:input.signal});
    if(!validProof(ownershipProof))throw Error("Bootstrap collector owner proof is malformed.");
    const calldata=collectorAbi.encodeFunctionData("activateFeeCollector",[pool,role,identity.handleId,
      identity.authorizationCommitment,identity.receiverCommitment,proofCommitment,identity.routingCommitment,
      salt,input.deadline,ownershipProof,authorizationNullifier]);
    return Object.freeze({identity:input.identity,pool,role,handle:identity.handle,handleId:identity.handleId,
      ownerCommitment,authorizationCommitment:identity.authorizationCommitment,
      receiverCommitment:identity.receiverCommitment,proofCommitment,routingCommitment:identity.routingCommitment,
      salt,deadline:input.deadline,actionDigest,authorizationNullifier,ownershipProof,
      to:scope.registrar,calldata});
  }
  async approveFamilyPartnerAction(input:{kind:"register"|"update"|"revoke";handle:string;
    claim?:Record<string,any>;fees:readonly Readonly<{feeBps:number;minimumFee:bigint;maximumFee:bigint}>[];
    revision?:bigint;deadline:bigint;policyScope:VantaPolicyOwnerScope;
    artifactBaseUrl:string;fetcher?:typeof fetch;signal?:AbortSignal;releaseContext?:FamilyReleaseContext;}){
    if(isFamilyWithdrawalOnlyContext(input.releaseContext))throw Error("Historical generations cannot change partner policies.");
    const pinned=familyWalletScope(input.releaseContext),scope=input.policyScope;
    if(JSON.stringify(scope.profile)!==JSON.stringify(pinned.profile)||
       getAddress(scope.registrar)!==getAddress(pinned.registrar)||
       getAddress(scope.registry)!==getAddress(pinned.registry)||!Array.isArray(scope.pools)||scope.pools.length!==pinned.pools.length||
       scope.pools.some((pool,index)=>getAddress(pool)!==pinned.pools[index])||scope.checkpoints.length!==pinned.pools.length)
      throw Error("Family owner authorization differs from the compiled policy generation.");
    const identity=await this.#partnerIdentity(input.handle,pinned.handleRegistry,BigInt(pinned.profile.chainId));
    const ownerCommitment=h32(await poseidonAsync([identity.hsk,BigInt(identity.handleId),BigInt(pinned.profile.chainId)]));
    const claim=input.claim;
    if(input.kind==="register"&&(!claim||claim.handleId!==identity.handleId||
       claim.ownerCommitment!==ownerCommitment||claim.authorizationCommitment!==identity.authorizationCommitment||
       claim.receiverCommitment!==identity.receiverCommitment||claim.routingCommitment!==identity.routingCommitment))
      throw Error("Family partner claim belongs to another private wallet.");
    const now=BigInt(Math.floor(Date.now()/1000));
    if(input.deadline<=now||input.deadline>now+3600n)
      throw Error("Family owner authorization must expire within one hour.");
    const actionDigest=vantaPolicyOwnerAction({...scope,kind:input.kind,handleId:identity.handleId,
      authorizationCommitment:identity.authorizationCommitment,receiverCommitment:identity.receiverCommitment,
      routingCommitment:identity.routingCommitment,salt:claim?.salt,fees:input.fees,assetIndex:scope.assetIndex,
      revision:input.revision,deadline:input.deadline});
    const authorizationNullifier=await poseidonAsync([identity.hsk,actionDigest]);
    const ownershipProof=await proveFamilyPartnerOwner({chainId:pinned.profile.chainId,
      familyTag:pinned.profile.familyTag,handleId:identity.handleId,ownerCommitment,
      authorizationCommitment:h32(identity.authorizationCommitment),actionDigest:h32(actionDigest),
      authorizationNullifier:h32(authorizationNullifier),hsk:h32(identity.hsk),
      signingAddress:h32(BigInt(identity.signerAddress)),signingSalt:h32(this.#signingSalt)},
    {artifactBaseUrl:input.artifactBaseUrl,fetcher:input.fetcher,signal:input.signal,releaseContext:input.releaseContext});
    if(!validProof(ownershipProof))throw Error("Family private owner proof is malformed.");
    return Object.freeze({kind:input.kind,handle:identity.handle,handleId:identity.handleId,ownerCommitment,
      authorizationCommitment:identity.authorizationCommitment,receiverCommitment:identity.receiverCommitment,
      routingCommitment:identity.routingCommitment,salt:claim?.salt,fees:input.fees,assetIndex:scope.assetIndex,
      revision:input.revision,deadline:input.deadline,actionDigest,authorizationNullifier,ownershipProof,policyScope:scope});
  }
  /** Authorize app visibility without an on-chain transaction. The same
   * seven-input owner relation is reused, with a distinct action domain. */
  async approveFamilyPartnerAssetConfiguration(input:{handle:string;visibleAssets:readonly string[];app?:import('./family-partner-app-config.mjs').PartnerApplication;revision:bigint;deadline:bigint;
    artifactBaseUrl:string;fetcher?:typeof fetch;signal?:AbortSignal;releaseContext?:FamilyReleaseContext}){
    if(isFamilyWithdrawalOnlyContext(input.releaseContext))throw Error("Historical generations cannot change app settings.");
    const scope=familyWalletScope(input.releaseContext),release=getCompiledFamilyEvmRelease(input.releaseContext),inventory=getCompiledVantaFamilyProofResources(release,input.releaseContext);
    const identity=await this.#partnerIdentity(input.handle,scope.handleRegistry,BigInt(scope.profile.chainId));
    const all=inventory.funding.pools.map((p:{asset:string})=>getAddress(p.asset).toLowerCase()),selected=input.visibleAssets.map(p=>getAddress(p).toLowerCase());
    if(new Set(selected).size!==selected.length||selected.some(p=>!all.includes(p)))throw Error('Select assets from the signed SDK inventory.');
    const now=BigInt(Math.floor(Date.now()/1000));if(input.deadline<=now||input.deadline>now+3600n)throw Error('Configuration approval must expire within one hour.');
    const configuration={schema:input.app?'stealthos-partner-app-assets-v2':'stealthos-partner-app-assets-v1',...(input.app?{app:input.app}:{}),networkId:release.pins.networkId,setupId:release.pins.setupId,
      generationId:release.pins.generationId,genesisHash:release.pins.genesisHash,registrar:scope.registrar,
      handle:identity.handle,handleId:identity.handleId,visibleAssets:all.filter((p:string)=>selected.includes(p)),revision:input.revision.toString(),deadline:Number(input.deadline)};
    const ownerCommitment=h32(await poseidonAsync([identity.hsk,BigInt(identity.handleId),BigInt(scope.profile.chainId)]));
    const actionDigest=partnerAssetConfigurationDigest(configuration,identity.authorizationCommitment),authorizationNullifier=await poseidonAsync([identity.hsk,actionDigest]);
    const ownershipProof=await proveFamilyPartnerOwner({chainId:scope.profile.chainId,familyTag:scope.profile.familyTag,
      handleId:identity.handleId,ownerCommitment,authorizationCommitment:h32(identity.authorizationCommitment),actionDigest:h32(actionDigest),
      authorizationNullifier:h32(authorizationNullifier),hsk:h32(identity.hsk),signingAddress:h32(BigInt(identity.signerAddress)),signingSalt:h32(this.#signingSalt)},
      {artifactBaseUrl:input.artifactBaseUrl,fetcher:input.fetcher,signal:input.signal,releaseContext:input.releaseContext});
    if(!validProof(ownershipProof))throw Error('Private configuration ownership proof is malformed.');
    return Object.freeze({configuration,ownerCommitment,authorizationCommitment:h32(identity.authorizationCommitment),
      actionDigest:h32(actionDigest),authorizationNullifier:h32(authorizationNullifier),ownershipProof:Object.freeze(ownershipProof.map((p:bigint)=>h32(p)))});
  }
  /** Authorize exactly one deposit under the app's current operation policy. */
  async signFamilyDepositQuoteAuthorization(input:{
    networkId:string;generationId:string;asset:string;handleId:string;request:Record<string,unknown>;
    deadline?:number;requestNonce?:string;
  }){
    this.#requireWallet();
    const release=getCompiledFamilyEvmRelease(),inventory=getCompiledVantaFamilyProofResources(release);
    if(input.networkId!==release.pins.networkId||input.generationId!==release.pins.generationId)
      throw Error("Partner deposit request differs from the compiled activation.");
    const pools=inventory.funding.pools.filter((p:{assetSymbol:string})=>p.assetSymbol===input.asset);
    if(pools.length!==1)throw Error("Partner deposit asset is not uniquely signed.");
    const asset=BigInt(pools[0].asset)===0n?"native":pools[0].asset;
    const resources=selectVantaFamilyFundingResources(release,inventory,asset);
    return signFamilyDepositPartnerAuthorization({release,resources,asset,handleId:input.handleId,
      request:input.request,signer:new Wallet(hexlify(this.#quoteKey)),signerSalt:this.#signingSalt,
      deadline:input.deadline??Math.floor(Date.now()/1000)+120,requestNonce:input.requestNonce});
  }
  dispose(){this.#root.fill(0);this.#quoteKey.fill(0);
    this.#signingSalt=0n;this.#receiverSalt=0n;}
}
export const createVantaFreshPrivateWallet=()=>VantaFreshPrivateWallet.create();
export const restoreVantaFreshPrivateWallet=(phrase:string)=>
  VantaFreshPrivateWallet.restore(phrase);
