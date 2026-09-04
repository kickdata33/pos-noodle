/**
 * Full alert for a new QR self-order landing on a table (`PosHome`): a short attention tone
 * followed by a spoken Thai "มีออเดอร์ใหม่" — the shop asked for a spoken alert over a plain
 * beep, spoken once per new order rather than repeating (their choice). The tone plays first
 * since `speechSynthesis.speak()` can take a beat to actually start (voice list still loading,
 * first call in the page), so staff get *some* audible cue immediately either way.
 */
export function playOrderAlertSound(): void {
  playAttentionTone();
  speakNewOrderAlert();
}

/** Speaks "มีออเดอร์ใหม่" once via the browser's built-in text-to-speech — no audio file to
 * host, same reasoning as the tone below. Silently does nothing if the browser has no speech
 * synthesis support, or blocks it (some browsers require a prior user gesture on the page,
 * which staff will have already made just by logging in / tapping around `/pos`). */
function speakNewOrderAlert(): void {
  try {
    if (!("speechSynthesis" in window)) return;
    const utterance = new SpeechSynthesisUtterance("มีออเดอร์ใหม่");
    utterance.lang = "th-TH";
    const thaiVoice = window.speechSynthesis.getVoices().find((v) => v.lang === "th-TH");
    if (thaiVoice) utterance.voice = thaiVoice;
    window.speechSynthesis.speak(utterance);
  } catch {
    // A missing/blocked TTS engine still leaves the tone below and the blinking card — never
    // worth crashing the table grid over.
  }
}

function playAttentionTone(): void {
  try {
    const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();

    const playTone = (frequency: number, startTime: number, duration: number) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      // Quick fade in/out avoids an audible click at the start/end of each tone.
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.2, startTime + 0.02);
      gain.gain.linearRampToValueAtTime(0, startTime + duration);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(startTime);
      oscillator.stop(startTime + duration);
    };

    const now = ctx.currentTime;
    playTone(880, now, 0.15);
    playTone(1108, now + 0.18, 0.2);

    // Release the audio context shortly after the tones finish — this fires rarely enough
    // (a new QR order) that leaving one open per call would leak them over a long POS shift.
    setTimeout(() => ctx.close(), 600);
  } catch {
    // Browsers that block audio without a user gesture, or don't support the Web Audio API at
    // all, still have the visual badge — a missed beep is never worth crashing the table grid over.
  }
}
