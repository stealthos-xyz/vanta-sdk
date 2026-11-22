import type {FamilyDepositPartnerRequest,FamilyDepositPartnerAuthorization} from "../fresh/family-deposit-host.mjs";
export interface FamilyPartnerHostGates {
 verifyOrigin(request:Request):Promise<boolean>|boolean;
 verifySession(request:Request):Promise<object|null>|object|null;
 verifyCsrf(input:{webRequest:Request;session:object}):Promise<boolean>|boolean;
 /** Must durably reserve the owner-approved exact intent and budget. */
 approveIntent(input:FamilyDepositPartnerRequest&Readonly<{session:object;intentId:string}>):
  Promise<Readonly<{approved:boolean;reservationId:string}>>;
 loadPartnerWallet(input:Readonly<{session:object;networkId:string;generationId:string;asset:string;handleId:string;reservationId:string}>):
  Promise<{signFamilyDepositQuoteAuthorization(request:FamilyDepositPartnerRequest):Promise<FamilyDepositPartnerAuthorization>;dispose():void}>;
}
export function verifyFamilyPartnerProxySecret(request:Request,expectedSecret:string):boolean;
export function createFamilyPartnerAuthorizationHandler(gates:FamilyPartnerHostGates):(request:Request)=>Promise<Response>;
