/* CryDecode analysis core — pure JavaScript, no DOM.
 * Runs in the browser (ES module) and in Node (for tests).
 *
 * What it does: takes raw cry audio (Float32Array, any sample rate),
 * extracts acoustic features (pitch contour, rhythm, intensity, bout
 * structure, harshness), and scores the cry against 7 need categories
 * using heuristics grounded in infant-cry acoustics research:
 *   - cry fundamental frequency typically 400-600 Hz
 *   - pain cries: higher F0 (500-900+ Hz), louder, more irregular
 *     vibration (jitter / dysphonation)
 *   - hunger: rhythmic, repetitive, mid-range pitch
 *   - tired: lower pitch, falling contour, longer exhalations
 * (see ABOUT/sources in index.html)
 *
 * Honesty note: this is a PATTERN MATCH against acoustic heuristics,
 * not a diagnosis and not a trained ML classifier. It cannot know your
 * baby's baseline. Always trust your instincts and your pediatrician.
 */

export const TARGET_SR = 16000;
const FRAME_MS = 25;   // analysis window
const HOP_MS = 10;     // hop between windows
const MIN_F0 = 200;    // Hz, search floor for pitch
const MAX_F0 = 1200;   // Hz, search ceiling for pitch

/* ------------------------------------------------------------------ */
/* Category metadata: labels, parent-facing copy, suggestions.         */
/* ------------------------------------------------------------------ */

export const CATEGORIES = {
  hungry: {
    label: "Hungry",
    dunstan: "Neh",
    tagline: "The sucking reflex makes a rhythmic, repetitive call.",
    listenFor: "Listen for a repeating, rhythmic cry that builds gradually. It often starts soft and gets more insistent.",
    bodyCues: ["Rooting, turning toward anything near the cheek", "Sucking on hands or lips, lip smacking", "Clenched fists, fussing that grows steadily"],
    tryThis: [
      "Offer a feed, even if the last one was recent. Cluster feeding is normal.",
      "Check the clock: newborns often feed every 2 to 3 hours.",
      "If bottle feeding, check the nipple flow is not too slow."
    ]
  },
  tired: {
    label: "Tired or overstimulated",
    dunstan: "Owh",
    tagline: "A lower, whiny cry with a yawning shape, often with fading energy.",
    listenFor: "Listen for a lower-pitched, wavering cry that rises and falls. It may sound like complaining rather than urgent calling.",
    bodyCues: ["Yawning, eye rubbing, staring blankly", "Turning the head away from stimulation", "Jerky movements, then going still"],
    tryThis: [
      "Move to a dark, quiet room and reduce stimulation.",
      "Try rhythmic motion: rocking, swaying, or a walk.",
      "Offer a nap. An overtired baby often fights sleep first."
    ]
  },
  burp: {
    label: "Needs burping",
    dunstan: "Eh",
    tagline: "Short, clipped bursts as air pushes up from the chest.",
    listenFor: "Listen for short, sharp little bursts rather than long wails. Often appears during or right after a feed.",
    bodyCues: ["Squirming or arching during a feed", "Pulling away from breast or bottle, then wanting it back", "Chest tension, small grimaces"],
    tryThis: [
      "Pause the feed and burp: over the shoulder, sitting up, or face down on your lap.",
      "Try a different burping position if the first does not work.",
      "Resume feeding after the burp, baby may still be hungry."
    ]
  },
  gas: {
    label: "Gas or tummy trouble",
    dunstan: "Eairh",
    tagline: "A strained, grunt-like cry as the belly works.",
    listenFor: "Listen for a strained, almost growling quality with effortful pauses. The cry may come in intense waves.",
    bodyCues: ["Pulling legs up toward the belly", "Arched back, clenched fists", "Red or scrunched face, passing gas"],
    tryThis: [
      "Bicycle the legs gently and press knees toward the tummy.",
      "Try a warm hand or warm towel on the belly.",
      "Tummy time or holding face-down on your forearm can help gas move."
    ]
  },
  discomfort: {
    label: "Uncomfortable",
    dunstan: "Heh",
    tagline: "A breathy, fussy cry about the body: heat, cold, wet, or position.",
    listenFor: "Listen for a whiny, on-and-off fuss that shifts or pauses when you change something. Less rhythmic than hunger.",
    bodyCues: ["Squirming, shifting, never settling", "Skin feels hot or cold, flushed cheeks", "Wet diaper, tight clothing, awkward position"],
    tryThis: [
      "Check the diaper, clothing, and room temperature.",
      "Reposition: some babies hate lying flat or being overdressed.",
      "Check for a hair tourniquet on fingers or toes, and clothing tags."
    ]
  },
  pain: {
    label: "Pain or sudden distress",
    dunstan: null,
    tagline: "A sudden, high-pitched, intense cry that is hard to soothe.",
    listenFor: "Listen for a sudden start, very high pitch, and long intense bursts. Pain cries often sound urgent and different from the baby's usual cry.",
    bodyCues: ["Sudden screaming after being calm", "Rigid body or drawing up sharply", "Breath-holding, then a long wail"],
    tryThis: [
      "Check for anything causing pain: hair wrapped around a finger or toe, a pinch, an insect sting.",
      "Hold and comfort first. If the cry is unlike their usual cry, take it seriously.",
      "If inconsolable, or with fever, vomiting, rash, or trouble breathing, contact your pediatrician promptly."
    ]
  },
  comfort: {
    label: "Wants closeness",
    dunstan: null,
    tagline: "An on-and-off whimper that pauses, listens, and starts again.",
    listenFor: "Listen for short fusses with long pauses in between, as if checking whether you are coming. Often stops the moment you pick them up.",
    bodyCues: ["Quiets when held, cries when put down", "Reaching, nuzzling, seeking eye contact", "Calm between the fussy bursts"],
    tryThis: [
      "Pick them up. You cannot spoil a newborn with closeness.",
      "Try skin-to-skin contact, it regulates breathing and temperature.",
      "Talk or sing softly. Your voice is the most familiar sound they know."
    ]
  }
};

export const CATEGORY_ORDER = ["hungry", "tired", "burp", "gas", "discomfort", "pain", "comfort"];

/* ------------------------------------------------------------------ */
/* Small math helpers                                                 */
/* ------------------------------------------------------------------ */

function ramp(x, lo, hi) {
  // smooth 0..1 ramp: 0 below lo, 1 above hi
  if (x <= lo) return 0;
  if (x >= hi) return 1;
  const t = (x - lo) / (hi - lo);
  return t * t * (3 - 2 * t);
}

function band(x, lo, hi, feather) {
  // 1 inside [lo,hi], feathered falloff outside
  if (x >= lo && x <= hi) return 1;
  if (x < lo) return ramp(x, lo - feather, lo);
  return 1 - ramp(x, hi, hi + feather);
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length)));
  return s[i];
}

function mean(arr) {
  if (!arr.length) return 0;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}

function std(arr, m) {
  if (arr.length < 2) return 0;
  const mu = m === undefined ? mean(arr) : m;
  let s = 0;
  for (const v of arr) s += (v - mu) * (v - mu);
  return Math.sqrt(s / (arr.length - 1));
}

/* ------------------------------------------------------------------ */
/* Preprocessing                                                      */
/* ------------------------------------------------------------------ */

export function toMono16k(samples, sampleRate, channels = 1) {
  let mono;
  if (channels > 1) {
    const n = Math.floor(samples.length / channels);
    mono = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let c = 0; c < channels; c++) s += samples[i * channels + c];
      mono[i] = s / channels;
    }
  } else {
    mono = samples;
  }
  if (sampleRate === TARGET_SR) return mono;
  const ratio = TARGET_SR / sampleRate;
  const outLen = Math.max(1, Math.floor(mono.length * ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i / ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, mono.length - 1);
    const t = pos - i0;
    out[i] = mono[i0] * (1 - t) + mono[i1] * t;
  }
  return out;
}

function removeDC(x) {
  let m = 0;
  for (let i = 0; i < x.length; i++) m += x[i];
  m /= x.length;
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] - m;
  return out;
}

/* ------------------------------------------------------------------ */
/* Pitch via normalized autocorrelation                               */
/* ------------------------------------------------------------------ */

function pitchACF(frame) {
  const N = frame.length;
  let r0 = 0;
  for (let i = 0; i < N; i++) r0 += frame[i] * frame[i];
  if (r0 < 1e-10) return { f0: 0, strength: 0 };
  const minLag = Math.floor(TARGET_SR / MAX_F0); // ~13
  const maxLag = Math.floor(TARGET_SR / MIN_F0); // 80
  let bestLag = minLag;
  let best = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let r = 0;
    for (let i = 0; i < N - lag; i++) r += frame[i] * frame[i + lag];
    r /= r0;
    if (r > best) { best = r; bestLag = lag; }
  }
  if (best < 0.45) return { f0: 0, strength: best };
  // parabolic interpolation around the peak for sub-sample accuracy
  let rPrev = 0, rNext = 0;
  if (bestLag > minLag && bestLag < maxLag) {
    let rp = 0, rn = 0;
    for (let i = 0; i < N - (bestLag - 1); i++) rp += frame[i] * frame[i + bestLag - 1];
    for (let i = 0; i < N - (bestLag + 1); i++) rn += frame[i] * frame[i + bestLag + 1];
    rp /= r0; rn /= r0;
    rPrev = rp; rNext = rn;
    const denom = (rPrev - 2 * best + rNext);
    if (Math.abs(denom) > 1e-9) {
      const shift = 0.5 * (rPrev - rNext) / denom;
      if (Math.abs(shift) < 1) bestLag += shift;
    }
  }
  return { f0: TARGET_SR / bestLag, strength: best };
}

/* ------------------------------------------------------------------ */
/* Spectral centroid (harshness proxy), naive DFT on voiced frames     */
/* ------------------------------------------------------------------ */

function spectralCentroid(frame256) {
  const N = frame256.length;
  let num = 0, den = 0;
  const binHz = TARGET_SR / N;
  for (let k = 2; k <= 64; k++) {
    let re = 0, im = 0;
    const step = 2 * Math.PI * k / N;
    for (let n = 0; n < N; n++) {
      const a = step * n;
      re += frame256[n] * Math.cos(a);
      im -= frame256[n] * Math.sin(a);
    }
    const mag = Math.sqrt(re * re + im * im);
    num += k * binHz * mag;
    den += mag;
  }
  return den > 1e-12 ? num / den : 0;
}

/* ------------------------------------------------------------------ */
/* Segmentation: voiced frames -> cry bouts and pauses                */
/* ------------------------------------------------------------------ */

function segmentBouts(voiced) {
  const bouts = [];
  const MERGE_GAP = 15; // frames (150 ms) of unvoiced still same bout
  let start = -1, lastVoiced = -1;
  for (let i = 0; i <= voiced.length; i++) {
    const v = i < voiced.length ? voiced[i] : false;
    if (v) {
      if (start < 0) start = i;
      lastVoiced = i;
    } else if (start >= 0 && i - lastVoiced > MERGE_GAP) {
      bouts.push({ start, end: lastVoiced + 1 });
      start = -1;
    }
  }
  if (start >= 0) bouts.push({ start, end: lastVoiced + 1 });
  // drop tiny bouts (< 120 ms)
  return bouts.filter(b => (b.end - b.start) >= 12);
}

/* ------------------------------------------------------------------ */
/* Feature extraction                                                 */
/* ------------------------------------------------------------------ */

function extractFeatures(x) {
  const N = Math.floor(TARGET_SR * FRAME_MS / 1000); // 400
  const H = Math.floor(TARGET_SR * HOP_MS / 1000);   // 160
  const nF = Math.max(0, Math.floor((x.length - N) / H) + 1);
  const fps = 1000 / HOP_MS; // 100 frames per second
  const durSec = x.length / TARGET_SR;

  if (nF < 30) {
    return { tooShort: true, durSec, nF };
  }

  // Pass 1: frame energy
  const rms = new Float32Array(nF);
  let maxRMS = 0, clipCount = 0;
  for (let f = 0; f < nF; f++) {
    const off = f * H;
    let e = 0;
    for (let i = 0; i < N; i++) {
      const v = x[off + i];
      e += v * v;
      if (Math.abs(v) >= 0.98) clipCount++;
    }
    rms[f] = Math.sqrt(e / N);
    if (rms[f] > maxRMS) maxRMS = rms[f];
  }
  const clipFrac = clipCount / x.length;

  // Pass 2: pitch on energetic frames
  const f0 = new Float32Array(nF);
  const strength = new Float32Array(nF);
  const voiced = new Array(nF).fill(false);
  const energyGate = Math.max(maxRMS * 0.06, 0.004);
  const frame = new Float32Array(N);
  for (let f = 0; f < nF; f++) {
    if (rms[f] < energyGate) continue;
    const off = f * H;
    for (let i = 0; i < N; i++) frame[i] = x[off + i];
    const { f0: p, strength: s } = pitchACF(frame);
    f0[f] = p; strength[f] = s;
    voiced[f] = p > 0;
  }

  // Pass 3: spectral centroid on every 3rd voiced frame
  const centroids = [];
  const cframe = new Float32Array(256);
  for (let f = 0; f < nF; f += 3) {
    if (!voiced[f]) continue;
    const off = f * H;
    if (off + 256 > x.length) break;
    for (let i = 0; i < 256; i++) cframe[i] = x[off + i];
    centroids.push(spectralCentroid(cframe));
  }

  const bouts = segmentBouts(voiced);
  const voicedCount = voiced.filter(Boolean).length;

  const voicedF0 = [];
  for (let f = 0; f < nF; f++) if (voiced[f]) voicedF0.push(f0[f]);

  const f0Mean = mean(voicedF0);
  const f0Med = median(voicedF0);
  const f0P10 = percentile(voicedF0, 0.10);
  const f0P90 = percentile(voicedF0, 0.90);
  const f0Std = std(voicedF0, f0Mean);

  // jitter: mean abs frame-to-frame F0 change within bouts
  let jitSum = 0, jitN = 0;
  for (const b of bouts) {
    for (let f = b.start + 1; f < b.end; f++) {
      if (voiced[f] && voiced[f - 1] && f0Mean > 0) {
        jitSum += Math.abs(f0[f] - f0[f - 1]) / f0Mean;
        jitN++;
      }
    }
  }
  const jitter = jitN > 0 ? jitSum / jitN : 0;

  // dysphonation: fraction of voiced frames with weak periodicity
  let weakN = 0;
  for (let f = 0; f < nF; f++) if (voiced[f] && strength[f] < 0.62) weakN++;
  const dysph = voicedCount > 0 ? weakN / voicedCount : 0;

  // bout / pause structure
  const boutDurs = bouts.map(b => (b.end - b.start) / fps);
  const meanBoutDur = mean(boutDurs);
  let pauseSec = 0;
  for (let i = 1; i < bouts.length; i++) {
    pauseSec += (bouts[i].start - bouts[i - 1].end) / fps;
  }
  const spanSec = bouts.length > 1
    ? (bouts[bouts.length - 1].end - bouts[0].start) / fps
    : meanBoutDur;
  const pauseRatio = spanSec > 0 ? pauseSec / spanSec : 0;

  // onset abruptness: time for first bout to reach 90% of its peak
  let onsetRise = 1;
  if (bouts.length) {
    const b = bouts[0];
    let peak = 0;
    for (let f = b.start; f < b.end; f++) peak = Math.max(peak, rms[f]);
    let t90 = b.end;
    for (let f = b.start; f < b.end; f++) {
      if (rms[f] >= 0.9 * peak) { t90 = f; break; }
    }
    onsetRise = (t90 - b.start) / fps;
  }

  // rhythmicity: autocorrelation peak of the energy envelope at 0.4-3 Hz
  let rhythm = 0, rhythmConfident = false;
  if (nF >= 400) {
    const envMean = mean(Array.from(rms));
    const env = new Float32Array(nF);
    for (let f = 0; f < nF; f++) env[f] = rms[f] - envMean;
    let r0e = 0;
    for (let f = 0; f < nF; f++) r0e += env[f] * env[f];
    if (r0e > 1e-12) {
      const lagLo = Math.floor(fps / 3);    // 3 Hz
      const lagHi = Math.min(Math.floor(fps / 0.4), nF - 1); // 0.4 Hz
      let bestR = 0;
      for (let lag = lagLo; lag <= lagHi; lag++) {
        let r = 0;
        for (let f = 0; f < nF - lag; f++) r += env[f] * env[f + lag];
        r /= r0e;
        if (r > bestR) bestR = r;
      }
      rhythm = Math.max(0, bestR);
      rhythmConfident = true;
    }
  }

  // pitch contour slope (Hz per second), bout-weighted
  let slopeSum = 0, slopeW = 0;
  for (const b of bouts) {
    const xs = [], ys = [];
    for (let f = b.start; f < b.end; f++) {
      if (voiced[f]) { xs.push(f / fps); ys.push(f0[f]); }
    }
    if (xs.length >= 30) {
      const mx = mean(xs), my = mean(ys);
      let num = 0, den = 0;
      for (let i = 0; i < xs.length; i++) {
        num += (xs[i] - mx) * (ys[i] - my);
        den += (xs[i] - mx) * (xs[i] - mx);
      }
      if (den > 1e-9) {
        const s = num / den;
        slopeSum += s * xs.length;
        slopeW += xs.length;
      }
    }
  }
  const contourSlope = slopeW > 0 ? slopeSum / slopeW : 0;

  // crescendo: do cry bouts build in loudness? (hunger cries typically escalate;
  // tired cries more often fade). Robust fraction-of-increases, needs 4+ bouts.
  let crescendo = 0;
  if (bouts.length >= 4) {
    const peaks = bouts.map(b => {
      let p = 0;
      for (let f = b.start; f < b.end; f++) p = Math.max(p, rms[f]);
      return p;
    });
    let inc = 0;
    for (let i = 1; i < peaks.length; i++) {
      if (peaks[i] > peaks[i - 1] * 1.05) inc++;
    }
    crescendo = ramp(inc / (peaks.length - 1), 0.6, 1.0);
  }

  // hyperphonation: fraction of voiced frames above 900 Hz
  let hyperN = 0;
  for (let f = 0; f < nF; f++) if (voiced[f] && f0[f] > 900) hyperN++;
  const hyperFrac = voicedCount > 0 ? hyperN / voicedCount : 0;

  const rmsVals = Array.from(rms);
  const rmsMean = mean(rmsVals);
  const rmsMax = Math.max(...rmsVals);

  return {
    tooShort: false,
    durSec, nF, fps,
    voicedRatio: voicedCount / nF,
    voicedCount,
    boutCount: bouts.length,
    meanBoutDur,
    pauseRatio,
    f0Mean, f0Med, f0P10, f0P90, f0Std,
    jitter, dysph,
    centroid: mean(centroids),
    rmsMean, rmsMax,
    onsetRise,
    rhythm, rhythmConfident,
    contourSlope,
    crescendo,
    hyperFrac,
    clipFrac
  };
}

/* ------------------------------------------------------------------ */
/* Scoring                                                            */
/* ------------------------------------------------------------------ */

function scoreAll(F) {
  const abrupt = 1 - ramp(F.onsetRise, 0.12, 0.4);       // sudden loud start
  const sustained = ramp(F.meanBoutDur, 0.9, 1.8);       // long wails
  const intermittent = band(F.pauseRatio, 0.12, 0.55, 0.15);
  const highPitch = ramp(F.f0Med, 520, 680);
  const midPitch = band(F.f0Med, 380, 540, 40);
  const lowPitch = 1 - ramp(F.f0Med, 420, 520);
  const rhythmic = F.rhythmConfident ? ramp(F.rhythm, 0.4, 0.65) : 0;
  const arrhythmic = 1 - (F.rhythmConfident ? ramp(F.rhythm, 0.25, 0.5) : 0.5);
  const jittery = ramp(F.jitter, 0.02, 0.06);
  const harsh = ramp(F.centroid, 1300, 1900);           // tense / breathy voice quality
  const strained = ramp(F.dysph, 0.22, 0.5);
  const wander = ramp(F.f0Std, 35, 75);                 // large slow pitch wandering
  const falling = ramp(-F.contourSlope, 8, 40);
  const shortBouts = 1 - ramp(F.meanBoutDur, 0.35, 0.75);
  const manyBouts = ramp(F.boutCount, 2, 5);
  const longPauses = ramp(F.pauseRatio, 0.35, 0.6);
  const boutLen = ramp(F.meanBoutDur, 0.45, 0.8);        // sustained demand vocalization
  const calm = 1 - jittery;
  const f0GasBand = band(F.f0Med, 450, 600, 60);

  const raw = {
    pain: 0.42 * highPitch + 0.20 * abrupt + 0.20 * sustained + 0.18 * jittery,
    hungry: 0.28 * rhythmic + 0.16 * midPitch + 0.12 * manyBouts + 0.10 * calm
      + 0.10 * boutLen + 0.24 * F.crescendo,
    tired: 0.35 * lowPitch + 0.30 * falling + 0.20 * sustained + 0.15 * arrhythmic,
    burp: 0.45 * shortBouts + 0.25 * manyBouts + 0.15 * band(F.f0Med, 350, 550, 80) + 0.15 * rhythmic,
    gas: 0.40 * jittery + 0.20 * wander + 0.20 * intermittent + 0.10 * f0GasBand + 0.10 * strained,
    discomfort: 0.35 * harsh + 0.25 * band(F.f0Med, 400, 560, 60) + 0.20 * intermittent + 0.20 * strained,
    comfort: 0.35 * longPauses + 0.25 * (1 - ramp(F.meanBoutDur, 0.6, 1.2)) + 0.20 * (1 - ramp(F.f0Med, 480, 600)) + 0.20 * manyBouts
  };
  // A harsh / breathy voice quality points away from a plain hunger demand cry
  // and toward discomfort (or pain, which has its own high-pitch path).
  raw.hungry *= (1 - 0.45 * harsh);
  for (const k of Object.keys(raw)) raw[k] = Math.min(1, Math.max(0, raw[k]));
  return raw;
}

/* ------------------------------------------------------------------ */
/* Evidence strings: why did a category score highly?                 */
/* ------------------------------------------------------------------ */

function evidenceFor(key, F) {
  const ev = [];
  const hz = v => Math.round(v) + " Hz";
  switch (key) {
    case "pain":
      if (F.f0Med > 520) ev.push("Higher pitched than usual (around " + hz(F.f0Med) + "), which research links to greater distress.");
      if (F.onsetRise < 0.25) ev.push("The cry started suddenly and loudly.");
      if (F.meanBoutDur > 0.9) ev.push("Long, sustained wails with little letup.");
      if (F.jitter > 0.045) ev.push("The voice sounds strained and unsteady.");
      break;
    case "hungry":
      if (F.rhythmConfident && F.rhythm > 0.4) ev.push("A repeating, rhythmic pattern, like a call that expects an answer.");
      if (F.crescendo > 0.5) ev.push("The cry builds in intensity, bout after bout, which is typical of a hunger cry.");
      if (F.f0Med >= 380 && F.f0Med <= 540) ev.push("Pitch sits in the typical range for a demand cry (around " + hz(F.f0Med) + ").");
      if (F.boutCount >= 3) ev.push("Several distinct cry bursts rather than one long wail.");
      break;
    case "tired":
      if (F.f0Med < 450) ev.push("Lower pitched than an urgent cry (around " + hz(F.f0Med) + ").");
      if (F.contourSlope < -15) ev.push("The pitch drifts downward, like energy fading.");
      if (F.meanBoutDur > 0.8) ev.push("Long, whiny exhalations.");
      break;
    case "burp":
      if (F.meanBoutDur < 0.7) ev.push("Short, clipped bursts rather than long wails.");
      if (F.boutCount >= 2) ev.push("Comes in little repeated bursts.");
      break;
    case "gas":
      if (F.jitter > 0.045) ev.push("A strained, unsteady voice quality.");
      if (F.dysph > 0.22) ev.push("Grunt-like, effortful sound.");
      if (F.f0Std > 60) ev.push("Pitch wobbles a lot, as if pushing against discomfort.");
      break;
    case "discomfort":
      if (F.centroid > 1300) ev.push("A harsher, tenser voice quality than a clean demand cry.");
      if (F.pauseRatio > 0.12 && F.pauseRatio < 0.55) ev.push("On-and-off fussing rather than a steady rhythm.");
      break;
    case "comfort":
      if (F.pauseRatio > 0.35) ev.push("Long pauses between short fusses, as if waiting for a response.");
      if (F.meanBoutDur < 1.0) ev.push("Brief whimpers rather than full cries.");
      if (F.f0Med < 520) ev.push("Not the high pitch of a distress cry.");
      break;
  }
  return ev.slice(0, 3);
}

/* ------------------------------------------------------------------ */
/* Main entry point                                                   */
/* ------------------------------------------------------------------ */

export function analyzeCry(samples, sampleRate, channels = 1) {
  const issues = [];
  let x = toMono16k(samples, sampleRate, channels);
  if (x.length < TARGET_SR * 1.5) {
    return { ok: false, reason: "too_short", message: "That clip is under 1.5 seconds. Record at least 5 to 10 seconds of crying for a useful read." };
  }
  // cap at 60 s for speed
  const maxLen = TARGET_SR * 60;
  if (x.length > maxLen) x = x.slice(0, maxLen);

  x = removeDC(x);
  // clipping check on the RAW signal: many samples pinned near +/-1 means
  // the mic was overloaded (checking after normalization would false-positive)
  let rawClip = 0;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) >= 0.98) rawClip++;
  const rawClipFrac = rawClip / x.length;
  // peak normalize (loudness is device-dependent, so we use relative dynamics)
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  if (peak < 1e-4) {
    return { ok: false, reason: "silent", message: "That clip is nearly silent. Try recording closer to your baby in a quieter room." };
  }
  const norm = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) norm[i] = x[i] / peak;

  const F = extractFeatures(norm);
  F.clipFrac = rawClipFrac;
  if (F.tooShort) {
    return { ok: false, reason: "too_short", message: "That clip is too short to analyze. Aim for 5 to 10 seconds of crying." };
  }
  if (F.voicedRatio < 0.12 || F.boutCount === 0) {
    return {
      ok: false, reason: "no_cry",
      message: "I could not find clear cry sounds in that clip. It may be mostly background noise or talking. Try holding the phone closer and recording while the cry is happening."
    };
  }
  if (F.durSec < 3) issues.push("Very short clip. A longer recording gives a more reliable read.");
  if (F.clipFrac > 0.02) issues.push("The recording was very loud and clipped. Hold the phone a little farther next time.");
  if (!F.rhythmConfident) issues.push("Clip is short, so the rhythm reading is less certain.");

  const scores = scoreAll(F);
  const ranked = CATEGORY_ORDER
    .map(key => ({ key, score: scores[key] }))
    .sort((a, b) => b.score - a.score);

  const top = ranked[0];
  const confidence = top.score >= 0.55 ? "likely"
    : top.score >= 0.35 ? "possible" : "unclear";

  const results = ranked.slice(0, 3).map(r => ({
    key: r.key,
    label: CATEGORIES[r.key].label,
    score: Math.round(r.score * 100),
    evidence: evidenceFor(r.key, F),
    dunstan: CATEGORIES[r.key].dunstan,
    tagline: CATEGORIES[r.key].tagline,
    tryThis: CATEGORIES[r.key].tryThis,
    listenFor: CATEGORIES[r.key].listenFor,
    bodyCues: CATEGORIES[r.key].bodyCues
  }));

  // Red flags: acoustic patterns worth mentioning to a pediatrician
  const redFlags = [];
  if (F.hyperFrac > 0.25 && F.f0P90 > 950) {
    redFlags.push("This cry is unusually high-pitched in stretches. If this is new for your baby, mention it to your pediatrician.");
  }
  if (F.voicedRatio < 0.2 && F.rmsMean < 0.05) {
    redFlags.push("This cry sounds very weak. A persistently weak cry is worth mentioning to your pediatrician.");
  }

  const features = {
    durationSec: Math.round(F.durSec * 10) / 10,
    pitchMedianHz: Math.round(F.f0Med),
    pitchRangeHz: Math.round(F.f0P10) + "-" + Math.round(F.f0P90),
    cryBursts: F.boutCount,
    avgBurstSec: Math.round(F.meanBoutDur * 100) / 100,
    rhythmScore: Math.round(F.rhythm * 100) / 100,
    contourSlopeHzPerSec: Math.round(F.contourSlope)
  };

  return {
    ok: true,
    confidence,
    summary: confidence === "unclear"
      ? "This cry did not match any pattern clearly. Run through the basics checklist below, your eyes and instincts will do the rest."
      : "The sound patterns look most like " + CATEGORIES[top.key].label.toLowerCase() + ". This is a pattern match, not a diagnosis. You know your baby best.",
    results,
    redFlags,
    issues,
    features
  };
}

/* Export internals for tests */
export const _internals = {
  ramp, band, median, percentile, mean, std,
  pitchACF, spectralCentroid, segmentBouts, extractFeatures, scoreAll
};
