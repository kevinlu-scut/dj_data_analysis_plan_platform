# 数据新闻 AI 工坊

一个可在本地与公开网页运行的教学原型，用于把数据新闻问题转化为结构化的 AI 协作任务。

## 已实现

- CSV、Excel、JSON 文件的浏览器端解析
- 数据集信息、字段类型与字段角色配置
- 独立的数据清洗环节，可勾选六类质量检测维度
- Node 清洗分析接口，可生成质量分、问题证据、处理建议和 Pandas 操作代码
- 分析思路与可视化思路的顺序选择和自动匹配
- 参考代码粘贴与迁移目标设置
- 规划、执行、核验三阶段提示词生成
- 对话式 AI 与编程智能体两种输出模式
- 提示词复制、Markdown 下载与本地草稿保存
- 与任务匹配的结果核验清单

## 本地运行

```bash
npm install
npm run dev
```

访问 `http://127.0.0.1:5175`。

## 构建检查

```bash
npm run build
```

## 在线部署与自动更新

公开演示站：<https://kevinlu-scut.github.io/dj_data_analysis_plan_platform/>

项目包含 GitHub Pages 自动构建工作流。向生产分支 `main` 推送提交后，GitHub Actions 会执行 Vite 构建并自动更新公开网址。

```bash
git add .
git commit -m "描述本次修改"
git push
```

本地运行时，文件先在浏览器中解析，抽样数据仅发送到同一台电脑上的 Vite 服务。GitHub Pages 是静态托管，公开演示站会在浏览器内运行同一套质量诊断规则，数据不会发送到远程清洗接口。请仍避免在共享电脑上处理含敏感个人信息的数据。

清洗规则位于 `server/cleaningEngine.ts`；本地接口注册位于 `server/cleaningPlugin.ts`，Vercel 接口位于 `api/cleaning/`。新增或调整检测规则后，本地重新启动开发服务；推送到 `main` 后 GitHub Pages 会自动重新构建。
