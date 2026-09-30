export const SR = 16000;

export function synthCry({ dur = 8, f0 = 440, f0End = null, bouts = 5, boutDur = 0.7,
  gapDur = 0.5, jitter = 0.01, noise = 0.02, amp = 0.8, attack = 0.06, harsh = 0,
  wander = 0, rough = 0, breath = 0, ampGrowth = 0,
  tilt = [1, 0.5, 0.25, 0.12, 0.06] }) {
  const n = Math.floor(dur * SR);
  const out = new Float32Array(n);
  let t = 0.3;
  const segs = [];
  for (let b = 0; b < bouts; b++) { segs.push([t, t + boutDur]); t += boutDur + gapDur; }
  let bi = 0;
  for (const [s0, s1] of segs) {
    const i0 = Math.floor(s0 * SR), i1 = Math.min(n, Math.floor(s1 * SR));
    const boutAmp = amp * (1 + ampGrowth * bi); // hunger cries escalate bout after bout
    bi++;
    let phase = Math.random() * 2 * Math.PI;
    let walk = 0, roughUntil = -1;
    for (let i = i0; i < i1; i++) {
      const tloc = (i - i0) / SR, tsec = i / SR;
      const fbase = f0End != null ? f0 + (f0End - f0) * (tsec / dur) : f0;
      // slow random-walk pitch wander (strained cries wander a lot)
      walk += (Math.random() - 0.5) * wander * 0.06;
      walk *= 0.998;
      const j = 1 + jitter * Math.sin(2 * Math.PI * 37 * tloc + 1.7) * Math.sin(2 * Math.PI * 13 * tloc);
      const ff = fbase * (1 + walk) * j + 8 * Math.sin(2 * Math.PI * 6 * tloc); // vibrato as true FM
      phase += 2 * Math.PI * ff / SR; // integrate phase: keeps signal quasi-periodic
      // intermittent inharmonic roughness (models dysphonation)
      if (rough > 0 && Math.random() < rough / 120) roughUntil = i + Math.floor(0.09 * SR);
      const roughAmp = i < roughUntil ? 0.55 : 0;
      let v = 0;
      for (let h = 0; h < tilt.length; h++) v += tilt[h] * Math.sin(phase * (h + 1) + (h > 4 ? 0.7 : 0));
      v += harsh * 0.2 * Math.sin(11 * phase);
      v += roughAmp * 0.5 * Math.sin(phase * 1.52 + 0.7);
      v += (noise + breath) * (Math.random() * 2 - 1);
      const env = Math.min(1, tloc / Math.max(attack, 0.01)) * Math.min(1, (i1 - i) / SR / 0.08);
      out[i] += boutAmp * v * env;
    }
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < n; i++) out[i] /= (peak || 1);
  return out;
}
