export function createEncryptedPartnerWalletLoader(input:{partnerHandle:string;handleId:string;readBackup():Promise<unknown>;readPassword():Promise<string>}):
 (input:{handleId:string;networkId:string;generationId:string})=>Promise<import('../fresh/wallet-runtime.mjs').VantaFreshPrivateWallet>;
