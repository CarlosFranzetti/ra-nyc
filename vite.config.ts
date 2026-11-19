import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { existsSync } from "fs";
import type { IncomingMessage, ServerResponse } from "http";

/**
 * Serves the `api/` directory during `npm run dev`.
 *
 * On Vercel each file in `api/` becomes a serverless function automatically;
 * `vite dev` knows nothing about that convention. Because the handlers are
 * written against Node's (req, res) — which is both what Vercel invokes them
 * with and what connect middleware provides — this only has to route, not
 * adapt. The handler that runs here is byte-for-byte the one that runs in
 * production.
 */
function vercelApiDevServer(): Plugin {
  return {
    name: "ra-nyc:api-dev-server",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(
        async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          const rawUrl = req.url ?? "/";
          if (!rawUrl.startsWith("/api/")) return next();

          const route = rawUrl.split("?")[0]!.replace(/\/+$/, "");
          const modulePath = `.${route}.ts`;

          if (!existsSync(path.resolve(__dirname, modulePath))) {
            res.statusCode = 404;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: `No API route for ${route}` }));
            return;
          }

          try {
            const mod = await server.ssrLoadModule(modulePath);
            const handler = mod.default as (
              req: IncomingMessage,
              res: ServerResponse,
            ) => Promise<void>;

            await handler(req, res);
          } catch (error) {
            server.ssrFixStacktrace(error as Error);
            console.error(`[api-dev-server] ${route} failed`, error);
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: `API route ${route} failed` }));
          }
        },
      );
    },
  };
}

export default defineConfig({
  // `host: true` binds all interfaces. The `"::"` literal this replaced fails
  // with EAFNOSUPPORT on hosts without IPv6.
  server: { host: true, port: 8080 },
  plugins: [react(), vercelApiDevServer()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
