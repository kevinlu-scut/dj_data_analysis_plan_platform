import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
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
  await page.locator('input[type="file"]').setInputFiles({
    name: "category-demo.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify([
      { 平台: "短视频", 新闻类型: "社会", 阅读量: 1200 },
      { 平台: "门户网站", 新闻类型: "财经", 阅读量: 980 },
      { 平台: "短视频", 新闻类型: "财经", 阅读量: 1560 },
    ])),
  });
  await page.locator(".field-table").waitFor();
  const fileSource = await page.getByLabel("数据文件地址").inputValue();
  if (fileSource !== "") throw new Error(`File upload unexpectedly changed the source field: ${fileSource}`);

  const fieldCheckboxes = page.locator('input[aria-label^="使用字段"]');
  const fieldCount = await fieldCheckboxes.count();
  await page.getByLabel("选择或取消全部字段").click();
  if (await page.locator('input[aria-label^="使用字段"]:checked').count()) throw new Error("Field deselect-all did not clear every field");
  await page.getByLabel("选择或取消全部字段").click();
  if (await page.locator('input[aria-label^="使用字段"]:checked').count() !== fieldCount) throw new Error("Field select-all did not select every field");

  await page.getByRole("button", { name: /数据清洗/ }).click();
  await page.getByRole("button", { name: "运行质量诊断" }).click();
  await page.locator(".report-ready").waitFor();
  const qualityScore = await page.locator(".quality-score strong").innerText();
  const dimensions = await page.locator(".dimension-results details").count();

  await page.getByRole("button", { name: /选择策略/ }).click();
  await page.locator(".strategy-phase").nth(0).getByRole("button", { name: /类别关联与列联分析/ }).click();
  await page.locator(".strategy-phase").nth(1).getByRole("button", { name: /类别关系图组/ }).click();
  const mosaicStrategy = await page.getByText("马赛克图", { exact: true }).count();
  if (!mosaicStrategy) throw new Error("Mosaic plot strategy is missing");

  await page.getByRole("button", { name: /生成提示词/ }).click();
  const programmingTools = await page.getByLabel("编程工具").locator("option").allTextContents();
  if (programmingTools.join("|") !== "Python|R 语言") throw new Error(`Unexpected programming tools: ${programmingTools.join(", ")}`);
  await page.getByLabel("编程工具").selectOption("r");
  const planPrompt = await page.locator(".prompt-document pre").innerText();
  const planPromptExpanded = planPrompt.includes("问题复述与新闻价值") && planPrompt.includes("类别关联与列联分析") && planPrompt.includes("请学生确认的方案摘要") && planPrompt.includes("编程工具：R 语言") && planPrompt.includes("ggmosaic");
  if (!planPromptExpanded) throw new Error("Planning prompt is missing the expanded teaching guidance");
  await page.getByRole("button", { name: "执行提示词" }).click();
  const executePrompt = await page.locator(".prompt-document pre").innerText();
  const executePromptExpanded = executePrompt.includes("留下清洗证据") && executePrompt.includes("独立复算与核验结果") && executePrompt.includes("本科生") && executePrompt.includes("使用 R 语言");
  if (!executePromptExpanded) throw new Error("Execution prompt is missing the expanded teaching guidance");

  const result = {
    title: await page.title(),
    qualityScore,
    dimensions,
    fileSourceRemainsBlank: fileSource === "",
    fieldCount,
    mosaicStrategy: Boolean(mosaicStrategy),
    programmingTools,
    planPromptExpanded,
    executePromptExpanded,
    consoleErrors,
  };
  console.log(JSON.stringify(result, null, 2));
  if (consoleErrors.length) process.exitCode = 1;
} finally {
  await browser.close();
  preview.kill();
}
