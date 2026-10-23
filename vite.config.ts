import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cleaningApiPlugin } from "./server/cleaningPlugin";

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/dj_data_analysis_plan_platform/" : "/",
  plugins: [react(), cleaningApiPlugin()],
  server: {
    host: "127.0.0.1",
    port: 5175,
  },
});
