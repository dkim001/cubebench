// @ts-nocheck
// Vercel serverless entry point.
//
// The bundled Express app (server/dist/app.js, built by the root postinstall)
// is imported lazily inside the handler and wrapped in try/catch, so any
// boot/import failure is returned as readable text in the HTTP response
// instead of an opaque FUNCTION_INVOCATION_FAILED.
//
// @ts-nocheck: this file is compiled by esbuild at runtime; the server source
// it ultimately runs targets Node's type-stripping, not a strict tsc pass, so
// we don't let Vercel's type-checker gate the build on it.
let appPromise = null;

export default async function handler(req, res) {
  try {
    if (!appPromise) {
      appPromise = import("../server/dist/app.js").then((m) => m.default);
    }
    const app = await appPromise;
    return app(req, res);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("content-type", "text/plain");
    res.end("BOOT ERROR:\n" + (err && err.stack ? err.stack : String(err)));
  }
}
