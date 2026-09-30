/* CryDecode app UI. All audio processing happens on-device. */
import { analyzeCry, analyzeBabble } from "./cry-analysis.js";

/* ---------------- tabs ---------------- */
const tabBtns = document.querySelectorAll(".tabbtn");
const tabs = document.querySelectorAll(".tab");
tabBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    tabBtns.forEach(b => b.classList.remove("active"));
    tabs.forEach(t => t.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    window.scrollTo({ top: 0 });
  });
});
function goTab(name) {
  document.querySelector(`.tabbtn[data-tab="${name}"]`).click();
}

/* ---------------- cry / babble mode ---------------- */
let mode = "cry";
const modeBtns = document.querySelectorAll(".mode-btn");
const cryIntro = document.getElementById("cry-intro");
const babbleIntro = document.getElementById("babble-intro");
const recordHint = document.getElementById("record-hint");
const analyzingText = document.getElementById("analyzing-text");
const HINTS = {
  cry: "Hold your phone about an arm's length away. 5 to 15 seconds of crying is plenty. Recording stops automatically at 60 seconds.",
  babble: "Record while your baby is chatting. 5 to 15 seconds of babbling is plenty. Recording stops automatically at 60 seconds."
};
modeBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    mode = btn.dataset.mode;
    modeBtns.forEach(b => {
      const on = b === btn;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    cryIntro.hidden = mode !== "cry";
    babbleIntro.hidden = mode !== "babble";
    recordHint.textContent = HINTS[mode];
    analyzingText.innerHTML = mode === "cry"
      ? "Listening to the patterns in the cry&hellip;"
      : "Listening to the syllable patterns&hellip;";
    hideResults();
    clearError();
  });
});

/* ---------------- helpers ---------------- */
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
function fmtTime(ts) {
  return new Date(ts).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
  });
}
function showError(msg) {
  const el = document.getElementById("record-error");
  el.textContent = msg;
  el.hidden = false;
}
function clearError() {
  document.getElementById("record-error").hidden = true;
}

/* ---------------- recording ---------------- */
const recordBtn = document.getElementById("record-btn");
const recordStatus = document.getElementById("record-status");
const recordTimer = document.getElementById("record-timer");
const meterCanvas = document.getElementById("level-meter");
const meterCtx = meterCanvas.getContext("2d");

let mediaRecorder = null, chunks = [], stream = null;
let audioCtx = null, analyser = null, meterRAF = null;
let timerInt = null, recStart = 0;
const MAX_SEC = 60;

recordBtn.addEventListener("click", () => {
  if (mediaRecorder && mediaRecorder.state === "recording") stopRecording();
  else startRecording();
});

async function startRecording() {
  clearError();
  hideResults();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
  } catch (e) {
    showError("Microphone access was blocked. You can still upload an audio file instead, or allow microphone access in your browser settings and try again.");
    return;
  }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC();
    const src = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    drawMeter();
  } catch (e) { /* meter is optional */ }

  chunks = [];
  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
  try {
    mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  } catch (e) {
    showError("Recording is not supported in this browser. Please upload an audio file instead.");
    cleanupStream();
    return;
  }
  mediaRecorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  mediaRecorder.onstop = onRecordingStop;
  mediaRecorder.start(250);

  recordBtn.classList.add("recording");
  recordStatus.textContent = "Listening... tap to stop";
  recordTimer.hidden = false;
  meterCanvas.hidden = false;
  recStart = Date.now();
  timerInt = setInterval(() => {
    const s = Math.floor((Date.now() - recStart) / 1000);
    recordTimer.textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    if (s >= MAX_SEC) stopRecording();
  }, 250);
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
  clearInterval(timerInt);
  cancelAnimationFrame(meterRAF);
}

function cleanupStream() {
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
}

function drawMeter() {
  const data = new Uint8Array(analyser.fftSize);
  const loop = () => {
    analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i] - 128) / 128;
      if (v > peak) peak = v;
    }
    const w = meterCanvas.width, h = meterCanvas.height;
    meterCtx.clearRect(0, 0, w, h);
    const bar = (x, bw) => {
      if (meterCtx.roundRect) {
        meterCtx.beginPath();
        meterCtx.roundRect(x, 0, bw, h, 8);
        meterCtx.fill();
      } else {
        meterCtx.fillRect(x, 0, bw, h);
      }
    };
    meterCtx.fillStyle = "#F1E8DC";
    bar(0, w);
    const bw = Math.max(4, w * Math.min(1, peak * 1.6));
    const grad = meterCtx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, "#D9A441");
    grad.addColorStop(1, "#E07856");
    meterCtx.fillStyle = grad;
    bar(0, bw);
    meterRAF = requestAnimationFrame(loop);
  };
  loop();
}

async function onRecordingStop() {
  recordBtn.classList.remove("recording");
  recordStatus.textContent = "Tap to record";
  recordTimer.hidden = true;
  meterCanvas.hidden = true;
  cleanupStream();
  const blob = new Blob(chunks, { type: mediaRecorder.mimeType || "audio/webm" });
  chunks = [];
  if (blob.size < 2000) {
    showError(mode === "babble"
      ? "That recording was too short to use. Try again and let it run for a few seconds of babbling."
      : "That recording was too short to use. Try again and let it run for a few seconds of crying.");
    return;
  }
  await processAudioBlob(blob);
}

/* ---------------- upload ---------------- */
document.getElementById("file-input").addEventListener("change", async e => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  clearError();
  hideResults();
  await processAudioBlob(f);
});

/* ---------------- analysis pipeline ---------------- */
const analyzingEl = document.getElementById("analyzing");
const resultsEl = document.getElementById("results");
let lastResult = null;

function hideResults() {
  resultsEl.hidden = true;
  resultsEl.innerHTML = "";
  lastResult = null;
}

async function processAudioBlob(blob) {
  analyzingEl.hidden = false;
  resultsEl.hidden = true;
  // let the UI paint before the heavy work
  await new Promise(r => setTimeout(r, 60));
  try {
    const buf = await blob.arrayBuffer();
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    let audioBuf;
    try {
      audioBuf = await ac.decodeAudioData(buf);
    } catch (e) {
      throw new Error("decode");
    } finally {
      ac.close().catch(() => {});
    }
    // resample to 16 kHz mono
    const srcRate = audioBuf.sampleRate;
    const src = audioBuf.getChannelData(0);
    const ch2 = audioBuf.numberOfChannels > 1 ? audioBuf.getChannelData(1) : null;
    const mono = new Float32Array(src.length);
    for (let i = 0; i < src.length; i++) mono[i] = ch2 ? (src[i] + ch2[i]) / 2 : src[i];
    const targetLen = Math.min(Math.floor(mono.length * 16000 / srcRate), 16000 * 60);
    const off = new OfflineAudioContext(1, Math.max(1, targetLen), 16000);
    const srcBuf = off.createBuffer(1, mono.length, srcRate);
    srcBuf.getChannelData(0).set(mono);
    const node = off.createBufferSource();
    node.buffer = srcBuf;
    node.connect(off.destination);
    node.start();
    const rendered = await off.startRendering();
    const samples = rendered.getChannelData(0);

    const result = mode === "babble"
      ? analyzeBabble(samples, 16000, 1)
      : analyzeCry(samples, 16000, 1);
    analyzingEl.hidden = true;
    if (!result.ok) {
      showError(result.message);
      return;
    }
    lastResult = result;
    if (mode === "babble") renderBabbleResults(result);
    else renderResults(result);
  } catch (e) {
    analyzingEl.hidden = true;
    showError("I could not read that audio. Try recording directly, or upload an MP3, M4A or WAV file.");
  }
}

/* ---------------- results ---------------- */
const CONF_LABEL = { likely: "Likely match", possible: "Possible match", unclear: "Unclear" };

function renderResults(result) {
  const top = result.results[0];
  let html = `
    <div class="card result-top">
      <span class="conf-pill conf-${result.confidence}">${CONF_LABEL[result.confidence]}</span>
      <h2>Most like: ${esc(top.label)}</h2>
      <p class="result-summary">${esc(result.summary)}</p>
    </div>
    <div class="card">
      <h2>What the patterns suggest</h2>
      <p class="hint">Pattern match score, not certainty. Every baby is different.</p>`;

  result.results.forEach((r, i) => {
    html += `
      <div class="candidate">
        <div class="cand-head">
          <h3>${i + 1}. ${esc(r.label)}${r.dunstan ? `<span class="dunstan-tag">Dunstan: &ldquo;${esc(r.dunstan)}&rdquo;</span>` : ""}</h3>
          <span class="cand-score">${r.score}</span>
        </div>
        <div class="score-bar"><div class="score-fill" style="width:${r.score}%"></div></div>
        <p class="muted" style="font-size:0.9rem">${esc(r.tagline)}</p>`;
    if (r.evidence.length) {
      html += `<ul class="evidence">${r.evidence.map(e => `<li>${esc(e)}</li>`).join("")}</ul>`;
    }
    if (i === 0) {
      html += `<p><strong>What to try:</strong></p><ul class="try-list">${r.tryThis.map(t => `<li>${esc(t)}</li>`).join("")}</ul>
               <p style="margin-top:8px"><strong>Body cues to watch:</strong></p><ul class="try-list">${r.bodyCues.map(t => `<li>${esc(t)}</li>`).join("")}</ul>
               <p class="hint" style="margin-top:8px">Heard in the cry: ${esc(r.listenFor)}</p>`;
    }
    html += `</div>`;
  });

  if (result.redFlags.length) {
    html += result.redFlags.map(f => `<div class="redflag"><strong>Please note:</strong> ${esc(f)}</div>`).join("");
  }
  if (result.issues.length) {
    html += result.issues.map(f => `<div class="issue-note">${esc(f)}</div>`).join("");
  }

  const ft = result.features;
  html += `
      <details class="tech-details">
        <summary>Technical details (for the curious)</summary>
        <div class="tech-grid">
          <span>Clip length</span><span>${ft.durationSec}s</span>
          <span>Median pitch</span><span>${ft.pitchMedianHz} Hz</span>
          <span>Pitch range</span><span>${ft.pitchRangeHz} Hz</span>
          <span>Cry bursts</span><span>${ft.cryBursts}</span>
          <span>Avg burst length</span><span>${ft.avgBurstSec}s</span>
          <span>Rhythm score</span><span>${ft.rhythmScore}</span>
          <span>Pitch trend</span><span>${ft.contourSlopeHzPerSec} Hz/s</span>
        </div>
      </details>
    </div>
    <div class="card">
      <h2>Save to your diary</h2>
      <p class="hint">Note what was happening, it makes your diary far more useful later.</p>
      <input id="diary-note-input" type="text" placeholder="Quick note, e.g. last fed at 2pm" maxlength="140"
        style="width:100%;padding:12px;border:1.5px solid #E4D9C8;border-radius:12px;font-size:0.95rem;margin-bottom:10px;">
      <div class="result-actions">
        <button id="save-diary" class="btn btn-primary">Save to diary</button>
        <button id="open-checklist" class="btn btn-secondary">Basics checklist</button>
      </div>
    </div>`;

  resultsEl.innerHTML = html;
  resultsEl.hidden = false;
  resultsEl.scrollIntoView({ behavior: "smooth", block: "start" });

  document.getElementById("save-diary").addEventListener("click", () => {
    const note = document.getElementById("diary-note-input").value.trim();
    saveDiaryEntry(result, note);
    goTab("diary");
  });
  document.getElementById("open-checklist").addEventListener("click", openChecklist);
}

/* ---------------- babble results ---------------- */
function renderBabbleResults(result) {
  const top = result.stages[0];
  let html = `
    <div class="card result-top">
      <span class="conf-pill conf-${result.confidence}">${CONF_LABEL[result.confidence]}</span>
      <h2>Most like: ${esc(top.label)}</h2>
      <p class="result-summary">${esc(result.summary)}</p>
    </div>
    <div class="card">
      <h2>What the syllables suggest</h2>
      <p class="hint">Pattern match score, not certainty. Every baby finds their voice on their own schedule.</p>`;

  result.stages.forEach((s, i) => {
    html += `
      <div class="candidate">
        <div class="cand-head">
          <h3>${i + 1}. ${esc(s.label)} <span class="muted" style="font-size:0.85rem">${esc(s.typicalAge)}</span></h3>
          <span class="cand-score">${s.score}</span>
        </div>
        <div class="score-bar"><div class="score-fill" style="width:${s.score}%"></div></div>
        <p class="muted" style="font-size:0.9rem">${esc(s.tagline)}</p>`;
    if (i === 0) {
      html += `<p><strong>What this stage means:</strong> ${esc(s.whatItMeans)}</p>
        <p style="margin-top:10px"><strong>What they might be telling you:</strong></p>
        <ul class="try-list">${s.tellingYou.map(t => `<li>${esc(t)}</li>`).join("")}</ul>
        <p style="margin-top:10px"><strong>How to respond:</strong></p>
        <ul class="try-list">${s.respond.map(t => `<li>${esc(t)}</li>`).join("")}</ul>`;
    }
    html += `</div>`;
  });

  html += `
    </div>
    <div class="card">
      <h2>Where the meaning lives</h2>
      <p>At the babbling stage, the meaning is rarely in the syllables. Watch the body:</p>
      <ul class="try-list">${result.contextGuide.map(t => `<li>${esc(t)}</li>`).join("")}</ul>
    </div>`;

  if (result.issues.length) {
    html += result.issues.map(f => `<div class="issue-note">${esc(f)}</div>`).join("");
  }

  const ft = result.features;
  html += `
    <div class="card">
      <details class="tech-details">
        <summary>Technical details (for the curious)</summary>
        <div class="tech-grid">
          <span>Clip length</span><span>${ft.durationSec}s</span>
          <span>Syllables</span><span>${ft.syllables}</span>
          <span>Avg syllable</span><span>${ft.avgSyllableSec}s</span>
          <span>Syllables/sec</span><span>${ft.syllablesPerSec}</span>
          <span>Rhythm score</span><span>${ft.rhythmScore}</span>
          <span>Repetition score</span><span>${ft.repetitionScore}</span>
          <span>Variety score</span><span>${ft.varietyScore}</span>
          <span>Median pitch</span><span>${ft.pitchMedianHz} Hz</span>
        </div>
      </details>
    </div>
    <div class="card">
      <h2>Save to your diary</h2>
      <p class="hint">Note what was happening, it makes your diary far more useful later.</p>
      <input id="diary-note-input" type="text" placeholder="Quick note, e.g. babbled &quot;dadada&quot; at the dog" maxlength="140"
        style="width:100%;padding:12px;border:1.5px solid #E4D9C8;border-radius:12px;font-size:0.95rem;margin-bottom:10px;">
      <div class="result-actions">
        <button id="save-diary" class="btn btn-primary">Save to diary</button>
      </div>
    </div>`;

  resultsEl.innerHTML = html;
  resultsEl.hidden = false;
  resultsEl.scrollIntoView({ behavior: "smooth", block: "start" });

  document.getElementById("save-diary").addEventListener("click", () => {
    const note = document.getElementById("diary-note-input").value.trim();
    saveDiaryEntry(result, note, "babble");
    goTab("diary");
  });
}

/* ---------------- diary ---------------- */
const DIARY_KEY = "crydecode-diary-v1";

function loadDiary() {
  try {
    return JSON.parse(localStorage.getItem(DIARY_KEY)) || [];
  } catch (e) {
    return [];
  }
}
function storeDiary(entries) {
  localStorage.setItem(DIARY_KEY, JSON.stringify(entries));
}

function saveDiaryEntry(result, note, kind = "cry") {
  const entries = loadDiary();
  const list = kind === "babble" ? result.stages : result.results;
  const top = list[0];
  entries.unshift({
    ts: Date.now(),
    kind,
    topKey: top.key,
    topLabel: top.label,
    score: top.score,
    runners: list.slice(1, 3).map(r => r.label).join(", "),
    note: note || "",
    helped: null
  });
  storeDiary(entries);
  renderDiary();
}

function renderDiary() {
  const entries = loadDiary();
  const list = document.getElementById("diary-list");
  const summary = document.getElementById("diary-summary");
  const empty = document.getElementById("diary-empty");
  const clearBtn = document.getElementById("diary-clear");

  if (!entries.length) {
    list.innerHTML = "";
    summary.innerHTML = "";
    empty.hidden = false;
    clearBtn.hidden = true;
    return;
  }
  empty.hidden = true;
  clearBtn.hidden = false;

  const counts = {};
  let helpedYes = 0, helpedTotal = 0;
  for (const e of entries) {
    counts[e.topLabel] = (counts[e.topLabel] || 0) + 1;
    if (e.helped === true) { helpedYes++; helpedTotal++; }
    else if (e.helped === false) { helpedTotal++; }
  }
  const topPattern = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const nCry = entries.filter(e => e.kind !== "babble").length;
  const nBabble = entries.length - nCry;
  summary.innerHTML = `Most common pattern so far: <strong>${esc(topPattern[0])}</strong> (${topPattern[1]} of ${entries.length}).` +
    (nCry && nBabble ? ` Logged: ${nCry} ${nCry === 1 ? "cry" : "cries"}, ${nBabble} ${nBabble === 1 ? "babble" : "babbles"}.` : "") +
    (helpedTotal ? ` Your saved suggestions helped <strong>${helpedYes} of ${helpedTotal}</strong> times.` : "");

  list.innerHTML = entries.map((e, i) => `
    <div class="card diary-entry">
      <div class="diary-meta">
        <strong><span class="kind-pill ${e.kind === "babble" ? "babble" : ""}">${e.kind === "babble" ? "Babble" : "Cry"}</span>${esc(e.topLabel)} <span class="muted">(${e.score})</span></strong>
        <span class="diary-time">${fmtTime(e.ts)}</span>
      </div>
      ${e.runners ? `<p class="hint" style="margin:4px 0">Also considered: ${esc(e.runners)}</p>` : ""}
      ${e.note ? `<p class="diary-note">&ldquo;${esc(e.note)}&rdquo;</p>` : ""}
      <div class="helped-row">
        <span>Did the suggestion help?</span>
        <button class="helped-btn yes ${e.helped === true ? "active" : ""}" data-i="${i}" data-v="yes">Yes</button>
        <button class="helped-btn no ${e.helped === false ? "active" : ""}" data-i="${i}" data-v="no">No</button>
        <button class="diary-delete" data-i="${i}">delete</button>
      </div>
    </div>`).join("");

  list.querySelectorAll(".helped-btn").forEach(b => {
    b.addEventListener("click", () => {
      const all = loadDiary();
      all[+b.dataset.i].helped = b.dataset.v === "yes";
      storeDiary(all);
      renderDiary();
    });
  });
  list.querySelectorAll(".diary-delete").forEach(b => {
    b.addEventListener("click", () => {
      const all = loadDiary();
      all.splice(+b.dataset.i, 1);
      storeDiary(all);
      renderDiary();
    });
  });
}

document.getElementById("diary-clear").addEventListener("click", () => {
  if (confirm("Delete all diary entries? This cannot be undone.")) {
    storeDiary([]);
    renderDiary();
  }
});

/* ---------------- basics checklist ---------------- */
const CHECKLIST = [
  ["Hungry?", "Newborns feed every 2 to 3 hours, and evenings bring cluster feeding. When in doubt, offer a feed."],
  ["Clean and dry?", "Check the diaper, even if you changed it recently."],
  ["Comfortable temperature?", "Feel the chest or back, not the hands. Dress baby in one more layer than you are wearing."],
  ["Burped?", "Especially during or after feeds. Try a different position if the first does not work."],
  ["Gassy?", "Bicycle the legs gently, press knees toward the tummy, or lay baby tummy-down on your forearm."],
  ["Sleepy?", "Yawning, eye rubbing, turning away. Move to a dark, quiet room and try rhythmic motion."],
  ["Overstimulated?", "Too much noise, light or handling. Skin to skin in a calm, dim room."],
  ["Just wants you?", "Being held is a need, not a habit. Pick them up. You cannot spoil a newborn."]
];

function openChecklist() {
  const wrap = document.getElementById("checklist-items");
  wrap.innerHTML = CHECKLIST.map(([t, h], i) => `
    <label class="check-item" id="check-${i}">
      <input type="checkbox" data-i="${i}">
      <span><span class="check-title">${esc(t)}</span><p class="check-hint">${esc(h)}</p></span>
    </label>`).join("");
  wrap.querySelectorAll("input").forEach(cb => {
    cb.addEventListener("change", () => {
      document.getElementById("check-" + cb.dataset.i).classList.toggle("done", cb.checked);
    });
  });
  document.getElementById("checklist-modal").hidden = false;
}
document.getElementById("checklist-open").addEventListener("click", openChecklist);
document.getElementById("checklist-close").addEventListener("click", () => {
  document.getElementById("checklist-modal").hidden = true;
});
document.getElementById("checklist-modal").addEventListener("click", e => {
  if (e.target.id === "checklist-modal") e.target.hidden = true;
});

/* ---------------- init ---------------- */
renderDiary();
if (!("mediaDevices" in navigator) || !navigator.mediaDevices.getUserMedia) {
  recordBtn.style.opacity = "0.5";
  showError("This browser cannot access the microphone. You can still upload an audio file to analyze.");
}
