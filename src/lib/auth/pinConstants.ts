/**
 * PIN constants shared by client and server.
 *
 * Kept in its own module with no Node built-in imports: the login keypad is a Client Component
 * and needs `PIN_LENGTH`, while `lib/auth/pin.ts` imports `node:crypto` and must never reach a
 * browser bundle.
 */

/** Staff type this on a keypad, so it is fixed-length digits only. */
export const PIN_LENGTH = 6;

export function isValidPinFormat(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);
}
