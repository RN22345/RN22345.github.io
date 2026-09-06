// sfx.js
// Procedural sound effects via the Web Audio API — no audio assets required.
// Every sound is synthesized from an oscillator, so the prototype ships with SFX
// for free. It is entirely optional: if AudioContext is unavailable, calls no-op.
(function () {
  "use strict";
  let ctx = null;
  function ac() {
    if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) ctx = new AC(); }
    return ctx;
  }
  function tone(freq, dur, type, vol, slide) {
    const c = ac(); if (!c) return;
    const o = c.createOscillator(); const g = c.createGain();
    o.type = type || "sine"; o.frequency.value = freq;
    if (slide) o.frequency.linearRampToValueAtTime(slide, c.currentTime + dur);
    g.gain.setValueAtTime(vol || 0.05, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + dur);
  }
  function chord(fs, dur, type, vol) { fs.forEach((f, i) => setTimeout(() => tone(f, dur, type, vol), i * 45)); }

  const SFX = {
    click() { tone(520, 0.06, "square", 0.03, 440); },
    lock() { tone(330, 0.12, "triangle", 0.05, 440); },
    reveal() { tone(280, 0.2, "sawtooth", 0.05, 560); },
    hit() { tone(150, 0.22, "square", 0.06, 70); },
    heal() { tone(620, 0.16, "sine", 0.05, 880); },
    win() { chord([440, 550, 660, 880], 0.5, "triangle", 0.06); },
  };
  window.HS2 = window.HS2 || {};
  window.HS2.sfx = SFX;
})();
