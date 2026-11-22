import type {Provider,Interface} from "ethers";
export type VantaPolicyResource=Readonly<{path:string;sha256:string;bytes:number}>;
export type VantaPolicyCodePin=Readonly<{address:string;codehash:string}>;
export type VantaPartnerPolicyKzgProfile=Readonly<{
  schema:"vanta-kzg-partner-policy-table-v1";chainId:number;setupId:string;
  generationId:string;familyTag:string;genesisHash:string;tableSize:65536;
  reservedRows:32;acceptedUpdateKeyRoot:string;corpus:VantaPolicyResource;
  corpusMetadata:VantaPolicyResource;
  lookupKeys:Readonly<{combined:VantaPolicyResource;enhanced:VantaPolicyResource}>;
  verifiers:Readonly<{combined:VantaPolicyCodePin;enhanced:VantaPolicyCodePin}>;
}>;
export type VantaPolicyCorpus=Readonly<{profile:VantaPartnerPolicyKzgProfile}>;
export type VantaPolicyPoint=Readonly<{x:bigint;y:bigint}>;
export type VantaPolicyRowKey=Readonly<{a:VantaPolicyPoint;u:VantaPolicyPoint;
  aCompressed:string;uCompressed:string;siblings:readonly string[]}>;
export type VantaPolicyProvider=Pick<Provider,"getNetwork"|"getCode"|"getBlock"|"call">;
export type VantaPolicyReadContext=Readonly<{provider:VantaPolicyProvider;
  verificationProvider:VantaPolicyProvider;block:number;blockHash:string;
  profile:VantaPartnerPolicyKzgProfile}>;
export type VantaPolicyTable=Readonly<{registry:string;pool:string;asset:string;
  root:bigint;nextSlot:number;revision:bigint;commitment:VantaPolicyPoint;
  policyContext:bigint;records:readonly (readonly unknown[]|null)[];
  rows:readonly bigint[];finalizedBlock:number;finalizedBlockHash:string}>;
export type VantaPolicyLookup=Readonly<{pool:string;asset:string;checkpoint:string;
  revision:number;next_slot:number;commitment:Readonly<{x:string;y:string}>;
  policy_context:string;registry_slot:number;query_root:string;value:string;
  w1_g2:string;w2_g2:string}>;
export type VantaPolicyRecoveryRuntime=Readonly<{
  buildVantaKzgPolicyLookup(corpus:Uint8Array,stateJson:string):string|Promise<string>;
}>;
export type VantaPolicyOwnerScope=Readonly<{profile:VantaPartnerPolicyKzgProfile;
  registrar:string;registry:string;pools:readonly string[];
  checkpoints:readonly bigint[];assetIndex?:number}>;
export const POLICY_FR:bigint;
export const VANTA_POLICY_REGISTRY_ABI:Interface;
export const VANTA_POLICY_ROW_KEY_TUPLE:string;
export function validateVantaPartnerPolicyKzgProfile(value:unknown):VantaPartnerPolicyKzgProfile;
export function policyField(value:unknown,label?:string,zero?:boolean):bigint;
export function policyHex(value:bigint):string;
export function authenticateVantaPolicyCorpus(input:{profile:VantaPartnerPolicyKzgProfile;
  corpus:Uint8Array;metadata:Uint8Array}):VantaPolicyCorpus;
export function loadVantaPolicyCorpus(input:{profile:VantaPartnerPolicyKzgProfile;
  baseUrl:string;fetcher?:typeof fetch;signal?:AbortSignal}):Promise<VantaPolicyCorpus>;
export function buildVantaPolicyRowKeys(corpus:VantaPolicyCorpus,rows:readonly number[]):readonly VantaPolicyRowKey[];
export function reproduceVantaPolicyCommitment(corpus:VantaPolicyCorpus,rows:readonly bigint[]):VantaPolicyPoint;
export function applyVantaPolicyUpdates(corpus:VantaPolicyCorpus,commitment:VantaPolicyPoint,
  changes:readonly Readonly<{row:number;before:bigint;after:bigint}>[]):VantaPolicyPoint;
export function vantaPolicyCheckpoint(input:{profile:VantaPartnerPolicyKzgProfile;
  registry:string;pool:string;asset:string;revision:bigint;nextSlot:number;commitment:VantaPolicyPoint}):bigint;
export function vantaPolicyContext(input:{profile:VantaPartnerPolicyKzgProfile;
  registry:string;pool:string;asset:string;poseidon:(values:bigint[])=>Promise<bigint>}):Promise<bigint>;
export function vantaPolicyLeaf(input:{context:bigint;basePartnerId:bigint;operation:number;
  version:bigint;receiverCommitment:bigint;feeBps:number;feeMinimum:bigint;feeMaximum:bigint;
  authorizationKey:bigint;poseidon:(values:bigint[])=>Promise<bigint>}):Promise<bigint>;
export function policyReadBoth(context:VantaPolicyReadContext,to:string,abi:Interface,
  method:string,args?:readonly unknown[]):Promise<readonly unknown[]>;
export function finalizedPolicyContext(input:{provider:VantaPolicyProvider;verificationProvider:VantaPolicyProvider;
  profile:VantaPartnerPolicyKzgProfile;pins:readonly VantaPolicyCodePin[]}):Promise<VantaPolicyReadContext>;
export function assertStablePolicyContext(context:VantaPolicyReadContext):Promise<void>;
export function readVantaPolicyTable(input:{context:VantaPolicyReadContext;registry:string;pool:string;asset:string;
  corpus:VantaPolicyCorpus;poseidon:(values:bigint[])=>Promise<bigint>}):Promise<VantaPolicyTable>;
export function findVantaPolicyRecord(table:VantaPolicyTable,partnerId:string):Readonly<{
  slot:number;record:readonly unknown[]}>;
export function prepareVantaPolicyBatch(input:{context:VantaPolicyReadContext;table:VantaPolicyTable;
  corpus:VantaPolicyCorpus;basePartnerId:bigint;receiverCommitment:bigint;authorizationCommitment:bigint;
  fees:readonly Readonly<{feeBps:number;minimumFee:bigint;maximumFee:bigint}>[];
  registration?:boolean;revoke?:boolean;poseidon:(values:bigint[])=>Promise<bigint>}):Promise<Readonly<{
    keys:readonly VantaPolicyRowKey[];root:bigint;nextRoot:bigint;versions:readonly bigint[];
    commitment:VantaPolicyPoint;revision:bigint;nextSlot:number}>>;
export function buildVantaPolicyLookup(input:{table:VantaPolicyTable;slot:number;corpus:VantaPolicyCorpus;
  runtime:VantaPolicyRecoveryRuntime}):Promise<VantaPolicyLookup>;
export function vantaPolicyOwnerAction(input:VantaPolicyOwnerScope&{
  kind:"register"|"update"|"revoke";handleId:string;authorizationCommitment:bigint;
  receiverCommitment?:bigint;routingCommitment?:string;salt?:string;
  fees?:readonly Readonly<{feeBps:number;minimumFee:bigint;maximumFee:bigint}>[];
  revision?:bigint;deadline:bigint}):bigint;

export declare function vantaPolicyPoseidon(values:readonly bigint[]):Promise<bigint>;
