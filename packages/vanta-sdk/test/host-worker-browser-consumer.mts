import {createVantaHostWorker} from "../fresh/host-worker.mjs";
import type {VantaHostContext, VantaLocalWorker} from "../fresh/host-worker.mjs";

// Compile with --lib ES2022,DOM: an ordinary browser Worker must remain
// structurally assignable without a wrapper or framework dependency.
declare const context: VantaHostContext;
declare const browserWorker: Worker;
const transport: VantaLocalWorker = browserWorker;
const controller = createVantaHostWorker({createWorker: () => transport, context});
void controller.start();
