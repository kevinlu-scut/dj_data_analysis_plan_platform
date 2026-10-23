import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cleaningApiPlugin } from "./server/cleaningPlugin";

export default defineConfig({
  plugins: [react(), cleaningApiPlugin()],
  server: {
    host: "127.0.0.1",
    port: 5175,
  },
});
