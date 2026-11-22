/** Canonical current-family human-readable partner handle. */
export function normalizeVantaFamilyHandle(value){
  const name=String(value??"").trim().toLowerCase();
  const handle=name.endsWith(".stealth")?name:name+".stealth";
  if(!/^[a-z0-9-]+(?:\.[a-z0-9-]+)?\.stealth$/u.test(handle))
    throw Error("Invalid family .stealth handle.");
  const labels=handle.slice(0,-8).split(".");
  if(labels.length<1||labels.length>2||
     labels.some(label=>label.length<2||label.length>32||
       label.startsWith("-")||label.endsWith("-"))||
     labels.join(".").length<3||labels.join(".").length>48)
    throw Error("Invalid family .stealth handle.");
  return handle;
}
