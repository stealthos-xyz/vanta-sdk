export function familyBridgeRoutes<T>(release:unknown,routes:T,operation?:number):T;
export function familyBridgeRoutesForTarget<T>(release:unknown,routes:T,target:string):T;
export function verifyFamilyBridgeGateway(input:{providers:readonly unknown[];release:unknown;routes:unknown;block:{number:number;hash:string}}):Promise<void>;
