import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "./app.js";
import { ConnectorHub } from "./connector.js";
import { formatListenBanner, resolveBindHost } from "./hosts.js";
import { createDemoStore } from "./store.js";

const port = Number.parseInt(process.env.PORT ?? "4173", 10);
const bindHost = resolveBindHost(process.env.UNITY_REMOTE_BIND);
const authToken = process.env.UNITY_REMOTE_TOKEN?.trim() || randomBytes(32).toString("hex");
const bootstrapNonce = randomBytes(32).toString("hex");
const sessionSecret = randomBytes(32).toString("hex");
const tokenPath = join(process.cwd(), ".unity-remote-token");
const webRoot = join(process.cwd(), "dist", "web");

writeFileSync(tokenPath, authToken, { encoding: "utf8", mode: 0o600 });

const hub = new ConnectorHub();
const appOptions: {
  authToken: string;
  bootstrapNonce: string;
  sessionSecret: string;
  hub: ConnectorHub;
  webRoot?: string;
} = { authToken, bootstrapNonce, sessionSecret, hub };
if (existsSync(webRoot)) {
  appOptions.webRoot = webRoot;
}
const app = createApp(createDemoStore(), appOptions);

await app.listen({ host: bindHost, port });
console.log(
  formatListenBanner({
    bindHost,
    port,
    tokenPath,
    bootstrapNonce,
    webBuilt: existsSync(webRoot)
  })
);

const close = async (): Promise<void> => {
  await app.close();
  process.exit(0);
};

process.on("SIGINT", close);
process.on("SIGTERM", close);
