/* Quick feature probe: prints raw features for each synthetic archetype. */
import { _internals } from "../cry-analysis.js";
import { synthCry, SR } from "./synth.mjs";

function feats(x) {
  let p = 0;
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]));
  const n2 = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) n2[i] = x[i] / p;
  return _internals.extractFeatures(n2);
}

const cases = {
  "hunger-like": { f0: 440, bouts: 5, boutDur: 0.7, gapDur: 0.5, jitter: 0.01, ampGrowth: 0.14 },
  "pain-like": { f0: 720, bouts: 2, boutDur: 2.2, gapDur: 0.6, jitter: 0.05, attack: 0.03 },
  "tired-like": { f0: 400, f0End: 280, bouts: 3, boutDur: 1.3, gapDur: 0.7, jitter: 0.015 },
  "burp-like": { f0: 450, bouts: 5, boutDur: 0.3, gapDur: 0.4, jitter: 0.01 },
  "gas-like": { f0: 500, bouts: 4, boutDur: 0.9, gapDur: 0.5, jitter: 0.06, harsh: 0.4, noise: 0.04, wander: 0.12, rough: 0.35 },
  "discomfort-like": { f0: 480, bouts: 4, boutDur: 0.8, gapDur: 0.5, jitter: 0.03, noise: 0.03, breath: 0.06, wander: 0.05, tilt: [1, 0.85, 0.75, 0.65, 0.6, 0.55, 0.5] },
  "comfort-like": { f0: 420, bouts: 4, boutDur: 0.5, gapDur: 1.2, jitter: 0.015 }
};

for (const [name, o] of Object.entries(cases)) {
  const F = feats(synthCry(o));
  console.log(name, JSON.stringify({
    jitter: +F.jitter.toFixed(4), dysph: +F.dysph.toFixed(3), f0Std: Math.round(F.f0Std),
    centroid: Math.round(F.centroid), crescendo: +F.crescendo.toFixed(2), rhythm: +F.rhythm.toFixed(2), pauseRatio: +F.pauseRatio.toFixed(2),
    meanBoutDur: +F.meanBoutDur.toFixed(2), f0Med: Math.round(F.f0Med), slope: Math.round(F.contourSlope),
    onsetRise: +F.onsetRise.toFixed(2), boutCount: F.boutCount, voicedRatio: +F.voicedRatio.toFixed(2)
  }));
}
