/**
 * Google Identity Services loader. Injects the GIS script once and renders
 * the official Sign in with Google button into a container. The credential
 * callback receives Google's ID token, which the backend verifies for real —
 * nothing here fakes an identity.
 */

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }) => void;
          renderButton: (
            el: HTMLElement,
            options: Record<string, unknown>,
          ) => void;
        };
      };
    };
  }
}

let gisLoading: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (gisLoading) return gisLoading;
  gisLoading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gisLoading = null;
      reject(new Error("Could not load Google sign-in."));
    };
    document.head.appendChild(script);
  });
  return gisLoading;
}

export async function renderGoogleButton(
  container: HTMLElement,
  clientId: string,
  onCredential: (credential: string) => void,
): Promise<void> {
  await loadGis();
  const gis = window.google?.accounts?.id;
  if (!gis) throw new Error("Google sign-in did not initialize.");
  gis.initialize({
    client_id: clientId,
    callback: (response) => onCredential(response.credential),
  });
  // The GIS iframe has a fixed width — size it to the actual column so it
  // can never overflow the gate on a phone. Callers re-render on resize.
  container.innerHTML = "";
  gis.renderButton(container, {
    theme: "outline",
    size: "large",
    shape: "pill",
    text: "continue_with",
    width: Math.min(400, Math.max(200, container.offsetWidth || 320)),
  });
}
