// Browser entry for the hosted, no-install version (site /app).
// Same pure pipeline as the local server — analysis runs entirely in your tab.
import { analyzeWeb } from "./analyze.js";

(window as any).Churnlight = { run: analyzeWeb };
