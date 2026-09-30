/* Synthetic babble-like signals for mechanics testing of analyzeBabble.
 * Each "syllable" is a harmonic stack shaped by two formant-like
 * resonances, with attack/decay envelopes. Clean by design: this tests
 * the stage-scoring mechanics, NOT real-baby accuracy.
 */
export const SR = 16000;

function formantWeight(freq, f1, f2) {
  const bw = 320;
  const g = (c) => Math.exp(-((freq - c) * (freq - c)) / (2 * bw * bw));
  return g(f1) + 0.6 * g(f2) + 0.08;
}

export function synthBabble({ syllables, gapSec = 0.18, sr = SR }) {
  // syllables: [{f0, f0End, f1, f2, dur}]
  const parts = [];
  for (const s of syllables) {
    const n = Math.floor(s.dur * sr);
    const buf = new Float32Array(n);
    const K = Math.floor(4000 / s.f0);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const frac = i / n;
      const f0 = s.f0 + (s.f0End ? (s.f0End - s.f0) * frac : 0);
      let v = 0;
      for (let k = 1; k <= K; k++) {
        const fq = k * f0;
        v += formantWeight(fq, s.f1, s.f2) * Math.sin(2 * Math.PI * fq * t + k * 0.7) / k;
      }
      // attack/decay envelope
      const a = Math.min(1, t / 0.02);
      const d = Math.min(1, (s.dur - t) / 0.03);
      buf[i] = v * Math.min(a, d) * 0.5;
    }
    parts.push(buf);
    const gap = new Float32Array(Math.floor(gapSec * sr));
    parts.push(gap);
  }
  const total = parts.reduce((a, b) => a + b.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  // normalize (to 0.9 so peak-normalization itself never trips the clip check)
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i] = 0.9 * out[i] / peak;
  return out;
}

// Cooing: two long vowel-like glides
export function synthCooing() {
  return synthBabble({
    gapSec: 0.5,
    syllables: [
      { f0: 300, f0End: 380, f1: 700, f2: 1100, dur: 0.9 },
      { f0: 320, f0End: 360, f1: 650, f2: 1200, dur: 0.85 }
    ]
  });
}

// Canonical: five identical CV syllables, rhythmic
export function synthCanonical() {
  const syls = [];
  for (let i = 0; i < 5; i++) syls.push({ f0: 300, f1: 800, f2: 1200, dur: 0.25 });
  return synthBabble({ gapSec: 0.15, syllables: syls });
}

// Variegated: five syllables with widely varying resonances
export function synthVariegated() {
  const shapes = [
    [450, 1100], [800, 1900], [1000, 2400], [550, 1300], [950, 2100]
  ];
  const syls = shapes.map(([f1, f2], i) => ({ f0: 280 + i * 12, f1, f2, dur: 0.25 }));
  return synthBabble({ gapSec: 0.15, syllables: syls });
}

// Jargon: long varied stream with speech-like intonation contour
export function synthJargon() {
  const shapes = [
    [800, 1200], [500, 1600], [950, 2000], [700, 1300], [600, 1800],
    [850, 1400], [550, 1200], [900, 2200], [750, 1700], [650, 1500]
  ];
  const f0s = [250, 280, 320, 370, 430, 400, 350, 320, 300, 290];
  const syls = shapes.map(([f1, f2], i) => ({ f0: f0s[i], f1, f2, dur: 0.24 }));
  return synthBabble({ gapSec: 0.12, syllables: syls });
}

// Cry-like in babble mode: high long wails (should trigger the cry hint)
export function synthCryInBabbleMode() {
  const syls = [];
  for (let i = 0; i < 4; i++) syls.push({ f0: 700, f1: 900, f2: 1400, dur: 0.9 });
  return synthBabble({ gapSec: 0.3, syllables: syls });
}

export function silence(sec = 3, sr = SR) {
  return new Float32Array(Math.floor(sec * sr));
}
