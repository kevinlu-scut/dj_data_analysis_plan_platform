import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Broom,
  Check,
  CheckCircle,
  ClipboardText,
  Code,
  Copy,
  Database,
  DownloadSimple,
  FileArrowUp,
  FileText,
  Lightbulb,
  LockKey,
  MagnifyingGlass,
  ShieldCheck,
  SpinnerGap,
  Table,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import { diagnoseDataset } from "../server/cleaningEngine";

type Row = Record<string, unknown>;
type StageId = "dataset" | "cleaning" | "task" | "strategy" | "reference" | "prompt";
type StrategyPhase = "analysis" | "visualization";
type FieldType = "数值" | "分类" | "时间" | "地理" | "文本" | "标识";
type PromptStage = "plan" | "execute" | "verify";
type AiMode = "chat" | "agent";
type CleaningDimensionId = "completeness" | "uniqueness" | "types" | "outliers" | "categories" | "structure";
type CleaningStatus = "idle" | "loading" | "success" | "error";

type Field = {
  name: string;
  inferredType: FieldType;
  role: FieldType;
  selected: boolean;
  sample: string;
};

type DatasetInfo = {
  name: string;
  source: string;
  unit: string;
  timeRange: string;
  fileName: string;
  sheetName: string;
  rowCount: number;
};

type TaskInfo = {
  question: string;
  audience: string;
  outcome: string;
  projectPath: string;
  outputPath: string;
};

type CleaningFinding = {
  level: "high" | "medium" | "low";
  title: string;
  detail: string;
  fields: string[];
  suggestedAction: string;
  code: string;
};

type CleaningReport = {
  generatedAt: string;
  source: "analysis-service";
  status: "healthy" | "attention" | "critical";
  summary: {
    rowsAnalyzed: number;
    totalRows: number;
    columns: number;
    issueCount: number;
    criticalCount: number;
    qualityScore: number;
    sampled: boolean;
  };
  dimensions: Array<{
    id: CleaningDimensionId;
    title: string;
    status: "pass" | "warning" | "critical";
    metric: string;
    summary: string;
    findings: CleaningFinding[];
  }>;
};

type ReferenceInfo = {
  code: string;
  goal: "方法模仿" | "代码迁移" | "作品借鉴";
  note: string;
};

type Strategy = {
  id: string;
  title: string;
  summary: string;
  condition: string;
  caution: string;
  phase: StrategyPhase;
  methods?: string[];
  relatedAnalysis?: string[];
};

const STAGES: { id: StageId; title: string; caption: string }[] = [
  { id: "dataset", title: "认识数据", caption: "数据集与字段" },
  { id: "cleaning", title: "数据清洗", caption: "质量诊断与建议" },
  { id: "task", title: "定义任务", caption: "问题与成果" },
  { id: "strategy", title: "选择策略", caption: "方法与边界" },
  { id: "reference", title: "迁移案例", caption: "参考与改写" },
  { id: "prompt", title: "生成提示词", caption: "规划、执行、核验" },
];

const CLEANING_DIMENSIONS: Array<{ id: CleaningDimensionId; title: string; description: string }> = [
  { id: "completeness", title: "完整性", description: "空值、特殊缺失编码与缺失比例" },
  { id: "uniqueness", title: "重复性", description: "完全重复记录与标识字段唯一性" },
  { id: "types", title: "类型一致性", description: "数值、日期与已确认字段角色的冲突" },
  { id: "outliers", title: "异常值", description: "基于四分位距标记待复核的极端值" },
  { id: "categories", title: "类别规范", description: "空格、大小写和全角半角造成的标签差异" },
  { id: "structure", title: "字段结构", description: "全空、常量和类别基数异常的字段" },
];

const STRATEGIES: Strategy[] = [
  { id: "descriptive", title: "分布与异常", summary: "先看中心、离散、偏态、长尾和异常值，理解数据如何分布。", condition: "至少需要一个数值字段；比较多个群体时还需要分类字段。", caution: "均值可能掩盖偏态和多峰，必须同时说明样本量与缺失处理。", phase: "analysis", methods: ["频数", "分位数", "密度", "异常值"] },
  { id: "correlation", title: "关系与相关", summary: "判断两个变量是否共同变化，并检查方向、强度与非线性。", condition: "通常需要两个数值字段；矩阵比较需要三个以上数值字段。", caution: "相关不代表因果，离群点和混杂变量可能改变关系。", phase: "analysis", methods: ["相关系数", "回归趋势", "二维密度"] },
  { id: "categorical-association", title: "类别关联与列联分析", summary: "比较两个类别变量的联合分布，判断不同群体的构成是否存在系统差异。", condition: "需要两个类别字段；先建立列联表，再根据问题计算行百分比或列百分比，必要时使用卡方检验与标准化残差。", caution: "统计关联不代表因果；样本过少或期望频数过低时，应合并稀疏类别或改用精确检验。", phase: "analysis", methods: ["列联表", "行列百分比", "卡方检验", "标准化残差"] },
  { id: "comparison", title: "排序与组间差异", summary: "比较类别、地区或机构的高低、差距与名次。", condition: "需要可比较的指标、统一统计口径和明确基准。", caution: "排序对时间点、分母和极端值敏感，不要把微小差异写成实质差异。", phase: "analysis", methods: ["排序", "基准差", "Top / Bottom"] },
  { id: "composition", title: "构成与占比", summary: "回答整体由哪些部分构成，以及各部分占比如何变化。", condition: "类别应互斥且能够加总到同一整体。", caution: "分母必须一致；类别过多时，局部占比难以准确比较。", phase: "analysis", methods: ["占比", "层级", "整体与部分"] },
  { id: "trend", title: "时间变化", summary: "分析趋势、拐点、周期、阶段变化与群体间走势。", condition: "需要可靠的时间字段、稳定的时间间隔和口径一致的指标。", caution: "先检查断点、缺口、季节性和统计口径调整。", phase: "analysis", methods: ["趋势", "拐点", "同比 / 环比"] },
  { id: "spatial", title: "空间格局", summary: "寻找地理分布、区域差异、集聚与空间连接。", condition: "需要规范地名、行政区代码、边界文件或经纬度。", caution: "面积不代表人口权重，绝对量与比率不能混用。", phase: "analysis", methods: ["区域差异", "空间集聚", "地点连接"] },
  { id: "flow", title: "流向与网络", summary: "追踪对象从来源到去向的流量、关系与路径。", condition: "需要来源、目标和权重字段，或可构成边列表的数据。", caution: "连接数量过多会迅速失去可读性，方向和权重必须有实际含义。", phase: "analysis", methods: ["来源到去向", "节点关系", "路径"] },
  { id: "multivariate", title: "多变量与分面", summary: "在多个指标或群体之间寻找模式，并保持可比尺度。", condition: "适用于多个指标、多个群体或需要重复比较的结构。", caution: "变量越多越需要取舍；不同分面应尽量保持同一尺度。", phase: "analysis", methods: ["小多图", "标准化", "多指标"] },

  { id: "distribution-chart", title: "分布图组", summary: "让读者看到取值分布，而不只看到一个平均数。", condition: "优先匹配“分布与异常”；多组比较可采用岭线图或分面。", caution: "小样本的密度和小提琴形状可能不稳定，应显示样本量或原始点。", phase: "visualization", methods: ["直方图", "密度图", "箱线图", "小提琴图", "岭线图", "蜂群图"], relatedAnalysis: ["descriptive", "multivariate"] },
  { id: "relation-chart", title: "关系图组", summary: "用位置、点和颜色呈现变量关系、聚类与异常点。", condition: "匹配“关系与相关”；大量重叠点可改用二维密度或六边形分箱。", caution: "趋势线要说明模型；气泡面积编码不适合精确比较。", phase: "visualization", methods: ["散点图", "气泡图", "热力图", "相关矩阵", "二维密度"], relatedAnalysis: ["correlation", "multivariate"] },
  { id: "categorical-chart", title: "类别关系图组", summary: "用面积、长度或颜色展示两个类别变量的联合频数、比例与偏离独立性的组合。", condition: "匹配“类别关联与列联分析”；类别数量适中时优先马赛克图，精确比较时补充分组条形图或列联热力图。", caution: "马赛克图的面积不利于精确读数，类别过多时会变得拥挤；必须标明样本量、百分比口径和颜色含义。", phase: "visualization", methods: ["马赛克图", "分组条形图", "百分比堆叠条形图", "列联热力图"], relatedAnalysis: ["categorical-association"] },
  { id: "bar", title: "排序与比较图组", summary: "突出名次、组间差异、阈值和重点对象。", condition: "匹配“排序与组间差异”；类别名称较长时优先横向布局。", caution: "条形图基线通常从零开始；雷达图和圆形条形图只在特殊叙事中谨慎使用。", phase: "visualization", methods: ["排序条形图", "棒棒糖图", "克利夫兰点图", "表格"], relatedAnalysis: ["comparison"] },
  { id: "composition-chart", title: "构成与层级图组", summary: "呈现部分占整体的比例，以及分类的嵌套结构。", condition: "匹配“构成与占比”；只有少量类别时才考虑饼图或环形图。", caution: "堆叠图中的中间类别难比较，饼图和环形图不适合精确判断。", phase: "visualization", methods: ["百分比堆叠条形图", "矩形树图", "华夫图", "环形图"], relatedAnalysis: ["composition"] },
  { id: "line", title: "时间演变图组", summary: "呈现连续变化、关键拐点和群体走势。", condition: "匹配“时间变化”；组别较多时优先小多图或突出重点线。", caution: "避免双 Y 轴和意大利面式折线；先确认日期格式、间隔与缺口。", phase: "visualization", methods: ["折线图", "面积图", "小多图", "排名变化图", "周期热力图"], relatedAnalysis: ["trend", "multivariate"] },
  { id: "map", title: "地图表达组", summary: "展示区域指标、点位密度、流向和空间差异。", condition: "匹配“空间格局”；区域值、点位值和连接关系对应不同地图。", caution: "分级设色图优先使用比率；必要时配条形图纠正面积偏见。", phase: "visualization", methods: ["分级设色图", "气泡地图", "六边形地图", "变形地图", "连接地图"], relatedAnalysis: ["spatial"] },
  { id: "flow-chart", title: "流向与网络图组", summary: "展示节点之间的数量流动、连接强度和关系结构。", condition: "匹配“流向与网络”；桑基图需要来源、目标和权重。", caution: "弦图和网络图容易拥挤，应筛选关键连接并提供明确图例。", phase: "visualization", methods: ["桑基图", "冲积图", "弦图", "网络图", "弧线图"], relatedAnalysis: ["flow"] },
  { id: "hierarchy-chart", title: "层级结构图组", summary: "展示父子层级、聚类结果或嵌套规模。", condition: "需要明确的父子字段或可计算的层次聚类结构。", caution: "圆形打包图不利于精确比较，树状图的距离需要解释。", phase: "visualization", methods: ["树状图", "圆形打包图", "矩形树图"], relatedAnalysis: ["composition", "multivariate"] },
  { id: "story", title: "交互与叙事增强", summary: "用提示、筛选、缩放和动画降低复杂度，组织阅读路径。", condition: "仅在交互能帮助查值、探索或分步解释时使用。", caution: "交互不能替代标题、图例、来源和静态核心结论；动画应可暂停。", phase: "visualization", methods: ["悬停提示", "筛选", "缩放", "分步注释", "动画"], relatedAnalysis: ["trend", "spatial", "flow", "multivariate"] },
];

const SAMPLE_ROWS: Row[] = [
  { 城市: "广州", 年份: 2022, 空气质量指数: 74, 优良天数: 321, 区域: "华南" },
  { 城市: "广州", 年份: 2023, 空气质量指数: 69, 优良天数: 327, 区域: "华南" },
  { 城市: "深圳", 年份: 2022, 空气质量指数: 62, 优良天数: 335, 区域: "华南" },
  { 城市: "深圳", 年份: 2023, 空气质量指数: 58, 优良天数: 342, 区域: "华南" },
  { 城市: "佛山", 年份: 2022, 空气质量指数: 82, 优良天数: 304, 区域: "华南" },
  { 城市: "佛山", 年份: 2023, 空气质量指数: 77, 优良天数: 312, 区域: "华南" },
];

const emptyDataset: DatasetInfo = { name: "", source: "", unit: "", timeRange: "", fileName: "", sheetName: "", rowCount: 0 };
const initialTask: TaskInfo = { question: "", audience: "普通新闻读者", outcome: "统计表、图表与结论摘要", projectPath: "", outputPath: "outputs/" };
const initialReference: ReferenceInfo = { code: "", goal: "方法模仿", note: "" };

function cellText(value: unknown) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

function detectLocalFileSource(file: File) {
  const localFile = file as File & { path?: string; webkitRelativePath?: string };
  const exposedPath = localFile.path?.trim();
  const relativePath = localFile.webkitRelativePath?.trim();
  return exposedPath || relativePath || `本地文件：${file.name}`;
}

function inferType(name: string, values: unknown[]): FieldType {
  const cleaned = values.filter((value) => value !== null && value !== undefined && String(value).trim() !== "");
  const label = name.toLowerCase();
  if (/id|编号|代码|编码/.test(label)) return "标识";
  if (/日期|时间|年份|year|date|time/.test(label)) return "时间";
  if (/城市|省|区|县|经度|纬度|地址|地区|city|location/.test(label)) return "地理";
  if (cleaned.length && cleaned.every((value) => typeof value === "number" || !Number.isNaN(Number(value)))) return "数值";
  const unique = new Set(cleaned.map(cellText)).size;
  if (unique <= Math.max(12, Math.ceil(cleaned.length * 0.3))) return "分类";
  return "文本";
}

function fieldsFromRows(rows: Row[]): Field[] {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return columns.map((name) => {
    const values = rows.map((row) => row[name]);
    const inferredType = inferType(name, values);
    return { name, inferredType, role: inferredType, selected: true, sample: cellText(values.find((value) => cellText(value))) };
  });
}

function buildPrompt(
  stage: PromptStage,
  mode: AiMode,
  dataset: DatasetInfo,
  fields: Field[],
  task: TaskInfo,
  selectedStrategies: string[],
  reference: ReferenceInfo,
  cleaningReport: CleaningReport | null,
) {
  const chosenFields = fields.filter((field) => field.selected);
  const strategyNames = STRATEGIES.filter((item) => selectedStrategies.includes(item.id));
  const analysisNames = strategyNames.filter((item) => item.phase === "analysis");
  const visualizationNames = strategyNames.filter((item) => item.phase === "visualization");
  const cleaningContext = cleaningReport
    ? [
      `数据质量：${cleaningReport.summary.qualityScore} 分，发现 ${cleaningReport.summary.issueCount} 项问题，其中 ${cleaningReport.summary.criticalCount} 项高风险`,
      `已检测维度：${cleaningReport.dimensions.map((item) => item.title).join("、")}`,
      `优先处理建议：${cleaningReport.dimensions.flatMap((item) => item.findings).slice(0, 5).map((item) => `${item.title}：${item.suggestedAction}`).join("；") || "当前检测维度未发现明显问题"}`,
    ].join("\n")
    : "数据质量：尚未运行清洗诊断";
  const strategyContext = [
    `分析思路：${analysisNames.length ? analysisNames.map((item) => item.title).join("、") : "待选择"}`,
    `可视化思路：${visualizationNames.length ? visualizationNames.map((item) => `${item.title}（${item.methods?.join("、")}）`).join("；") : "待选择"}`,
  ].join("\n");
  const context = [
    `数据集：${dataset.name || "待确认"}`,
    `来源：${dataset.source || "待确认"}`,
    `记录单位：${dataset.unit || "待确认"}`,
    `时间范围：${dataset.timeRange || "待确认"}`,
    `研究问题：${task.question || "待补充"}`,
    `目标读者：${task.audience}`,
    `预期成果：${task.outcome}`,
    `字段：${chosenFields.length ? chosenFields.map((field) => `${field.name}（${field.role}）`).join("、") : "待选择"}`,
    cleaningContext,
    strategyContext,
  ].join("\n");
  const agentContext = mode === "agent"
    ? `\n本地执行环境：\n- 项目目录：${task.projectPath || "请先确认项目目录"}\n- 输入文件：${dataset.fileName || "请先确认输入文件"}${dataset.sheetName ? `，工作表 ${dataset.sheetName}` : ""}\n- 输出目录：${task.outputPath || "outputs/"}\n- 请实际运行代码、处理报错，并核对输出文件。`
    : "\n协作方式：请分步骤讨论。在关键假设未确认前，不要直接执行不可逆的数据处理。";
  const referenceContext = reference.code.trim()
    ? `\n参考材料：\n学习目标为“${reference.goal}”。先解释哪些逻辑可以迁移，哪些变量、参数或假设必须修改。\n学生说明：${reference.note || "无补充说明"}\n参考代码或案例：\n\`\`\`\n${reference.code.trim()}\n\`\`\``
    : "";

  if (stage === "plan") {
    return `# 数据新闻任务规划\n\n你是一名面向新闻传播专业本科生的数据新闻分析导师。你的任务不是替学生直接完成作业，而是帮助学生把新闻问题转化为可检验的数据问题，并形成一份能够被教师审阅、被同学复现的分析方案。请先理解数据、研究问题和传播目标，暂时不要直接生成最终图表、完整代码或成品结论。\n\n${context}${agentContext}${referenceContext}\n\n## 教学与判断原则\n- 先解释“为什么这样做”，再说明“具体怎么做”。首次出现统计术语时，用一句通俗语言解释其含义。\n- 以数据证据为边界，不编造字段含义、数据来源、缺失原因或分析结果。信息不足时明确标记“待确认”。\n- 将事实描述、统计推断和因果判断分开。除非研究设计能够支持，否则不要使用“导致”“影响”等因果措辞。\n- 将新闻价值与技术选择联系起来，说明某一步如何帮助读者理解规模、差异、趋势、关联或不确定性。\n- 注意隐私、污名化、样本代表性和弱势群体风险，避免把分类标签直接解释为人物特征。\n\n## 请完成\n1. **复述问题**：用一至两句话复述你理解的研究对象、时间范围、核心指标、比较关系和目标读者，并指出问题中仍然含糊的部分。\n2. **认识数据**：检查一行数据代表什么，逐项核对所选字段的含义、角色、单位、取值范围和可能的编码方式，识别标识字段、时间字段、类别字段与数值字段。\n3. **列出待确认事项**：只提出会实质影响分析的关键问题，并说明如果不确认会造成什么偏差。不要用大量一般性问题拖延规划。\n4. **制定清洗方案**：结合质量诊断说明缺失、重复、类型冲突、异常值、类别不一致和结构问题如何影响本题。对每项处理给出判断依据、保留原值的方式和处理前后需要记录的指标，不擅自删除、填补或合并记录。\n5. **评估分析思路**：先判断所选方法是否与字段类型和研究问题匹配，再明确指标、分母、分组、聚合层级、比较基准和必要的统计检验。若涉及两个类别变量，应先建立列联表，区分频数、行百分比和列百分比，并说明卡方检验或标准化残差是否必要。\n6. **评估可视化思路**：在分析关系确认后再选择图表。说明图表要编码的变量、视觉通道、排序与尺度、读者应看见的关系、可能误读之处和一个备选方案。若使用马赛克图，说明矩形面积和颜色分别表示什么，并提供精确读数的辅助表或替代图。\n7. **设计核验节点**：给出至少三个可核验的中间结果，例如处理前后行数、列联表合计、分组汇总合计、关键比例复算或图表数据与中间表一致性。\n8. **形成执行顺序**：把任务拆成可审阅步骤。每一步写明目的、输入、处理、输出、检查方法和完成标准。\n\n## 输出格式\n请按以下标题依次输出：\n1. 问题复述与新闻价值\n2. 数据结构与字段理解\n3. 必须确认的问题\n4. 数据清洗与质量风险\n5. 分析策略评估\n6. 可视化策略评估\n7. 分步执行计划\n8. 核验节点与风险清单\n\n最后增加“请学生确认的方案摘要”，用简洁条目列出在进入执行阶段前必须确认的分析口径、清洗决定和图表选择。`;
  }
  if (stage === "execute") {
    return `# 数据新闻任务执行\n\n你是一名面向新闻传播专业本科生的数据新闻分析执行导师和代码审阅者。请严格按照已经确认的方案完成任务，并在执行过程中帮助学生理解每一步的目的、证据和局限。所有结果都必须可复现、可解释、可核验。不得为了得到“好看”或“显著”的结果而临时更换口径。若现有信息不足以安全执行某一步，请暂停该步骤，明确缺少什么以及需要学生做出哪项决定。\n\n${context}${agentContext}${referenceContext}\n\n## 执行规则\n1. **保护原始数据**：以只读方式载入输入文件，不覆盖原文件。清洗后的数据、中间表、图表和日志分别保存，并使用清楚的文件名。\n2. **按顺序执行**：依次完成环境与文件检查、数据读取、字段核对、数据清洗、分析中间表、可视化、结论摘要和结果核验。不得跳过中间表直接绘图。\n3. **解释代码**：每个代码段之前先说明本段的目的、输入和预期输出；代码段之后报告实际结果，并用本科生能够理解的语言解释关键函数、参数和统计术语。\n4. **留下清洗证据**：记录处理前后的行数、列数、缺失值、重复值、字段类型与异常值数量。每项修改都要说明规则、受影响记录数和保留原始值的方法。未经确认，不自动删除异常值或填补缺失值。\n5. **生成可核验中间表**：先输出分析所需的分组汇总、列联表或模型输入表，检查总计、分母和样本量。涉及两个类别变量时，同时给出频数、行百分比或列百分比，并根据方案报告卡方检验、效应大小或标准化残差。\n6. **再制作图表**：图表数据必须直接来自已核验的中间表。标题应表达发现而不是只写图表类型，并标注单位、时间范围、数据来源、样本量、必要注释和不确定性。配色需兼顾色觉障碍，坐标轴与面积编码不得夸大差异。\n7. **谨慎解释**：把“数据直接显示的事实”“基于方法得到的推断”“可能的解释”和“数据无法回答的问题”分开书写。不要把相关关系写成因果关系。\n8. **主动核验**：至少独立复算三个核心数字，检查中间表合计与原始记录是否一致，检查图表值与中间表是否一致，并记录测试结果。遇到报错时说明原因、修复过程和是否影响此前结果。\n9. **尊重新闻伦理**：检查隐私泄露、小样本识别、群体污名化、选择性呈现和样本代表性问题。必要时对细分类别进行合并或匿名化，但必须说明依据。\n\n## 交付结构\n请按以下标题依次输出：\n1. 执行环境与输入文件核对\n2. 数据读取与字段核对\n3. 清洗记录及处理前后对照\n4. 分析代码与中间结果\n5. 可视化代码与图表说明\n6. 核心发现、证据边界与新闻表达建议\n7. 独立复算与核验结果\n8. 输出文件清单与复现方法\n\n## 完成标准\n- 代码从头运行无报错，依赖、路径和随机种子已说明。\n- 输出文件真实存在，文件名与保存位置清楚，原始数据没有被覆盖。\n- 每个核心数字都能追溯到中间表，每张图都能追溯到明确的数据对象。\n- 分母、样本量、单位和时间范围前后一致，结论没有超出数据证据。\n- 学生能够根据说明复述为什么采用该方法、如何检查结果，以及这一结论仍有哪些限制。`;
  }
  return `# 数据新闻结果核验\n\n请作为独立核验者检查本任务的代码、数据、图表与文字结论。不要默认此前结果正确。\n\n${context}${agentContext}\n\n## 核验任务\n1. 重新检查输入文件、字段映射、筛选条件、分组方式、指标与分母。\n2. 对照原始数据核验处理前后记录数、缺失值、重复值与异常值变化。\n3. 抽取至少三个关键结果进行独立复算，说明是否一致。\n4. 检查所选方法的适用条件，并指出任何可能改变结论的假设。\n5. 检查图表类型、坐标轴、尺度、标签、来源与视觉编码是否可能误导。\n6. 逐条核对文字结论，区分事实、推断、解释与尚未得到支持的判断。\n\n## 输出格式\n请输出：核验结论、通过项、问题项、证据位置、修正建议、修订后结论。`;
}

function App() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fieldSelectAllRef = useRef<HTMLInputElement>(null);
  const [activeStage, setActiveStage] = useState<StageId>("dataset");
  const [dataset, setDataset] = useState<DatasetInfo>(emptyDataset);
  const [rows, setRows] = useState<Row[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [task, setTask] = useState<TaskInfo>(initialTask);
  const [selectedCleaningDimensions, setSelectedCleaningDimensions] = useState<CleaningDimensionId[]>(CLEANING_DIMENSIONS.map((item) => item.id));
  const [cleaningReport, setCleaningReport] = useState<CleaningReport | null>(null);
  const [cleaningStatus, setCleaningStatus] = useState<CleaningStatus>("idle");
  const [cleaningError, setCleaningError] = useState("");
  const [selectedStrategies, setSelectedStrategies] = useState<string[]>([]);
  const [reference, setReference] = useState<ReferenceInfo>(initialReference);
  const [promptStage, setPromptStage] = useState<PromptStage>("plan");
  const [aiMode, setAiMode] = useState<AiMode>("agent");
  const [checkedItems, setCheckedItems] = useState<string[]>([]);
  const [fileError, setFileError] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    const raw = localStorage.getItem("data-news-ai-workbench");
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as { dataset?: Partial<DatasetInfo>; fields?: Field[]; task?: TaskInfo & { type?: string }; selectedCleaningDimensions?: CleaningDimensionId[]; cleaningReport?: CleaningReport; selectedStrategies?: string[]; reference?: ReferenceInfo };
      if (saved.dataset) setDataset({ ...emptyDataset, ...saved.dataset });
      if (saved.fields) setFields(saved.fields);
      if (saved.task) {
        const { type: _legacyType, ...savedTask } = saved.task;
        setTask({ ...initialTask, ...savedTask });
      }
      if (saved.selectedCleaningDimensions?.length) setSelectedCleaningDimensions(saved.selectedCleaningDimensions.filter((id) => CLEANING_DIMENSIONS.some((item) => item.id === id)));
      if (saved.cleaningReport) {
        setCleaningReport(saved.cleaningReport);
        setCleaningStatus("success");
      }
      if (saved.selectedStrategies) setSelectedStrategies(saved.selectedStrategies.filter((id) => STRATEGIES.some((item) => item.id === id)));
      if (saved.reference) setReference(saved.reference);
    } catch {
      localStorage.removeItem("data-news-ai-workbench");
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("data-news-ai-workbench", JSON.stringify({ dataset, fields, task, selectedCleaningDimensions, cleaningReport, selectedStrategies, reference }));
  }, [dataset, fields, task, selectedCleaningDimensions, cleaningReport, selectedStrategies, reference]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const currentIndex = STAGES.findIndex((stage) => stage.id === activeStage);
  const analysisStrategies = STRATEGIES.filter((item) => item.phase === "analysis");
  const visualizationStrategies = STRATEGIES.filter((item) => item.phase === "visualization");
  const selectedAnalysisIds = selectedStrategies.filter((id) => analysisStrategies.some((item) => item.id === id));
  const selectedVisualizationIds = selectedStrategies.filter((id) => visualizationStrategies.some((item) => item.id === id));
  const selectedFieldCount = fields.filter((field) => field.selected).length;
  const allFieldsSelected = fields.length > 0 && selectedFieldCount === fields.length;
  useEffect(() => {
    if (!fieldSelectAllRef.current) return;
    fieldSelectAllRef.current.indeterminate = selectedFieldCount > 0 && selectedFieldCount < fields.length;
  }, [fields.length, selectedFieldCount]);
  const prompt = useMemo(
    () => buildPrompt(promptStage, aiMode, dataset, fields, task, selectedStrategies, reference, cleaningReport),
    [promptStage, aiMode, dataset, fields, task, selectedStrategies, reference, cleaningReport],
  );
  const datasetReady = Boolean(dataset.name) && fields.length > 0;
  const cleaningReady = Boolean(cleaningReport);
  const taskReady = Boolean(task.question.trim());
  const strategyReady = selectedAnalysisIds.length > 0 && selectedVisualizationIds.length > 0;
  const completionSteps = [datasetReady, cleaningReady, taskReady, strategyReady, currentIndex > 4 || Boolean(reference.code.trim()), currentIndex === 5 && datasetReady && cleaningReady && taskReady && strategyReady];
  const completion = Math.round(completionSteps.filter(Boolean).length / STAGES.length * 100);

  const verificationItems = useMemo(() => {
    const base = ["输入文件与工作表名称正确", "字段含义、类型与记录单位已确认", "清洗报告中的高风险问题已处理或说明", "原始数据未被覆盖", "核心数字能够从中间结果复算", "结论没有超出数据证据"];
    return [...base, "指标、分母、分组与比较基准一致", "分析方法的适用条件与局限已说明", "图表类型与分析关系匹配", "坐标轴、尺度、标签、样本量与来源完整"];
  }, []);

  function loadRows(nextRows: Row[], fileName: string, sheetName = "") {
    if (!nextRows.length) {
      setFileError("没有读取到有效记录，请检查文件内容。");
      return;
    }
    setRows(nextRows.slice(0, 10000));
    setFields(fieldsFromRows(nextRows));
    setDataset((current) => ({ ...current, name: current.name || fileName.replace(/\.[^.]+$/, ""), fileName, sheetName, rowCount: nextRows.length }));
    setCleaningReport(null);
    setCleaningStatus("idle");
    setCleaningError("");
    setFileError("");
    setToast(`已在浏览器中读取 ${nextRows.length} 条记录`);
  }

  async function handleFile(file: File) {
    setIsParsing(true);
    const detectedSource = detectLocalFileSource(file);
    setDataset((current) => ({ ...current, source: detectedSource }));
    try {
      const extension = file.name.split(".").pop()?.toLowerCase();
      if (!extension || !["csv", "xlsx", "xls", "json"].includes(extension)) {
        setFileError("当前支持 CSV、Excel 和 JSON 文件。");
        return;
      }
      if (extension === "json") {
        const parsed = JSON.parse(await file.text()) as unknown;
        const nextRows = Array.isArray(parsed) ? parsed : [parsed];
        loadRows(nextRows.filter((item): item is Row => Boolean(item) && typeof item === "object"), file.name);
        return;
      }
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const sheetName = workbook.SheetNames[0];
      const nextRows = XLSX.utils.sheet_to_json<Row>(workbook.Sheets[sheetName], { defval: "" });
      loadRows(nextRows, file.name, sheetName);
    } catch {
      setFileError("文件解析失败，请确认文件格式和内容是否完整。");
    } finally {
      setIsParsing(false);
    }
  }

  function loadSample() {
    setDataset({ name: "珠三角城市空气质量", source: "课程演示数据", unit: "一个城市在一个年份的汇总记录", timeRange: "2022-2023", fileName: "air-quality-demo.csv", sheetName: "", rowCount: SAMPLE_ROWS.length });
    setTask((current) => ({ ...current, question: "珠三角不同城市的空气质量是否呈现改善趋势？", outcome: "城市年度汇总表、趋势图与发现摘要" }));
    setSelectedStrategies(["descriptive", "trend", "comparison", "line", "bar"]);
    loadRows(SAMPLE_ROWS, "air-quality-demo.csv");
  }

  function toggleCleaningDimension(id: CleaningDimensionId) {
    setSelectedCleaningDimensions((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    setCleaningReport(null);
    setCleaningStatus("idle");
  }

  async function runCleaningDiagnosis() {
    if (!rows.length || !fields.length) {
      setCleaningStatus("error");
      setCleaningError("请先导入数据，并确认字段角色。");
      return;
    }
    if (!selectedCleaningDimensions.length) {
      setCleaningStatus("error");
      setCleaningError("请至少选择一个质量检测维度。");
      return;
    }
    setCleaningStatus("loading");
    setCleaningReport(null);
    setCleaningError("");
    const requestPayload = {
      rows,
      fields: fields.map((field) => ({ name: field.name, role: field.role })),
      dimensions: selectedCleaningDimensions,
      totalRows: dataset.rowCount || rows.length,
    };
    try {
      if (import.meta.env.BASE_URL !== "/") {
        const payload = diagnoseDataset(requestPayload);
        setCleaningReport(payload);
        setCleaningStatus("success");
        setToast(`质量诊断完成，发现 ${payload.summary.issueCount} 项问题`);
        return;
      }
      const response = await fetch("/api/cleaning/diagnose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload),
      });
      const payload = await response.json() as CleaningReport | { error?: string };
      if (!response.ok || !("summary" in payload)) throw new Error("error" in payload ? payload.error : "本地清洗服务未返回有效报告。");
      setCleaningReport(payload);
      setCleaningStatus("success");
      setToast(`质量诊断完成，发现 ${payload.summary.issueCount} 项问题`);
    } catch (error) {
      setCleaningStatus("error");
      setCleaningError(error instanceof Error && error.message !== "Failed to fetch" ? error.message : "无法连接清洗分析服务，请稍后重试。");
    }
  }

  async function copyCleaningCode(code: string) {
    await navigator.clipboard.writeText(code);
    setToast("清洗建议代码已复制");
  }

  function downloadCleaningReport() {
    if (!cleaningReport) return;
    const sections = cleaningReport.dimensions.map((dimension) => {
      const findings = dimension.findings.length
        ? dimension.findings.map((finding) => `### ${finding.title}\n\n${finding.detail}\n\n建议：${finding.suggestedAction}\n\n\`\`\`python\n${finding.code}\n\`\`\``).join("\n\n")
        : "未发现明显问题。";
      return `## ${dimension.title}\n\n${dimension.summary}\n\n${findings}`;
    }).join("\n\n");
    const markdown = `# ${dataset.name || "数据集"}质量诊断报告\n\n质量分：${cleaningReport.summary.qualityScore}\n\n检测记录：${cleaningReport.summary.rowsAnalyzed} / ${cleaningReport.summary.totalRows}\n\n问题：${cleaningReport.summary.issueCount} 项，其中高风险 ${cleaningReport.summary.criticalCount} 项\n\n${sections}`;
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${dataset.name || "数据集"}-质量诊断报告.md`;
    anchor.click();
    URL.revokeObjectURL(url);
    setToast("质量诊断报告已下载");
  }

  function updateField(index: number, patch: Partial<Field>) {
    setFields((current) => current.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...patch } : field));
    setCleaningReport(null);
    setCleaningStatus("idle");
  }

  function toggleAllFields() {
    const nextSelected = !allFieldsSelected;
    setFields((current) => current.map((field) => ({ ...field, selected: nextSelected })));
    setCleaningReport(null);
    setCleaningStatus("idle");
    setToast(nextSelected ? "已选择全部字段" : "已取消选择全部字段");
  }

  function toggleStrategy(id: string) {
    setSelectedStrategies((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function copyPrompt() {
    await navigator.clipboard.writeText(prompt);
    setToast("提示词已复制");
  }

  function downloadPrompt() {
    const blob = new Blob([prompt], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${dataset.name || "数据新闻任务"}-${promptStage}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
    setToast("Markdown 文件已下载");
  }

  function resetProject() {
    if (!window.confirm("确定清空当前任务配置吗？本地数据文件不会被修改。")) return;
    setDataset(emptyDataset);
    setRows([]);
    setFields([]);
    setTask(initialTask);
    setSelectedCleaningDimensions(CLEANING_DIMENSIONS.map((item) => item.id));
    setCleaningReport(null);
    setCleaningStatus("idle");
    setCleaningError("");
    setSelectedStrategies([]);
    setReference(initialReference);
    setCheckedItems([]);
    setActiveStage("dataset");
    localStorage.removeItem("data-news-ai-workbench");
  }

  function go(offset: number) {
    const target = STAGES[Math.max(0, Math.min(STAGES.length - 1, currentIndex + offset))];
    setActiveStage(target.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">数</div>
          <div><strong>数据新闻-数据处理平台</strong><span>LOCAL WORKBENCH</span></div>
        </div>
        <div className="local-status"><LockKey size={15} weight="bold" /><span>数据仅由本地质量规则引擎处理</span></div>
        <button className="quiet-button" onClick={resetProject}><Trash size={16} />清空任务</button>
      </header>

      <aside className="sidebar" aria-label="任务流程">
        <div className="course-label">数据新闻实践课</div>
        <nav>
          {STAGES.map((stage, index) => {
            const isActive = stage.id === activeStage;
            const isDone = index < currentIndex;
            return <button key={stage.id} className={`nav-step ${isActive ? "active" : ""}`} onClick={() => setActiveStage(stage.id)}>
              <span className="step-number">{isDone ? <Check size={14} weight="bold" /> : String(index + 1).padStart(2, "0")}</span>
              <span><strong>{stage.title}</strong><small>{stage.caption}</small></span>
            </button>;
          })}
        </nav>
        <div className="sidebar-note"><ShieldCheck size={20} /><p><strong>学习原则</strong>先理解数据，再选择方法。代码运行成功不等于分析正确。</p></div>
      </aside>

      <main className="main-panel">
        {activeStage === "dataset" && <section className="stage-panel">
          <StageHeader index="01" title="先认识你的数据" description="导入数据或使用演示样例。系统只做初步推断，字段含义仍需由你确认。" />
          <div className="upload-grid">
            <button className="dropzone" disabled={isParsing} onClick={() => fileInputRef.current?.click()}>
              {isParsing ? <div className="upload-skeleton" aria-label="正在解析文件"><i /><i /><i /></div> : <FileArrowUp size={34} weight="thin" />}
              <strong>{isParsing ? "正在读取数据结构" : "选择本地数据文件"}</strong><span>{isParsing ? "文件只在当前浏览器内处理" : "CSV、XLSX、XLS 或 JSON，浏览器端解析"}</span>
            </button>
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.json" hidden onChange={(event) => event.target.files?.[0] && handleFile(event.target.files[0])} />
            <div className="sample-card">
              <div><span>没有数据文件？</span><h3>用空气质量样例走通流程</h3><p>包含城市、年份、空气质量指数与优良天数。</p></div>
              <button className="secondary-button" onClick={loadSample}>载入演示数据<ArrowRight size={16} /></button>
            </div>
          </div>
          {fileError && <div className="inline-error"><WarningCircle size={18} weight="fill" />{fileError}</div>}
          <div className="form-section">
            <h3>数据集说明</h3>
            <div className="form-grid">
              <FieldInput label="数据集名称" value={dataset.name} placeholder="例如：2023 年城市空气质量" onChange={(value) => setDataset({ ...dataset, name: value })} />
              <FieldInput label="数据文件地址" value={dataset.source} placeholder="选择文件后自动记录，也可手动修改" help="系统优先记录运行环境提供的真实路径；标准浏览器仅能读取文件名或相对路径。" onChange={(value) => setDataset({ ...dataset, source: value })} />
              <FieldInput label="数据的分析单位" value={dataset.unit} placeholder="一行数据代表什么" onChange={(value) => setDataset({ ...dataset, unit: value })} />
              <FieldInput label="数据集主题" value={dataset.timeRange} placeholder="数据集背后的数据新闻主题" onChange={(value) => setDataset({ ...dataset, timeRange: value })} />
            </div>
          </div>
          <div className="form-section field-section">
            <div className="section-title-row"><div><h3>字段确认</h3><p>{fields.length ? `识别到 ${fields.length} 个字段，当前选择 ${selectedFieldCount} 个` : "导入数据后将在这里显示字段"}</p></div>{dataset.fileName && <span className="file-chip"><FileText size={15} />{dataset.fileName}</span>}</div>
            {fields.length ? <div className="field-table-wrap"><table className="field-table"><thead><tr><th><label className="field-select-all"><input ref={fieldSelectAllRef} type="checkbox" checked={allFieldsSelected} onChange={toggleAllFields} aria-label="选择或取消全部字段" /><span>{allFieldsSelected ? "取消全选" : "全选"}</span></label></th><th>字段</th><th>样例值</th><th>系统推断</th><th>你确认的角色</th></tr></thead><tbody>{fields.map((field, index) => <tr key={field.name}><td><input type="checkbox" checked={field.selected} onChange={(event) => updateField(index, { selected: event.target.checked })} aria-label={`使用字段 ${field.name}`} /></td><td><strong>{field.name}</strong></td><td className="sample-value">{field.sample || "空值"}</td><td><span className="type-label">{field.inferredType}</span></td><td><select value={field.role} onChange={(event) => updateField(index, { role: event.target.value as FieldType })}>{["数值", "分类", "时间", "地理", "文本", "标识"].map((type) => <option key={type}>{type}</option>)}</select></td></tr>)}</tbody></table></div> : <EmptyState icon={<Table size={28} />} title="尚未读取字段" text="上传文件或载入演示数据后，可在这里确认字段含义与分析角色。" />}
          </div>
          {rows.length > 0 && <details className="preview"><summary>查看前 5 条数据</summary><div className="preview-table"><table><thead><tr>{fields.map((field) => <th key={field.name}>{field.name}</th>)}</tr></thead><tbody>{rows.slice(0, 5).map((row, index) => <tr key={index}>{fields.map((field) => <td key={field.name}>{cellText(row[field.name]) || "空"}</td>)}</tr>)}</tbody></table></div></details>}
        </section>}

        {activeStage === "cleaning" && <section className="stage-panel">
          <StageHeader index="02" title="先体检，再决定如何清洗" description="选择检查维度，由质量规则引擎返回数据质量报告、处理建议和操作代码。" />
          {!datasetReady ? <EmptyState icon={<Broom size={30} />} title="请先导入并确认数据" text="完成“认识数据”后，清洗引擎才能依据字段角色执行质量诊断。" /> : <>
            <div className="cleaning-dataset-bar">
              <div><Database size={19} /><span><strong>{dataset.name}</strong><small>{dataset.rowCount || rows.length} 条记录，{fields.length} 个字段</small></span></div>
              <span className="local-engine"><LockKey size={14} />本地质量规则引擎</span>
            </div>
            {!rows.length && <div className="inline-note"><WarningCircle size={18} />浏览器刷新后不会保留原始记录，请重新载入数据再运行诊断。已生成的报告仍可查看。</div>}
            <div className="cleaning-workspace">
              <aside className="cleaning-config">
                <div className="cleaning-config-head"><div><h3>检测维度</h3><p>勾选本次需要运行的质量规则。</p></div><button type="button" onClick={() => setSelectedCleaningDimensions(selectedCleaningDimensions.length === CLEANING_DIMENSIONS.length ? [] : CLEANING_DIMENSIONS.map((item) => item.id))}>{selectedCleaningDimensions.length === CLEANING_DIMENSIONS.length ? "取消全选" : "全部选择"}</button></div>
                <div className="dimension-options">
                  {CLEANING_DIMENSIONS.map((dimension) => <label key={dimension.id} className={selectedCleaningDimensions.includes(dimension.id) ? "selected" : ""}>
                    <input type="checkbox" checked={selectedCleaningDimensions.includes(dimension.id)} onChange={() => toggleCleaningDimension(dimension.id)} />
                    <span><strong>{dimension.title}</strong><small>{dimension.description}</small></span>
                  </label>)}
                </div>
                <button className="primary-button diagnose-button" disabled={cleaningStatus === "loading" || !rows.length || !selectedCleaningDimensions.length} onClick={runCleaningDiagnosis}>
                  {cleaningStatus === "loading" ? <SpinnerGap className="spin" size={18} /> : <MagnifyingGlass size={18} />}
                  {cleaningStatus === "loading" ? "正在检测数据" : cleaningReport ? "重新运行诊断" : "运行质量诊断"}
                </button>
                <p className="privacy-note"><ShieldCheck size={15} />数据仅在当前浏览器或同一电脑的本地服务中处理，不上传到外部平台。</p>
              </aside>
              <CleaningReportPanel status={cleaningStatus} error={cleaningError} report={cleaningReport} onRetry={runCleaningDiagnosis} onCopyCode={copyCleaningCode} onDownload={downloadCleaningReport} />
            </div>
          </>}
        </section>}

        {activeStage === "task" && <section className="stage-panel">
          <StageHeader index="03" title="把问题说清楚" description="清洗诊断完成后，明确希望回答的问题与读者需要理解的内容。" />
          <div className="large-form task-form-direct">
            <label className="textarea-field"><span>你希望回答什么问题？</span><small>尽量包含对象、时间、指标和比较关系。</small><textarea rows={5} value={task.question} onChange={(event) => setTask({ ...task, question: event.target.value })} placeholder="例如：珠三角不同城市的空气质量在 2022-2023 年间是否呈现一致的改善趋势？" /></label>
            <div className="form-grid">
              <label className="select-field"><span>目标读者</span><select value={task.audience} onChange={(event) => setTask({ ...task, audience: event.target.value })}><option>普通新闻读者</option><option>课程教师与同学</option><option>政策与行业人员</option><option>学术研究者</option></select></label>
              <label className="select-field"><span>预期成果</span><select value={task.outcome} onChange={(event) => setTask({ ...task, outcome: event.target.value })}><option>清洗后的数据与日志</option><option>统计表与结论摘要</option><option>静态图表与说明</option><option>交互式数据新闻网页</option><option>完整分析报告</option></select></label>
            </div>
          </div>
          <div className="teaching-callout"><Lightbulb size={22} weight="fill" /><div><strong>先写新闻问题，不要先写图表名称</strong><p>“比较不同城市空气质量的变化”比“做一个折线图”更能帮助 AI 判断字段、聚合方式和表达重点。</p></div></div>
        </section>}

        {activeStage === "strategy" && <section className="stage-panel">
          <StageHeader index="04" title="先定分析思路，再选视觉表达" description="依据数据关系选择方法。每项策略都说明适用条件、推荐图表与误用风险。" />
          <div className="gallery-source">
            <div><strong>关系驱动的方法库</strong><p>参考 R Graph Gallery 的 Data-to-Viz 分类，将图表反推为可回答的分析问题。</p></div>
            <a href="https://r-graph-gallery.com/" target="_blank" rel="noreferrer">查看 R Graph Gallery<ArrowRight size={15} /></a>
          </div>
          <div className="strategy-route" aria-label="策略选择顺序">
              <div className="active"><span>1</span><div><strong>分析思路</strong><small>判断数据关系与新闻问题</small></div></div>
              <ArrowRight size={18} />
              <div className={selectedAnalysisIds.length ? "active" : ""}><span>2</span><div><strong>可视化思路</strong><small>匹配视觉编码与阅读方式</small></div></div>
            </div>
            <section className="strategy-phase">
              <div className="phase-heading"><div><span>STEP 01</span><h3>先选择数据分析思路</h3><p>先回答“要比较什么关系”，不要从图表名称开始。</p></div><strong>{selectedAnalysisIds.length} 项已选</strong></div>
              <StrategySection strategies={analysisStrategies} selectedIds={selectedStrategies} onToggle={toggleStrategy} />
            </section>
            <section className={`strategy-phase ${selectedAnalysisIds.length ? "" : "locked"}`}>
              <div className="phase-heading"><div><span>STEP 02</span><h3>再选择可视化思路</h3><p>{selectedAnalysisIds.length ? "系统会标出与已选分析关系相匹配的图表组。" : "完成上一步后解锁，避免让图表类型替代分析判断。"}</p></div><strong>{selectedVisualizationIds.length} 项已选</strong></div>
              {!selectedAnalysisIds.length && <div className="strategy-lock"><LockKey size={18} />请先从上方选择至少一项分析思路</div>}
              <StrategySection strategies={visualizationStrategies} selectedIds={selectedStrategies} selectedAnalysisIds={selectedAnalysisIds} onToggle={toggleStrategy} locked={!selectedAnalysisIds.length} />
            </section>
          {!strategyReady && <div className="inline-note"><WarningCircle size={18} />分析思路与可视化思路各至少选择一项，才能形成完整方案。</div>}
        </section>}

        {activeStage === "reference" && <section className="stage-panel">
          <StageHeader index="05" title="从案例中迁移，而不是照抄" description="粘贴参考代码或作品结构，并明确希望借鉴的内容。此步骤可以跳过。" />
          <div className="reference-layout">
            <div className="reference-editor">
              <label><span>参考代码或案例说明</span><small>支持 Python、R、JavaScript 或自然语言描述</small><textarea value={reference.code} onChange={(event) => setReference({ ...reference, code: event.target.value })} placeholder="# 在这里粘贴参考代码，或描述一个希望借鉴的数据新闻作品..." spellCheck={false} /></label>
            </div>
            <div className="reference-settings">
              <h3>迁移目标</h3>
              {(["方法模仿", "代码迁移", "作品借鉴"] as const).map((goal) => <button key={goal} className={reference.goal === goal ? "selected" : ""} onClick={() => setReference({ ...reference, goal })}><span>{goal}</span><CheckCircle size={18} weight={reference.goal === goal ? "fill" : "regular"} /></button>)}
              <label><span>希望保留或改变什么？</span><textarea rows={5} value={reference.note} onChange={(event) => setReference({ ...reference, note: event.target.value })} placeholder="例如：保留分组汇总逻辑，替换字段和配色，并解释每个参数。" /></label>
            </div>
          </div>
          <div className="transfer-grid"><div><Code size={20} /><strong>识别可复用逻辑</strong><p>区分方法、变量名与数据假设。</p></div><div><Database size={20} /><strong>适配新数据</strong><p>重新核对字段、类型与样本结构。</p></div><div><ShieldCheck size={20} /><strong>解释每项修改</strong><p>让迁移过程可理解、可复现。</p></div></div>
        </section>}

        {activeStage === "prompt" && <section className="stage-panel prompt-stage">
          <StageHeader index="06" title="分阶段与 AI 协作" description="先规划、再执行、最后核验。不要让一次性生成代替分析判断。" />
          <div className="prompt-controls">
            <div className="segmented" role="tablist" aria-label="提示词阶段">
              <button className={promptStage === "plan" ? "active" : ""} onClick={() => setPromptStage("plan")}>规划提示词</button>
              <button className={promptStage === "execute" ? "active" : ""} onClick={() => setPromptStage("execute")}>执行提示词</button>
              <button className={promptStage === "verify" ? "active" : ""} onClick={() => setPromptStage("verify")}>核验提示词</button>
            </div>
            <label className="mode-switch"><span>输出模式</span><select value={aiMode} onChange={(event) => setAiMode(event.target.value as AiMode)}><option value="agent">编程智能体</option><option value="chat">对话式 AI</option></select></label>
          </div>
          {aiMode === "agent" && <div className="agent-paths"><FieldInput label="本地项目目录" value={task.projectPath} placeholder="例如：C:\projects\air-quality" onChange={(value) => setTask({ ...task, projectPath: value })} /><FieldInput label="输出目录" value={task.outputPath} placeholder="例如：outputs/" onChange={(value) => setTask({ ...task, outputPath: value })} /></div>}
          <div className="prompt-workspace">
            <div className="prompt-document"><div className="document-bar"><span><FileText size={16} />{promptStage === "plan" ? "任务规划.md" : promptStage === "execute" ? "任务执行.md" : "结果核验.md"}</span><span>{prompt.length} 字符</span></div><pre>{prompt}</pre></div>
            <aside className="verification-panel">
              <h3>同步核验清单</h3><p>完成任务后逐项确认，进度会保存在当前浏览器。</p>
              <div className="check-list">{verificationItems.map((item) => <label key={item}><input type="checkbox" checked={checkedItems.includes(item)} onChange={() => setCheckedItems((current) => current.includes(item) ? current.filter((value) => value !== item) : [...current, item])} /><span>{item}</span></label>)}</div>
              <div className="check-progress"><strong>{checkedItems.filter((item) => verificationItems.includes(item)).length} / {verificationItems.length}</strong><span>已核验</span></div>
            </aside>
          </div>
          <div className="prompt-actions"><button className="secondary-button" onClick={downloadPrompt}><DownloadSimple size={17} />下载 Markdown</button><button className="primary-button" onClick={copyPrompt}><ClipboardText size={17} />复制当前提示词</button></div>
        </section>}

        <div className="stage-footer">
          <button className="quiet-button" disabled={currentIndex === 0} onClick={() => go(-1)}><ArrowLeft size={17} />上一步</button>
          <div><span>课程任务进度</span><strong>{currentIndex + 1} / {STAGES.length}</strong></div>
          <button className="primary-button" disabled={currentIndex === STAGES.length - 1} onClick={() => go(1)}>下一步<ArrowRight size={17} /></button>
        </div>
      </main>

      <aside className="inspector">
        <div className="inspector-head"><span>任务概览</span><strong>{completion}%</strong></div>
        <div className="progress-line"><i style={{ width: `${completion}%` }} /></div>
        <dl>
          <div><dt>数据集</dt><dd>{dataset.name || "尚未命名"}</dd></div>
          <div><dt>字段</dt><dd>{fields.length ? `${selectedFieldCount} / ${fields.length} 已选` : "尚未导入"}</dd></div>
          <div><dt>清洗诊断</dt><dd>{cleaningReport ? `${cleaningReport.summary.qualityScore} 分 / ${cleaningReport.summary.issueCount} 项问题` : "尚未运行"}</dd></div>
          <div><dt>研究问题</dt><dd>{task.question || "尚未定义"}</dd></div>
          <div><dt>策略</dt><dd>{selectedStrategies.length ? `分析 ${selectedAnalysisIds.length} 项 / 图表 ${selectedVisualizationIds.length} 项` : "尚未选择"}</dd></div>
          <div><dt>参考材料</dt><dd>{reference.code.trim() ? reference.goal : "未添加"}</dd></div>
        </dl>
        <div className="inspector-tip"><Lightbulb size={18} /><p>{activeStage === "dataset" ? "系统推断只是起点。请根据数据来源确认字段真实含义。" : activeStage === "cleaning" ? "质量规则只能发现线索。删除、填补或合并记录前仍需核对业务含义。" : activeStage === "task" ? "一个好问题通常包含对象、时间、指标和比较关系。" : activeStage === "strategy" ? "方法越复杂，越需要说明适用条件与证据边界。" : activeStage === "reference" ? "借鉴案例时，先区分可复用逻辑与原数据特有假设。" : "建议先把规划提示词交给 AI，确认方案后再执行。"}</p></div>
      </aside>
      {toast && <div className="toast" role="status"><CheckCircle size={18} weight="fill" />{toast}</div>}
    </div>
  );
}

function StageHeader({ index, title, description }: { index: string; title: string; description: string }) {
  return <header className="stage-header"><span>{index}</span><div><h1>{title}</h1><p>{description}</p></div></header>;
}

function FieldInput({ label, value, placeholder, help, onChange }: { label: string; value: string; placeholder: string; help?: string; onChange: (value: string) => void }) {
  return <label className="text-field"><span>{label}</span><input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />{help && <small>{help}</small>}</label>;
}

function CleaningReportPanel({ status, error, report, onRetry, onCopyCode, onDownload }: {
  status: CleaningStatus;
  error: string;
  report: CleaningReport | null;
  onRetry: () => void;
  onCopyCode: (code: string) => void;
  onDownload: () => void;
}) {
  if (status === "loading") return <div className="cleaning-report loading-report" aria-label="正在生成质量诊断报告"><div className="report-skeleton-head"><i /><i /></div>{[1, 2, 3, 4].map((item) => <div className="report-skeleton-row" key={item}><i /><i /><i /></div>)}</div>;
  if (status === "error") return <div className="cleaning-report report-state"><WarningCircle size={31} weight="fill" /><h3>诊断未完成</h3><p>{error}</p><button className="secondary-button" onClick={onRetry}>重新尝试</button></div>;
  if (!report) return <div className="cleaning-report report-state"><MagnifyingGlass size={31} /><h3>等待运行质量诊断</h3><p>报告将在这里展示质量分、问题证据、处理建议和可复用代码。</p></div>;

  return <div className="cleaning-report report-ready">
    <header className="report-overview">
      <div className={`quality-score ${report.status}`}><strong>{report.summary.qualityScore}</strong><span>数据质量分</span></div>
      <div><h3>{report.status === "healthy" ? "当前数据质量良好" : report.status === "critical" ? "存在需要优先处理的问题" : "存在需要复核的数据问题"}</h3><p>质量规则引擎已完成 {report.dimensions.length} 个维度的检测。</p></div>
      <button className="secondary-button" onClick={onDownload}><DownloadSimple size={16} />下载报告</button>
    </header>
    <div className="report-metrics">
      <div><span>检测记录</span><strong>{report.summary.rowsAnalyzed}</strong></div>
      <div><span>字段数量</span><strong>{report.summary.columns}</strong></div>
      <div><span>问题总数</span><strong>{report.summary.issueCount}</strong></div>
      <div><span>高风险</span><strong>{report.summary.criticalCount}</strong></div>
    </div>
    {report.summary.sampled && <div className="report-sample-note"><WarningCircle size={15} />数据共有 {report.summary.totalRows} 条，本次按前 {report.summary.rowsAnalyzed} 条生成诊断，建议对完整数据复核。</div>}
    <div className="dimension-results">
      {report.dimensions.map((dimension) => <details key={dimension.id} open={dimension.status !== "pass"}>
        <summary>
          <span className={`dimension-status ${dimension.status}`}>{dimension.status === "pass" ? <CheckCircle size={17} weight="fill" /> : <WarningCircle size={17} weight="fill" />}</span>
          <span><strong>{dimension.title}</strong><small>{dimension.summary}</small></span>
          <em>{dimension.metric}</em>
        </summary>
        <div className="finding-list">
          {dimension.findings.length ? dimension.findings.map((finding, index) => <article className="finding" key={`${finding.title}-${index}`}>
            <div className="finding-copy"><span className={`risk-label ${finding.level}`}>{finding.level === "high" ? "高风险" : finding.level === "medium" ? "需处理" : "待复核"}</span><h4>{finding.title}</h4><p>{finding.detail}</p></div>
            <div className="finding-advice"><strong>处理建议</strong><p>{finding.suggestedAction}</p></div>
            <div className="finding-code"><div><span>建议操作代码</span><button type="button" onClick={() => onCopyCode(finding.code)}><Copy size={14} />复制</button></div><pre>{finding.code}</pre></div>
          </article>) : <div className="dimension-pass"><CheckCircle size={18} weight="fill" />当前规则未发现明显问题，无需自动处理。</div>}
        </div>
      </details>)}
    </div>
  </div>;
}

function StrategySection({ strategies, selectedIds, selectedAnalysisIds = [], onToggle, locked = false }: {
  strategies: Strategy[];
  selectedIds: string[];
  selectedAnalysisIds?: string[];
  onToggle: (id: string) => void;
  locked?: boolean;
}) {
  return <div className="strategy-list">{strategies.map((strategy) => {
    const selected = selectedIds.includes(strategy.id);
    const matched = Boolean(strategy.relatedAnalysis?.some((id) => selectedAnalysisIds.includes(id)));
    return <button key={strategy.id} type="button" disabled={locked} className={`strategy-row ${selected ? "selected" : ""} ${matched ? "matched" : ""}`} onClick={() => onToggle(strategy.id)}>
      <span className="strategy-check">{selected && <Check size={16} weight="bold" />}</span>
      <span className="strategy-main">
        <span className="strategy-title"><strong>{strategy.title}</strong>{matched && <em>匹配已选分析</em>}</span>
        <small>{strategy.summary}</small>
        {strategy.methods && <span className="method-tags">{strategy.methods.map((method) => <i key={method}>{method}</i>)}</span>}
      </span>
      <span className="strategy-detail"><em>适用条件</em>{strategy.condition}</span>
      <span className="strategy-warning"><WarningCircle size={16} />{strategy.caution}</span>
    </button>;
  })}</div>;
}

function EmptyState({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <div className="empty-state">{icon}<strong>{title}</strong><p>{text}</p></div>;
}

export default App;
