export interface PartnerApplication {readonly name:string;readonly origins:readonly string[];readonly authorizationUrl?:string;}
export function normalizePartnerApplication(value:unknown):Readonly<PartnerApplication>;
export function partnerApplicationHash(value:unknown):string;
