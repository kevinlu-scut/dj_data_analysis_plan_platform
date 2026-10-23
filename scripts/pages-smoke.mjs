import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = normalize(fileURLToPath(new URL("../", import.meta.url)));
const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/njulu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
  });
}

await run(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-b"]);
await run(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "build"], {
  env: { ...process.env, GITHUB_ACTIONS: "true" },
});

const preview = spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port", "4180", "--strictPort"], {
  cwd: root,
  env: { ...process.env, GITHUB_ACTIONS: "true" },
  windowsHide: true,
  stdio: "inherit",
});

let previewStatus = "not reached";
for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    const response = await fetch("http://127.0.0.1:4180/dj_data_analysis_plan_platform/");
    previewStatus = `HTTP ${response.status}`;
    if (response.ok) break;
  } catch (error) {
    previewStatus = error instanceof Error ? error.message : String(error);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (attempt === 39) throw new Error(`Pages preview did not start: ${previewStatus}`);
}

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});

try {
  await page.goto("http://127.0.0.1:4180/dj_data_analysis_plan_platform/", { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "先认识你的数据" }).waitFor();
  await page.getByRole("button", { name: /载入演示数据/ }).click();
  await page.getByRole("button", { name: /数据清洗/ }).click();
  await page.getByRole("button", { name: "运行质量诊断" }).click();
  await page.locator(".report-ready").waitFor();

  const result = {
    title: await page.title(),
    qualityScore: await page.locator(".quality-score strong").innerText(),
    dimensions: await page.locator(".dimension-results details").count(),
    consoleErrors,
  };
  console.log(JSON.stringify(result, null, 2));
  if (consoleErrors.length) process.exitCode = 1;
} finally {
  await browser.close();
  preview.kill();
}
