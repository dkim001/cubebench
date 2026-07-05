// Vercel serverless entry point. An Express app is itself a (req, res)
// handler, so exporting it lets Vercel run the whole API as one function.
// vercel.json rewrites /api/*, /health, and /ready here; the client is served
// as static files from client/dist by Vercel's CDN.
import app from "../server/src/index.ts";

export default app;
