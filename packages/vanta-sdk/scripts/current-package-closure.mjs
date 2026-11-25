/** Derive the distributed current SDK graph from every public export and type. */
import ts from "typescript";
import {readFile,writeFile,stat,lstat} from "node:fs/promises";
import {dirname,resolve,relative,sep} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const pkg=JSON.parse(await readFile(resolve(root,"package.json"),"utf8"));
const {STEALTHOS_SDK_VERSION}=await import('../fresh/sdk-version.mjs');
if(STEALTHOS_SDK_VERSION!==pkg.version)throw Error('SDK runtime identity differs from package version.');
const strings=value=>typeof value==="string"?[value]:value&&typeof value==="object"?Object.values(value).flatMap(strings):[];
const queued=[...strings(pkg.exports),...strings(pkg.imports),...strings(pkg.bin)],seen=new Set();
const exists=async path=>{try{return (await stat(path)).isFile();}catch(error){if(error.code==="ENOENT")return false;throw error;}};
while(queued.length){
  let name=queued.pop().replace(/^\.\//u,"");if(seen.has(name))continue;
  let full=resolve(root,name);
  if(!await exists(full)&&name.endsWith(".js")&&await exists(full.slice(0,-3)+".ts")){name=name.slice(0,-3)+".ts";full=resolve(root,name);}
  if(!await exists(full)){for(const ext of [".ts",".d.mts",".mjs"]){if(await exists(full+ext)){name+=ext;full+=ext;break;}}}
  if(seen.has(name))continue;
  if(!full.startsWith(root+sep))throw Error("Package graph escaped root: "+name);
  // npm omits symlinked inputs even when stat() can read their targets.
  // Reject junctions before accepting an archive with missing crypto helpers.
  let parent=full;
  while(parent!==root){if((await lstat(parent)).isSymbolicLink())throw Error('Package input uses a symlink/junction: '+name);parent=dirname(parent);}
  if(!await exists(full))throw Error("Missing current package dependency: "+name);
  seen.add(name);
  if(!/\.(?:[cm]?js|[cm]?ts)$/u.test(name))continue;
  const declaration=name.endsWith(".mjs")?name.slice(0,-4)+".d.mts":name.endsWith(".js")?name.slice(0,-3)+".d.ts":null;
  if(declaration&&await exists(resolve(root,declaration)))queued.push(declaration);
  const tree=ts.createSourceFile(name,await readFile(full,"utf8"),ts.ScriptTarget.Latest,true);
  const dependency=specifier=>{
    if(specifier.startsWith("."))queued.push(relative(root,resolve(dirname(full),specifier)).replaceAll("\\","/"));
    else if(specifier.startsWith("#")){
      const targets=strings(pkg.imports?.[specifier]);
      if(!targets.length)throw Error("Unresolved package import: "+specifier);
      queued.push(...targets);
    }
  };
  const visit=node=>{
    if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier))dependency(node.moduleSpecifier.text);
    if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword&&node.arguments.length&&ts.isStringLiteral(node.arguments[0]))dependency(node.arguments[0].text);
    if(ts.isImportTypeNode(node)&&ts.isLiteralTypeNode(node.argument)&&ts.isStringLiteral(node.argument.literal))dependency(node.argument.literal.text);
    if(ts.isNewExpression(node)&&node.expression.getText(tree)==="URL"&&node.arguments?.length===2&&ts.isStringLiteral(node.arguments[0])&&node.arguments[0].text.startsWith("."))dependency(node.arguments[0].text);
    ts.forEachChild(node,visit);
  };visit(tree);
}
const documents=["README.md","PARTNER_INTEGRATION.md"];
const assets=["dist/vendor/runtime-provenance.json","dist/vendor/THIRD_PARTY_NOTICES.txt","dist/vendor/licenses"];
const files=[...new Set([...seen,...documents,...assets])].sort();
if(process.argv.includes("--write")){
  pkg.files=files;await writeFile(resolve(root,"package.json"),JSON.stringify(pkg,null,2)+"\n");
}else if(JSON.stringify([...pkg.files].sort())!==JSON.stringify(files))throw Error("Current package allowlist differs from complete export/type/import closure; regenerate after reviewing changes.");
console.log(JSON.stringify({codeFiles:[...seen].sort(),documents,assets,fileEntries:files.length}));
