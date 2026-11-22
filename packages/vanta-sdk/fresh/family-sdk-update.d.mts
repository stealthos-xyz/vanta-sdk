/** Verification only; never installs or executes a proposed SDK. The archive
 * digest must come from the partner's separately approved release pin. */
export function inspectVantaFamilySdkUpdate(input:{publication:unknown;signature:string;
 approvedArchiveSha256:string;archiveBytes:Uint8Array}):Readonly<{
 version:string;archiveSha256:string;networkId:string;generationId:string;setupId:string;
 deploymentChanged:boolean;requiresExplicitPartnerUpgrade:true;automaticallyMovesFunds:false;
}>;
