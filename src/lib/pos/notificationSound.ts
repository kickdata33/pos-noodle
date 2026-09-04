/**
 * Full alert for a new QR self-order landing on a table (`PosHome`): a short attention tone
 * followed by a spoken Thai "มีออเดอร์ใหม่ค่ะ" in a female voice, spoken slowly and clearly (the
 * shop's request) — spoken once per new order rather than repeating (their earlier choice). The
 * tone plays first since `speechSynthesis.speak()` can take a beat to actually start (voice list
 * still loading, first call in the page), so staff get *some* audible cue immediately either way.
 */
export function playOrderAlertSound(): void {
  playAttentionTone();
  speakNewOrderAlert();
}

/**
 * Speaks "มีออเดอร์ใหม่ค่ะ" once via the browser's built-in text-to-speech — no audio file to
 * host, same reasoning as the tone below. Silently does nothing if the browser has no speech
 * synthesis support, or blocks it (some browsers require a prior user gesture on the page,
 * which staff will have already made just by logging in / tapping around `/pos`).
 *
 * Shop feedback: wanted a female voice, pleasant, speaking slowly and clearly. Web Speech API
 * has no gender field on a voice, so `pickFemaleThaiVoice` below is a best-effort name match —
 * the polite feminine particle "ค่ะ" added to the phrase itself does more reliable work here,
 * since it reads as a woman speaking regardless of which underlying voice/timbre the device
 * actually has installed. `rate`/`pitch` are turned down/up a touch for "ช้าๆ ชัดๆ".
 */
function speakNewOrderAlert(): void {
  try {
    if (!("speechSynthesis" in window)) return;

    let spoken = false;
    const speak = () => {
      // Guards against speaking twice — both the `voiceschanged` listener and the fallback
      // timeout below can fire in some browsers, and this must only ever say it once per order.
      if (spoken) return;
      spoken = true;
      const utterance = new SpeechSynthesisUtterance("มีออเดอร์ใหม่ค่ะ");
      utterance.lang = "th-TH";
      utterance.rate = 0.75; // slower — "พูดช้าๆ"
      utterance.pitch = 1.15; // a touch higher — reads clearer/softer, "พูดชัดๆ"
      const voice = pickFemaleThaiVoice(window.speechSynthesis.getVoices());
      if (voice) utterance.voice = voice;
      window.speechSynthesis.speak(utterance);
    };

    // Chrome (and others) load the voice list asynchronously — `getVoices()` can come back
    // empty on the very first call of the page, which would silently skip the female-voice
    // match above. Wait for `voiceschanged` when that happens, with a timeout fallback in case
    // the event never fires (some browsers only raise it once, before this listener attaches).
    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.addEventListener("voiceschanged", speak, { once: true });
      setTimeout(speak, 300);
    } else {
      speak();
    }
  } catch {
    // A missing/blocked TTS engine still leaves the tone below and the blinking card — never
    // worth crashing the table grid over.
  }
}

/** Best-effort match for a female-sounding Thai voice — the Web Speech API exposes no gender
 * field, only a free-text `name`/`voiceURI` the OS/browser chose, so this checks common naming
 * across engines (Google, Microsoft, Apple all label voices this way) before falling back to
 * whichever Thai voice is first in the list. */
function pickFemaleThaiVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const thaiVoices = voices.filter((v) => v.lang.toLowerCase().startsWith("th"));
  if (thaiVoices.length === 0) return undefined;
  const femaleHints = ["female", "หญิง", "kanya", "narisa", "premwadee", "achara", "samantha"];
  return (
    thaiVoices.find((v) => femaleHints.some((hint) => v.name.toLowerCase().includes(hint))) ??
    thaiVoices[0]
  );
}

/**
 * A soft ascending three-note chime (E5 → G5 → C6, a major triad) instead of two flat sine
 * beeps — the shop's feedback on the original tone was "ไม่เพราะ สั้นไป" (not nice, too short).
 * Each note layers a quiet octave-up overtone on top of the fundamental for a bell-like timbre
 * rather than a bare sine wave, and decays with an exponential release (a real bell's tail) so
 * the whole thing reads as one chime, not a beep-beep.
 */
function playAttentionTone(): void {
  try {
    const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();

    const playNote = (frequency: number, startTime: number, peakGain: number) => {
      const duration = 0.9; // long, soft decay — most of what makes it read as "a chime" not "a beep"
      const attack = 0.015;

      const playPartial = (freq: number, gainScale: number) => {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = freq;
        const peak = peakGain * gainScale;
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(peak, startTime + attack);
        // Exponential release (a real bell/chime's natural decay shape) instead of the old
        // linear fade-to-zero, which is what made each note sound clipped/abrupt.
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start(startTime);
        oscillator.stop(startTime + duration + 0.05);
      };

      playPartial(frequency, 1); // fundamental
      playPartial(frequency * 2, 0.15); // quiet octave overtone for a bell-like color
    };

    const now = ctx.currentTime;
    // E5, G5, C6 — a rising major triad, each note overlapping the last slightly (0.16s apart,
    // 0.9s decay) so they blend into one warm chime rather than three separate blips.
    playNote(659.25, now, 0.22);
    playNote(783.99, now + 0.16, 0.2);
    playNote(1046.5, now + 0.32, 0.22);

    // Release the audio context after the longest note's tail finishes — this fires rarely
    // enough (a new QR order) that leaving one open per call would leak them over a long shift.
    setTimeout(() => ctx.close(), 1400);
  } catch {
    // Browsers that block audio without a user gesture, or don't support the Web Audio API at
    // all, still have the visual badge — a missed beep is never worth crashing the table grid over.
  }
}
