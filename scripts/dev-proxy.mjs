import http from "node:http";
import process from "node:process";
import httpProxy from "http-proxy";

const proxyPort = Number(process.env.DEV_PROXY_PORT ?? 8080);

const targets = [
  { prefix: "/panel", target: "http://127.0.0.1:5173" },
  { prefix: "/overlay", target: "http://127.0.0.1:5174" },
  { prefix: "/config", target: "http://127.0.0.1:5175" },
  { prefix: "/api", target: "http://127.0.0.1:8787" },
  { prefix: "/health", target: "http://127.0.0.1:8787" },
  { prefix: "/webhooks", target: "http://127.0.0.1:8787" }
];

const proxy = httpProxy.createProxyServer({
  changeOrigin: true,
  ws: true,
  xfwd: true
});

function matchTarget(url = "/") {
  return targets.find(({ prefix }) => url === prefix || url.startsWith(`${prefix}/`)) ?? null;
}

proxy.on("error", (error, request, response) => {
  const path = request.url ?? "/";
  const message = `Proxy error for ${path}: ${error.message}`;

  if (response instanceof http.ServerResponse && !response.headersSent) {
    response.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(message);
    return;
  }

  console.error(message);
});

const server = http.createServer((request, response) => {
  const url = request.url ?? "/";

  if (url === "/") {
    response.writeHead(302, { Location: "/panel/" });
    response.end();
    return;
  }

  const target = matchTarget(url);
  if (!target) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(`No proxy target configured for ${url}`);
    return;
  }

  proxy.web(request, response, { target: target.target });
});

server.on("upgrade", (request, socket, head) => {
  const target = matchTarget(request.url ?? "/");
  if (!target) {
    socket.destroy();
    return;
  }

  proxy.ws(request, socket, head, { target: target.target });
});

server.listen(proxyPort, "0.0.0.0", () => {
  console.log(`Dev proxy listening on http://0.0.0.0:${proxyPort}`);
  console.log("Panel   -> /panel/");
  console.log("Overlay -> /overlay/");
  console.log("Config  -> /config/");
  console.log("API     -> /api/");
});