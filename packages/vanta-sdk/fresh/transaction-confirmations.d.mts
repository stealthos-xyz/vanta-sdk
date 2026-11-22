export const SDK_TRANSACTION_CONFIRMATIONS: 2;
export const SDK_SETTLEMENT_POLICY: Readonly<{mode:'confirmations';confirmations:2;consensusFinality:false}>;
export interface ConfirmedBlock {readonly number:number;readonly hash:string;readonly timestamp?:number;readonly settlement:typeof SDK_SETTLEMENT_POLICY;}
export interface ConfirmationProvider {getBlock(tag:string|number):Promise<{number:number;hash:string|null;parentHash?:string;timestamp?:number}|null>;}
export function getConfirmedBlock(provider:ConfirmationProvider):Promise<ConfirmedBlock>;
export function getSharedConfirmedBlock(provider:ConfirmationProvider,verificationProvider:ConfirmationProvider):Promise<ConfirmedBlock>;
