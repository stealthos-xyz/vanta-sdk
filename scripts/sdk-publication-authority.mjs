/** Owner-authorized software signing-key recovery. This is an explicitly
 * pinned trust change, not a delegation signed by the unavailable old key.
 * Ceremony, activation and deployment-lock signatures keep their old signer. */
export const CHIKYU_SOFTWARE_ADMIN_RECOVERY=Object.freeze({
 networkId:'eip155:6281971',
 genesisHash:'0xf9f7c524dce38b51a4d28ec2f18680773e5ba9d3f5f430d0e05f92cfeb65b1bc',
 setupId:'0xb4676558822d9964f45f716c27ea00f0f22f629b799dfaf61cb446db60e1ed70',
 generationId:'0x2acecbe256faf24f04b0c5ddd06a40cfa7d832677ce6e476e2eb69fa2321c7e0',
 lockId:'0x57e6d1e911046c7810dc3ae934fc85a155a4c1ba8ca6f6b09e24e8995ed961d4',
 originalAuthority:'0x1162ae2D023773aa526D63C11da14E4E40209093',
 authority:'0xD167119e077F2Af7a0d248913D5f7A0F640332B0',
 minimumVersion:'0.4.43',
});
export function familyPublicationAuthority(publication,originalAuthority){
 const r=CHIKYU_SOFTWARE_ADMIN_RECOVERY,version=/^0\.4\.(0|[1-9][0-9]*)$/u.exec(publication?.version??'');
 if(!version||!Number.isSafeInteger(Number(version[1]))||Number(version[1])<43||
  originalAuthority?.toLowerCase()!==r.originalAuthority.toLowerCase())return originalAuthority;
 const pins=publication.sdkRelease?.pins;
 if(!['networkId','genesisHash','setupId','generationId','lockId'].every(k=>publication[k]===r[k]&&pins?.[k]===r[k]))return originalAuthority;
 return r.authority;
}
