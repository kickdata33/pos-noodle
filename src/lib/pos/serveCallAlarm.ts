/**
 * Browser side of the staff "เรียกเสิร์ฟ" alarm: a loud repeating tone, repeating vibration
 * (Android — Apple doesn't let web pages vibrate an iPhone), and a screen wake lock so the phone
 * stays awake with the POS in front while this device has the alarm turned on.
 *
 * Browsers only allow sound after the user has touched the page, so the AudioContext is created
 * and resumed on a tap (the "รับเรียกเสิร์ฟ" switch, or any tap after a reload) and then reused.
 */

const ENABLED_KEY = "posnoodle:serveCallsOn";
export const SERVE_CALLS_TOGGLE_EVENT = "posnoodle:serveCallsToggle";

export function isServeCallsEnabled(): boolean {
  try {
    return window.localStorage.getItem(ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

export function setServeCallsEnabled(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(ENABLED_KEY, "1");
    else window.localStorage.removeItem(ENABLED_KEY);
  } catch {
    // private mode — the switch just won't survive a reload
  }
  window.dispatchEvent(new Event(SERVE_CALLS_TOGGLE_EVENT));
}

let ctx: AudioContext | null = null;

/** Call from a tap handler: creates/resumes the shared AudioContext so later rings can play. */
export function unlockAudio(): void {
  try {
    const AudioContextClass =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    if (!ctx) ctx = new AudioContextClass();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    // no audio on this device
  }
}

export function audioReady(): boolean {
  return ctx !== null && ctx.state === "running";
}

/** One "ding-dong-ding" burst — loud and sharp on purpose, it has to cut through a busy room. */
export function ringOnce(): void {
  if (!ctx || ctx.state !== "running") return;
  const start = ctx.currentTime + 0.02;
  [988, 784, 988].forEach((freq, i) => {
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    osc.type = "square";
    osc.frequency.value = freq;
    const t = start + i * 0.28;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.35, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    osc.connect(gain);
    gain.connect(ctx!.destination);
    osc.start(t);
    osc.stop(t + 0.27);
  });
}

export function vibrateOnce(): void {
  try {
    navigator.vibrate?.([500, 200, 500]);
  } catch {
    // iPhone / desktop: no vibration API
  }
}

export function stopVibration(): void {
  try {
    navigator.vibrate?.(0);
  } catch {
    // ignore
  }
}

type WakeLockSentinelLike = { release: () => Promise<void> };
type WakeLockNavigator = Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> } };

/** Keeps the screen on while the page is visible; returns a release function. */
export async function holdScreenAwake(): Promise<() => void> {
  const nav = navigator as WakeLockNavigator;
  if (!nav.wakeLock) return () => {};
  try {
    const sentinel = await nav.wakeLock.request("screen");
    return () => void sentinel.release().catch(() => undefined);
  } catch {
    return () => {};
  }
}
