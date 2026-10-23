export type CleaningDimensionId = "completeness" | "uniqueness" | "types" | "outliers" | "categories" | "structure";
export type FindingLevel = "high" | "medium" | "low";

export type CleaningField = {
  name: string;
  role: "数值" | "分类" | "时间" | "地理" | "文本" | "标识";
};

export type CleaningFinding = {
  level: FindingLevel;
  title: string;
  detail: string;
  fields: string[];
  suggestedAction: string;
  code: string;
};

export type CleaningDimensionReport = {
  id: CleaningDimensionId;
  title: string;
  status: "pass" | "warning" | "critical";
  metric: string;
  summary: string;
  findings: CleaningFinding[];
};

export type CleaningReport = {
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
  dimensions: CleaningDimensionReport[];
};

export type CleaningRequest = {
  rows: Array<Record<string, unknown>>;
  fields: CleaningField[];
  dimensions: CleaningDimensionId[];
  totalRows?: number;
};

const TITLES: Record<CleaningDimensionId, string> = {
  completeness: "完整性与缺失值",
  uniqueness: "重复性与唯一性",
  types: "字段类型一致性",
  outliers: "数值异常与极端值",
  categories: "类别与文本规范",
  structure: "字段结构与可用性",
};

const MISSING_TOKENS = new Set(["", "na", "n/a", "null", "none", "nan", "-", "--", "缺失", "无", "未知"]);

function isMissing(value: unknown) {
  if (value === null || value === undefined) return true;
  if (typeof value !== "string") return false;
  return MISSING_TOKENS.has(value.trim().toLowerCase());
}

function quoted(value: string) {
  return JSON.stringify(value);
}

function dimensionStatus(findings: CleaningFinding[]): CleaningDimensionReport["status"] {
  if (findings.some((finding) => finding.level === "high")) return "critical";
  if (findings.length) return "warning";
  return "pass";
}

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const index = (values.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return values[lower];
  return values[lower] + (values[upper] - values[lower]) * (index - lower);
}

function normalizeCategory(value: unknown) {
  return String(value).normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("zh-CN");
}

function reportCompleteness(rows: Array<Record<string, unknown>>, fields: CleaningField[]): CleaningDimensionReport {
  const findings: CleaningFinding[] = [];
  let missingCells = 0;
  for (const field of fields) {
    const count = rows.reduce((total, row) => total + (isMissing(row[field.name]) ? 1 : 0), 0);
    missingCells += count;
    if (!count) continue;
    const rate = rows.length ? count / rows.length : 0;
    findings.push({
      level: rate >= 0.2 ? "high" : rate >= 0.05 ? "medium" : "low",
      title: `${field.name} 存在缺失`,
      detail: `${count} 条记录为空或使用特殊缺失编码，占 ${Math.round(rate * 1000) / 10}%。`,
      fields: [field.name],
      suggestedAction: rate >= 0.2 ? "先确认缺失机制和业务含义，再决定删除、保留或分组填补。" : "核对缺失是否集中在特定时间或群体，并在分析中说明处理方式。",
      code: `missing_rate = df[${quoted(field.name)}].isna().mean()\n# 处理规则确认后再执行，例如：df = df.dropna(subset=[${quoted(field.name)}])`,
    });
  }
  const totalCells = rows.length * fields.length;
  return {
    id: "completeness",
    title: TITLES.completeness,
    status: dimensionStatus(findings),
    metric: `${missingCells} 个缺失单元格`,
    summary: findings.length ? `发现 ${findings.length} 个字段存在缺失。` : "未发现空值或常见特殊缺失编码。",
    findings,
  };
}

function reportUniqueness(rows: Array<Record<string, unknown>>, fields: CleaningField[]): CleaningDimensionReport {
  const findings: CleaningFinding[] = [];
  const rowKeys = rows.map((row) => JSON.stringify(fields.map((field) => row[field.name] ?? null)));
  const duplicateRows = rowKeys.length - new Set(rowKeys).size;
  if (duplicateRows > 0) {
    const level: FindingLevel = duplicateRows / Math.max(rows.length, 1) >= 0.05 ? "high" : "medium";
    findings.push({
      level,
      title: "发现完全重复记录",
      detail: `${duplicateRows} 条记录与此前记录完全相同。`,
      fields: fields.map((field) => field.name),
      suggestedAction: "先确认记录单位和重复产生原因，再保留第一条、最后一条或合并记录。",
      code: `duplicate_rows = df.duplicated(keep=False)\n# 核对后再执行：df = df.drop_duplicates(keep="first")`,
    });
  }
  for (const field of fields.filter((item) => item.role === "标识")) {
    const values = rows.map((row) => row[field.name]).filter((value) => !isMissing(value)).map(String);
    const repeated = values.length - new Set(values).size;
    if (!repeated) continue;
    findings.push({
      level: "high",
      title: `${field.name} 不是唯一标识`,
      detail: `非空标识中有 ${repeated} 条重复值。`,
      fields: [field.name],
      suggestedAction: "核对该字段是否真的是主键，或改用多个字段组合识别一条记录。",
      code: `duplicate_ids = df[df.duplicated(subset=[${quoted(field.name)}], keep=False)].sort_values(${quoted(field.name)})`,
    });
  }
  return {
    id: "uniqueness",
    title: TITLES.uniqueness,
    status: dimensionStatus(findings),
    metric: `${duplicateRows} 条完全重复`,
    summary: findings.length ? `发现 ${findings.length} 类重复或唯一性问题。` : "未发现完全重复记录，已标记的标识字段保持唯一。",
    findings,
  };
}

function reportTypes(rows: Array<Record<string, unknown>>, fields: CleaningField[]): CleaningDimensionReport {
  const findings: CleaningFinding[] = [];
  let invalidTotal = 0;
  for (const field of fields) {
    const values = rows.map((row) => row[field.name]).filter((value) => !isMissing(value));
    let invalid: unknown[] = [];
    if (field.role === "数值") invalid = values.filter((value) => typeof value !== "number" && Number.isNaN(Number(String(value).replace(/,/g, ""))));
    if (field.role === "时间") invalid = values.filter((value) => Number.isNaN(Date.parse(String(value))));
    if (!invalid.length) continue;
    invalidTotal += invalid.length;
    findings.push({
      level: invalid.length / Math.max(values.length, 1) >= 0.1 ? "high" : "medium",
      title: `${field.name} 与确认类型不一致`,
      detail: `${invalid.length} 个非空值无法按“${field.role}”解析，样例：${invalid.slice(0, 3).map(String).join("、")}。`,
      fields: [field.name],
      suggestedAction: "保留原字段，新建转换字段，并将转换失败的记录单独列出复核。",
      code: field.role === "数值"
        ? `df[${quoted(`${field.name}_数值`)}] = pd.to_numeric(df[${quoted(field.name)}].astype(str).str.replace(",", ""), errors="coerce")`
        : `df[${quoted(`${field.name}_日期`)}] = pd.to_datetime(df[${quoted(field.name)}], errors="coerce")`,
    });
  }
  return {
    id: "types",
    title: TITLES.types,
    status: dimensionStatus(findings),
    metric: `${invalidTotal} 个解析失败值`,
    summary: findings.length ? `发现 ${findings.length} 个字段存在类型冲突。` : "数值与时间字段均可按已确认角色解析。",
    findings,
  };
}

function reportOutliers(rows: Array<Record<string, unknown>>, fields: CleaningField[]): CleaningDimensionReport {
  const findings: CleaningFinding[] = [];
  let outlierTotal = 0;
  for (const field of fields.filter((item) => item.role === "数值")) {
    const values = rows.map((row) => Number(row[field.name])).filter(Number.isFinite).sort((a, b) => a - b);
    if (values.length < 4) continue;
    const q1 = percentile(values, 0.25);
    const q3 = percentile(values, 0.75);
    const iqr = q3 - q1;
    if (iqr === 0) continue;
    const lower = q1 - 1.5 * iqr;
    const upper = q3 + 1.5 * iqr;
    const outliers = values.filter((value) => value < lower || value > upper);
    if (!outliers.length) continue;
    outlierTotal += outliers.length;
    findings.push({
      level: outliers.length / values.length >= 0.1 ? "medium" : "low",
      title: `${field.name} 出现统计异常值`,
      detail: `按 1.5 倍四分位距规则标记 ${outliers.length} 个值，参考区间为 ${lower.toFixed(2)} 至 ${upper.toFixed(2)}。`,
      fields: [field.name],
      suggestedAction: "异常值只是复核线索。先对照原始来源和业务背景，不要自动删除。",
      code: `q1, q3 = df[${quoted(field.name)}].quantile([0.25, 0.75])\niqr = q3 - q1\noutliers = df[(df[${quoted(field.name)}] < q1 - 1.5 * iqr) | (df[${quoted(field.name)}] > q3 + 1.5 * iqr)]`,
    });
  }
  return {
    id: "outliers",
    title: TITLES.outliers,
    status: dimensionStatus(findings),
    metric: `${outlierTotal} 个待复核值`,
    summary: findings.length ? `在 ${findings.length} 个数值字段中标记了极端值。` : "未发现符合四分位距规则的明显异常值。",
    findings,
  };
}

function reportCategories(rows: Array<Record<string, unknown>>, fields: CleaningField[]): CleaningDimensionReport {
  const findings: CleaningFinding[] = [];
  for (const field of fields.filter((item) => ["分类", "地理", "文本"].includes(item.role))) {
    const variants = new Map<string, Set<string>>();
    for (const row of rows) {
      const value = row[field.name];
      if (isMissing(value)) continue;
      const raw = String(value);
      const normalized = normalizeCategory(raw);
      const current = variants.get(normalized) ?? new Set<string>();
      current.add(raw);
      variants.set(normalized, current);
    }
    const conflicts = [...variants.values()].filter((items) => items.size > 1);
    if (!conflicts.length) continue;
    findings.push({
      level: "medium",
      title: `${field.name} 存在格式不同的同类标签`,
      detail: `发现 ${conflicts.length} 组可能应合并的类别，例如：${[...conflicts[0]].slice(0, 4).join("、")}。`,
      fields: [field.name],
      suggestedAction: "建立原值到标准值的映射表，保留原字段，并记录每条归并规则。",
      code: `df[${quoted(`${field.name}_标准`)}] = df[${quoted(field.name)}].astype("string").str.normalize("NFKC").str.strip().str.replace(r"\\s+", " ", regex=True)`,
    });
  }
  return {
    id: "categories",
    title: TITLES.categories,
    status: dimensionStatus(findings),
    metric: `${findings.length} 个字段待规范`,
    summary: findings.length ? "发现空格、大小写或全角半角造成的疑似同类标签。" : "未发现明显的类别格式冲突。",
    findings,
  };
}

function reportStructure(rows: Array<Record<string, unknown>>, fields: CleaningField[]): CleaningDimensionReport {
  const findings: CleaningFinding[] = [];
  for (const field of fields) {
    const values = rows.map((row) => row[field.name]).filter((value) => !isMissing(value));
    const unique = new Set(values.map(String));
    if (!values.length) {
      findings.push({
        level: "high",
        title: `${field.name} 为全空字段`,
        detail: "当前检测范围内没有任何有效值。",
        fields: [field.name],
        suggestedAction: "确认导入范围和字段映射；若业务上确实无用，可在记录理由后移除。",
        code: `# 核对后再执行：df = df.drop(columns=[${quoted(field.name)}])`,
      });
    } else if (unique.size === 1) {
      findings.push({
        level: "low",
        title: `${field.name} 为常量字段`,
        detail: `所有非空记录均为“${[...unique][0]}”，通常无法解释记录间差异。`,
        fields: [field.name],
        suggestedAction: "确认该字段是否用于说明数据范围。若不参与分析，可从建模和绘图字段中排除。",
        code: `constant_columns = [c for c in df.columns if df[c].nunique(dropna=True) <= 1]`,
      });
    } else if (field.role === "分类" && unique.size / values.length > 0.9 && values.length >= 20) {
      findings.push({
        level: "low",
        title: `${field.name} 的类别基数过高`,
        detail: `${values.length} 个非空值中有 ${unique.size} 个不同取值，可能更接近标识或自由文本。`,
        fields: [field.name],
        suggestedAction: "重新确认字段角色，避免将近乎唯一的字段直接用于分组或配色。",
        code: `cardinality = df[${quoted(field.name)}].nunique(dropna=True) / df[${quoted(field.name)}].notna().sum()`,
      });
    }
  }
  return {
    id: "structure",
    title: TITLES.structure,
    status: dimensionStatus(findings),
    metric: `${findings.length} 个结构提示`,
    summary: findings.length ? "发现全空、常量或角色可能不匹配的字段。" : "字段均包含可用于分析的变化信息。",
    findings,
  };
}

const REPORTERS: Record<CleaningDimensionId, (rows: Array<Record<string, unknown>>, fields: CleaningField[]) => CleaningDimensionReport> = {
  completeness: reportCompleteness,
  uniqueness: reportUniqueness,
  types: reportTypes,
  outliers: reportOutliers,
  categories: reportCategories,
  structure: reportStructure,
};

export function diagnoseDataset(request: CleaningRequest): CleaningReport {
  const rows = Array.isArray(request.rows) ? request.rows.slice(0, 10000) : [];
  const fields = Array.isArray(request.fields) ? request.fields.filter((field) => field && typeof field.name === "string") : [];
  const requested = Array.isArray(request.dimensions) ? request.dimensions : [];
  const dimensions = requested.filter((id): id is CleaningDimensionId => id in REPORTERS).map((id) => REPORTERS[id](rows, fields));
  const findings = dimensions.flatMap((dimension) => dimension.findings);
  const criticalCount = findings.filter((finding) => finding.level === "high").length;
  const penalty = findings.reduce((total, finding) => total + (finding.level === "high" ? 12 : finding.level === "medium" ? 6 : 3), 0);
  const qualityScore = Math.max(0, 100 - Math.min(100, penalty));
  const totalRows = Math.max(Number(request.totalRows) || rows.length, rows.length);
  return {
    generatedAt: new Date().toISOString(),
    source: "analysis-service",
    status: criticalCount ? "critical" : findings.length ? "attention" : "healthy",
    summary: {
      rowsAnalyzed: rows.length,
      totalRows,
      columns: fields.length,
      issueCount: findings.length,
      criticalCount,
      qualityScore,
      sampled: totalRows > rows.length,
    },
    dimensions,
  };
}
