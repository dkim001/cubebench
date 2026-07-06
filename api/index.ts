// Vercel serverless entry point.
//
// The bundled Express app (server/dist/app.js, built by the root postinstall)
// is imported lazily inside the handler and wrapped in try/catch, so any
// boot/import failure is returned as readable text in the HTTP response
// instead of an opaque FUNCTION_INVOCATION_FAILED. This makes crashes
// diagnosable with a plain curl.
let appPromise: Promise<(req: unknown, res: unknown) => void> | null = null;

export default async function handler(req: any, res: any) {
  try {
    if (!appPromise) {
      appPromise = import("../server/dist/app.js").then((m) => m.default);
    }
    const app = await appPromise;
    return app(req, res);
  } catch (err: any) {
    res.statusCode = 500;
    res.setHeader("content-type", "text/plain");
    res.end("BOOT ERROR:\n" + (err && err.stack ? err.stack : String(err)));
  }
}
