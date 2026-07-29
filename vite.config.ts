import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { existsSync } from "fs";
import type { IncomingMessage, ServerResponse } from "http";

/**
 * Serves the `api/` directory during `npm run dev`.
 *
 * On Vercel each file in `api/` becomes a serverless function automatically.
 * `vite dev` knows nothing about that convention, so this plugin loads the same
 * handler modules and adapts Node's req/res to the Web Request/Response the
 * handlers are written against — one implementation, both environments.
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
            const handler = mod.default as (request: Request) => Promise<Response>;

            const request = new Request(
              `http://${req.headers.host ?? "localhost"}${rawUrl}`,
              { method: req.method, headers: req.headers as HeadersInit },
            );

            const response = await handler(request);
            res.statusCode = response.status;
            response.headers.forEach((value, key) => res.setHeader(key, value));
            res.end(await response.text());
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
  // `host: true` binds all interfaces; Lovable's `"::"` fails on IPv6-less hosts.
  server: { host: true, port: 8080 },
  plugins: [react(), vercelApiDevServer()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
