import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = normalize(fileURLToPath(new URL("../", import.meta.url)));
const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/njulu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const viteProcess = spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", "5186", "--strictPort"], { cwd: root, windowsHide: true, stdio: "ignore" });
for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    const response = await fetch("http://127.0.0.1:5186/api/cleaning/health");
    if (response.ok) break;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (attempt === 39) throw new Error("Vite cleaning service did not start");
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
  await page.goto("http://127.0.0.1:5186", { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "先认识你的数据" }).waitFor();
  await page.screenshot({ path: join(root, "qa-home.png"), fullPage: false });

  await page.getByRole("button", { name: /载入演示数据/ }).click();
  await page.getByText("珠三角城市空气质量", { exact: true }).waitFor();
  const fieldRows = await page.locator(".field-table tbody tr").count();
  if (fieldRows !== 5) throw new Error(`Expected 5 inferred fields, received ${fieldRows}`);

  await page.getByRole("button", { name: /数据清洗/ }).click();
  const cleaningDimensions = await page.locator(".dimension-options input:checked").count();
  if (cleaningDimensions !== 6) throw new Error(`Expected 6 cleaning dimensions, received ${cleaningDimensions}`);
  await page.getByRole("button", { name: "运行质量诊断" }).click();
  await page.locator(".report-ready").waitFor();
  const qualityScore = await page.locator(".quality-score strong").innerText();
  const reportDimensions = await page.locator(".dimension-results details").count();
  if (reportDimensions !== 6) throw new Error(`Expected 6 report dimensions, received ${reportDimensions}`);
  await page.screenshot({ path: join(root, "qa-cleaning.png"), fullPage: true });

  await page.getByRole("button", { name: /定义任务/ }).click();
  const question = await page.locator(".textarea-field textarea").inputValue();
  if (!question.includes("空气质量")) throw new Error("Sample research question was not loaded");
  const taskTypeCount = await page.locator(".task-type-switch > button").count();
  if (taskTypeCount !== 0) throw new Error(`Expected cleaning to be removed from task types, received ${taskTypeCount}`);

  await page.getByRole("button", { name: /选择策略/ }).click();
  await page.getByRole("heading", { name: "先选择数据分析思路" }).waitFor();
  await page.getByRole("heading", { name: "再选择可视化思路" }).waitFor();
  const selectedStrategies = await page.locator(".strategy-row.selected").count();
  if (selectedStrategies !== 5) throw new Error(`Expected 5 selected strategies, received ${selectedStrategies}`);
  const matchedVisualizations = await page.locator(".strategy-row.matched").count();
  if (matchedVisualizations < 2) throw new Error(`Expected matched visualization recommendations, received ${matchedVisualizations}`);
  await page.screenshot({ path: join(root, "qa-strategy.png"), fullPage: true });

  await page.getByRole("button", { name: /迁移案例/ }).click();
  await page.locator(".reference-editor textarea").fill("grouped = data.groupby(['城市', '年份']).mean()\n");
  await page.getByRole("button", { name: "代码迁移" }).click();

  await page.getByRole("button", { name: /生成提示词/ }).click();
  await page.getByRole("button", { name: "执行提示词" }).click();
  const promptText = await page.locator(".prompt-document pre").innerText();
  if (!promptText.includes("珠三角城市空气质量") || !promptText.includes("代码迁移") || !promptText.includes("数据质量：") || !promptText.includes("分析思路：") || !promptText.includes("可视化思路：")) throw new Error("Generated prompt is missing configured context");
  await page.screenshot({ path: join(root, "qa-prompt.png"), fullPage: false });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /数据清洗/ }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(350);
  await page.screenshot({ path: join(root, "qa-mobile.png"), fullPage: false });
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const unnamedButtons = await page.locator("button").evaluateAll((buttons) => buttons.filter((button) => !(button.textContent ?? "").trim() && !button.getAttribute("aria-label") && !button.getAttribute("title")).length);
  if (mobileOverflow > 0) throw new Error(`Mobile page overflows horizontally by ${mobileOverflow}px`);
  if (unnamedButtons > 0) throw new Error(`Found ${unnamedButtons} unnamed buttons`);

  console.log(JSON.stringify({
    title: await page.title(),
    fieldRows,
    cleaningDimensions,
    qualityScore,
    reportDimensions,
    taskTypeCount,
    selectedStrategies,
    matchedVisualizations,
    promptCharacters: promptText.length,
    mobileOverflow,
    unnamedButtons,
    consoleErrors,
  }, null, 2));
} finally {
  await browser.close();
  viteProcess.kill();
}
