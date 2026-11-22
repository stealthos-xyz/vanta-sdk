import ts from 'typescript';
import {writeFileSync} from 'node:fs';
import {build} from 'esbuild';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
await build({absWorkingDir:root,entryPoints:[resolve(root,'browser/app-wallet.ts')],
 outfile:resolve(root,'browser/app-wallet.mjs'),bundle:true,packages:'external',external:['../fresh/*'],platform:'browser',format:'esm',target:'es2022',logLevel:'warning'});
await build({absWorkingDir:root,entryPoints:[resolve(root,'browser/app-wallet-worker.ts')],outfile:resolve(root,'browser/app-wallet-worker.mjs'),
 bundle:true,packages:'external',external:['../fresh/*'],platform:'browser',format:'esm',target:'es2022',conditions:['browser'],logLevel:'warning'});

// Emit the wallet contract used by downstream TypeScript. Only the API declaration is distributed.
const walletSource = resolve(root, 'browser/app-wallet.ts');
const options = {module: ts.ModuleKind.NodeNext, target: ts.ScriptTarget.ES2022, strict: true, skipLibCheck: true,
 declaration: true, emitDeclarationOnly: true, noEmitOnError: true, newLine: ts.NewLineKind.LineFeed};
const program = ts.createProgram([walletSource], options);
const result = program.emit(program.getSourceFile(walletSource), (_path, declaration) => {
  writeFileSync(resolve(root, 'browser/app-wallet.d.mts'), declaration);
});
if (result.emitSkipped) throw Error(ts.formatDiagnostics(result.diagnostics, {
  getCurrentDirectory: () => root, getCanonicalFileName: file => file, getNewLine: () => String.fromCharCode(10),
}));
