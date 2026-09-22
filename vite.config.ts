import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: "src/web",
  server: {
    host: true,
    proxy: {
      // Regex match: a bare "/api" prefix would also proxy the module file
      // /api.ts to the broker, whose SPA fallback answered with index.html and
      // blanked the dev workspace.
      "^/api(/|$)": {
        target: "http://127.0.0.1:4173"
      },
      "/events": {
        target: "ws://127.0.0.1:4173",
        ws: true
      },
      "/connector": {
        target: "ws://127.0.0.1:4173",
        ws: true
      }
    }
  },
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true
  }
});
