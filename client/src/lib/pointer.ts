/**
 * True on touch-first devices (no hover pointer). Used to phrase timer
 * instructions for the device actually in hand — phone users get "tap",
 * keyboard users get "space".
 */
export function isTouchDevice(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(hover: none)").matches
  );
}
