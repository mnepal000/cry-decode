/* Node test harness for cry-analysis.js mechanics.
 * Synthesizes idealized cry-like signals and checks that the analysis
 * runs without crashing and ranks the intended category first.
 * This validates MECHANICS only, not real-world accuracy.
 */
import { analyzeCry, _internals } from "../cry-analysis.js";
import { synthCry, SR } from "./synth.mjs";



let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + " " + detail); }
}

function showResult(name, r) {
  console.log("\n== " + name + " ==");
  if (!r.ok) { console.log("   not ok: " + r.reason + " | " + r.message); return; }
  console.log("   confidence: " + r.confidence);
  for (const res of r.results) console.log(`   ${res.key}: ${res.score}`);
  console.log("   features: " + JSON.stringify(r.features));
  if (r.redFlags.length) console.log("   RED FLAGS: " + r.redFlags.join(" | "));
  if (r.issues.length) console.log("   issues: " + r.issues.join(" | "));
}

console.log("--- synthetic cry classification ---");

let r = analyzeCry(synthCry({ f0: 440, bouts: 5, boutDur: 0.7, gapDur: 0.5, jitter: 0.01, ampGrowth: 0.14 }), SR);
showResult("hunger-like", r);
check("hunger-like ranks hungry first", r.ok && r.results[0].key === "hungry", JSON.stringify((r.results||[]).map(x => x.key)));

r = analyzeCry(synthCry({ f0: 720, bouts: 2, boutDur: 2.2, gapDur: 0.6, jitter: 0.05, attack: 0.03 }), SR);
showResult("pain-like", r);
check("pain-like ranks pain first", r.ok && r.results[0].key === "pain", JSON.stringify((r.results||[]).map(x => x.key)));

r = analyzeCry(synthCry({ f0: 400, f0End: 280, bouts: 3, boutDur: 1.3, gapDur: 0.7, jitter: 0.015, ampGrowth: -0.12 }), SR);
showResult("tired-like", r);
check("tired-like ranks tired first", r.ok && r.results[0].key === "tired", JSON.stringify((r.results||[]).map(x => x.key)));

r = analyzeCry(synthCry({ f0: 450, bouts: 5, boutDur: 0.3, gapDur: 0.4, jitter: 0.01 }), SR);
showResult("burp-like", r);
check("burp-like ranks burp first", r.ok && r.results[0].key === "burp", JSON.stringify((r.results||[]).map(x => x.key)));

r = analyzeCry(synthCry({ f0: 500, bouts: 4, boutDur: 0.9, gapDur: 0.5, jitter: 0.06, harsh: 0.4, noise: 0.04, wander: 0.12, rough: 0.35 }), SR);
showResult("gas-like", r);
check("gas-like ranks gas first", r.ok && r.results[0].key === "gas", JSON.stringify((r.results||[]).map(x => x.key)));

r = analyzeCry(synthCry({ f0: 420, bouts: 4, boutDur: 0.5, gapDur: 1.2, jitter: 0.015 }), SR);
showResult("comfort-like", r);
check("comfort-like ranks comfort first", r.ok && r.results[0].key === "comfort", JSON.stringify((r.results||[]).map(x => x.key)));

r = analyzeCry(synthCry({ f0: 480, bouts: 4, boutDur: 0.8, gapDur: 0.5, jitter: 0.03, noise: 0.03, breath: 0.06, wander: 0.05, tilt: [1, 0.85, 0.75, 0.65, 0.6, 0.55, 0.5] }), SR);
showResult("discomfort-like", r);
check("discomfort-like in top 2", r.ok && r.results.slice(0, 2).some(x => x.key === "discomfort"), JSON.stringify((r.results||[]).map(x => x.key)));

console.log("\n--- edge cases ---");
r = analyzeCry(new Float32Array(SR * 8), SR);
check("silence rejected", !r.ok, r.ok ? "unexpectedly ok" : r.reason);

r = analyzeCry(synthCry({ dur: 1.0, bouts: 1, boutDur: 0.4 }), SR);
check("1s clip rejected", !r.ok, r.ok ? "unexpectedly ok" : r.reason);

const noiseOnly = new Float32Array(SR * 8);
for (let i = 0; i < noiseOnly.length; i++) noiseOnly[i] = (Math.random() * 2 - 1) * 0.5;
r = analyzeCry(noiseOnly, SR);
check("white noise rejected as no_cry", !r.ok && r.reason === "no_cry", r.ok ? "unexpectedly ok" : r.reason);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
