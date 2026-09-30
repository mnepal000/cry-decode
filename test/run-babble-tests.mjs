/* Mechanics tests for analyzeBabble: synthetic syllable trains should rank
 * the intended talking stage first. Validates mechanics only.
 */
import { analyzeBabble } from "../cry-analysis.js";
import { synthCooing, synthCanonical, synthVariegated, synthJargon, synthCryInBabbleMode, silence, SR } from "./babble-synth.mjs";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + " " + detail); }
}

function showResult(name, r) {
  console.log("\n== " + name + " ==");
  if (!r.ok) { console.log("   not ok: " + r.reason + " | " + r.message); return; }
  console.log("   confidence: " + r.confidence);
  for (const s of r.stages) console.log(`   ${s.key}: ${s.score}`);
  console.log("   features: " + JSON.stringify(r.features));
  if (r.issues.length) console.log("   issues: " + r.issues.join(" | "));
}

console.log("--- synthetic babble stage classification ---");

let r = analyzeBabble(synthCooing(), SR);
showResult("cooing-like", r);
check("cooing ranks cooing first", r.ok && r.stages[0].key === "cooing", JSON.stringify(r.ok && r.stages.map(s => s.key)));

r = analyzeBabble(synthCanonical(), SR);
showResult("canonical-like", r);
check("canonical ranks canonical first", r.ok && r.stages[0].key === "canonical", JSON.stringify(r.ok && r.stages.map(s => s.key)));

r = analyzeBabble(synthVariegated(), SR);
showResult("variegated-like", r);
check("variegated ranks variegated first", r.ok && r.stages[0].key === "variegated", JSON.stringify(r.ok && r.stages.map(s => s.key)));

r = analyzeBabble(synthJargon(), SR);
showResult("jargon-like", r);
check("jargon ranks jargon first", r.ok && r.stages[0].key === "jargon", JSON.stringify(r.ok && r.stages.map(s => s.key)));

console.log("\n--- rejection and routing ---");

r = analyzeBabble(silence(3), SR);
check("silence rejected", !r.ok, r.ok ? "unexpectedly ok" : r.reason);

r = analyzeBabble(synthCryInBabbleMode(), SR);
showResult("cry-like in babble mode", r);
check("cry-like clip raises the cry-mode hint", r.issues.some(i => i.includes("Cry mode")), r.issues.join(" | "));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
