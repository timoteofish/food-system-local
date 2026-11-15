import "./load-env.js";
import { registerApiWorker } from "./restore-coordination.js";

await registerApiWorker();
