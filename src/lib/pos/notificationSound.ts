/**
 * A short two-tone alert beep for a new QR self-order landing on a table (`PosHome`). Built with
 * the Web Audio API rather than an audio file — no asset to host/fetch, matching this project's
 * general preference for not depending on network resources that don't need to be there (same
 * reasoning as the offline service worker and the locally-generated QR codes).
 */
export function playOrderAlertSound(): void {
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
