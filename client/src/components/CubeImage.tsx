import { useEffect, useState } from "react";

/**
 * Renders the scrambled cube state via VisualCube. The scramble is applied as
 * an algorithm to a solved cube (`alg=`), so the image shows exactly what the
 * solver faces.
 *
 * VisualCube is a third-party service and is treated as best-effort: if the
 * image errors or is slow, we fall back to nothing here (the scramble text is
 * always shown alongside by the parent). A missing image must never block a
 * solve.
 */
export function CubeImage({ scramble, size = 220 }: { scramble: string; size?: number }) {
  const [failed, setFailed] = useState(false);

  // Reset failure state when the scramble changes (new solve).
  useEffect(() => setFailed(false), [scramble]);

  if (failed) {
    return (
      <div
        className="cube-image cube-image--fallback"
        style={{ width: size, height: size }}
        aria-hidden="true"
      />
    );
  }

  const url =
    `https://visualcube.api.cubing.net/visualcube.php` +
    `?fmt=svg&pzl=3&size=${size}&bg=t&alg=${encodeURIComponent(scramble)}`;

  return (
    <img
      className="cube-image"
      src={url}
      width={size}
      height={size}
      alt="Scrambled cube state"
      loading="eager"
      onError={() => setFailed(true)}
    />
  );
}
