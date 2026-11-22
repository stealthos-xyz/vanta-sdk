import type {StealthOSPartnerConfiguration} from '../browser/partner-app.mjs';
export function createStealthOSPartnerAuthorizationService(input:{configuration:StealthOSPartnerConfiguration&{application:{origins:readonly string[];authorizationUrl:string}};
 databasePath:string;readBackup():Promise<unknown>;readPassword():Promise<string>;maximumDepositAtomic:string;maximumSessionAtomic:string;fetcher?:typeof fetch}):
 Readonly<{fetch(request:Request):Promise<Response>;close():void}>;
