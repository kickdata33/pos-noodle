/**
 * Full alert for a new QR self-order landing on a table (`PosHome`): a short attention tone
 * followed by a spoken Thai "มีออเดอร์ใหม่ค่ะ", spoken once per new order rather than repeating
 * (the shop's choice). The tone plays first since `speechSynthesis.speak()` can take a beat to
 * actually start (voice list still loading, first call in the page), so staff get *some*
 * audible cue immediately either way.
 */
export function playOrderAlertSound(): void {
  playAttentionTone();
  speakNewOrderAlert();
}

/** The exact phrase/rate/pitch spoken for a new order — shared with the "ทดสอบ" preview button
 * on `/pos/alert-voice` so testing a voice there sounds exactly like the real alert. */
const ALERT_TEXT = "มีออเดอร์ใหม่ค่ะ";
const ALERT_RATE = 0.75; // slower — shop asked for "พูดช้าๆ"
const ALERT_PITCH = 1.15; // a touch higher — reads clearer/softer, "พูดชัดๆ"

const VOICE_PREFERENCE_KEY = "posnoodle:alertVoiceURI";

/**
 * Which specific installed voice to speak the alert with, if the shop has picked one on
 * `/pos/alert-voice` — see that page's comment for why a manual picker exists at all (the Web
 * Speech API has no gender field, so an automatic "find a female Thai voice" guess can land on
 * whatever single, oddly-named voice a given Android/Chrome install happens to ship, with no
 * reliable way to detect it's male). Stored in `localStorage`, not `ShopSettings` — voice
 * availability is a property of *this device's* OS/browser, so the right voice on one staff
 * tablet may not even exist on another.
 */
export function getPreferredVoiceURI(): string | null {
  try {
    return window.localStorage.getItem(VOICE_PREFERENCE_KEY);
  } catch {
    return null; // private-browsing / storage blocked — falls back to the automatic guess
  }
}

export function setPreferredVoiceURI(voiceURI: string | null): void {
  try {
    if (voiceURI) window.localStorage.setItem(VOICE_PREFERENCE_KEY, voiceURI);
    else window.localStorage.removeItem(VOICE_PREFERENCE_KEY);
  } catch {
    // Never worth crashing the settings page over — the automatic guess is still a fallback.
  }
}

/**
 * Loads the browser's voice list, waiting out the async-load quirk some browsers (notably
 * Chrome) have where `getVoices()` returns empty on the very first call of the page. Shared by
 * the live alert and the `/pos/alert-voice` settings list so both see the same voices.
 */
export function loadVoices(callback: (voices: SpeechSynthesisVoice[]) => void): void {
  if (!("speechSynthesis" in window)) {
    callback([]);
    return;
  }
  const existing = window.speechSynthesis.getVoices();
  if (existing.length > 0) {
    callback(existing);
    return;
  }
  let called = false;
  const done = () => {
    if (called) return;
    called = true;
    callback(window.speechSynthesis.getVoices());
  };
  window.speechSynthesis.addEventListener("voiceschanged", done, { once: true });
  // Some browsers only ever raise `voiceschanged` once, before this listener attached — this
  // fallback guarantees `callback` still fires even then.
  setTimeout(done, 300);
}

/** Speaks the alert phrase with a specific voice — used both for the real alert and for the
 * "ทดสอบ" preview button on the settings page, so a preview sounds exactly like the real thing. */
export function speakWithVoice(voice: SpeechSynthesisVoice | undefined): void {
  try {
    if (!("speechSynthesis" in window)) return;
    const utterance = new SpeechSynthesisUtterance(ALERT_TEXT);
    utterance.lang = "th-TH";
    utterance.rate = ALERT_RATE;
    utterance.pitch = ALERT_PITCH;
    if (voice) utterance.voice = voice;
    window.speechSynthesis.speak(utterance);
  } catch {
    // A missing/blocked TTS engine still leaves the tone/badge — never worth crashing over.
  }
}

function speakNewOrderAlert(): void {
  try {
    if (!("speechSynthesis" in window)) return;
    loadVoices((voices) => speakWithVoice(pickVoice(voices)));
  } catch {
    // Same reasoning as `speakWithVoice` above.
  }
}

/** The shop's manual pick (see `getPreferredVoiceURI`) wins whenever it's still installed on
 * this device; otherwise falls back to the best-effort automatic guess below. */
function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const preferredURI = getPreferredVoiceURI();
  if (preferredURI) {
    const preferred = voices.find((v) => v.voiceURI === preferredURI);
    if (preferred) return preferred;
  }
  return pickFemaleThaiVoice(voices);
}

/** Best-effort match for a female-sounding Thai voice — the Web Speech API exposes no gender
 * field, only a free-text `name`/`voiceURI` the OS/browser chose, so this checks common naming
 * across engines (Google, Microsoft, Apple all label voices this way) before falling back to
 * whichever Thai voice is first in the list. Some devices (commonly Android) ship a single Thai
 * voice with an internal, non-descriptive name this can never match — for those, `/pos/alert-voice`
 * lets the shop pick a voice by ear instead of by name. */
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
