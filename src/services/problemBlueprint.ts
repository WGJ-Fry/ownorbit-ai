export const PROBLEM_BLUEPRINT_MAX_INPUT_CHARS = 900;

export type ProblemBlueprintCategory =
  | "ledger"
  | "planner"
  | "organizer"
  | "habit"
  | "calculator"
  | "form"
  | "workflow"
  | "lookup"
  | "general";

export type ProblemBlueprintStep = {
  id: string;
  title: string;
  detail: string;
  artifact: string;
};

export type ProblemBlueprintReadinessCheck = {
  id: "template-match" | "input-output" | "quality-gates" | "permission-boundary" | "version-safety" | "repair-loop";
  label: string;
  detail: string;
  status: "ready" | "review" | "blocked";
  weight: number;
};

export type ProblemBlueprintReadiness = {
  score: number;
  level: "draft" | "review" | "ready";
  checks: ProblemBlueprintReadinessCheck[];
  nextActions: string[];
};

export type ProblemBlueprintQualityDimension = {
  id: "task-fit" | "data-safety" | "interaction-completeness" | "state-reliability" | "repairability" | "permission-safety";
  label: string;
  score: number;
  status: "pass" | "review" | "blocked";
  evidence: string;
};

export type ProblemBlueprintQualityScore = {
  score: number;
  level: "draft" | "usable" | "strong";
  dimensions: ProblemBlueprintQualityDimension[];
  acceptanceCriteria: string[];
  failureTriggers: string[];
};

export type ProblemBlueprintAutoRepairLoop = {
  mode: "guarded-auto-repair" | "manual-review" | "blocked";
  retryLimit: number;
  canAutoRepair: boolean;
  autoRepairSignals: string[];
  manualReviewSignals: string[];
  rollbackRule: string;
  verificationSteps: string[];
};

export type ProblemBlueprintTemplateOption = {
  id: string;
  category: ProblemBlueprintCategory;
  variantId: string;
  name: string;
  categoryLabel: string;
  role: "primary" | "alternative";
  matchScore: number;
  fitSummary: string;
  useCases: string[];
  inputs: string[];
  outputs: string[];
  qualityGates: string[];
  riskLevel: "low" | "medium" | "high";
  riskNotes: string[];
  reason: string;
};

export type ProblemBlueprint = {
  isReady: boolean;
  language: "zh-CN" | "en-US";
  category: ProblemBlueprintCategory;
  templateId: string;
  templateName: string;
  templateLibrary: ProblemBlueprintTemplateOption[];
  templateFit: string[];
  templateChecklist: string[];
  templateInputs: string[];
  templateOutputs: string[];
  templateQualityGates: string[];
  templateDangerousActions: string[];
  templateReadiness: ProblemBlueprintReadiness;
  qualityScore: ProblemBlueprintQualityScore;
  autoRepairLoop: ProblemBlueprintAutoRepairLoop;
  categoryLabel: string;
  suggestedAppName: string;
  summary: string;
  normalizedProblem: string;
  steps: ProblemBlueprintStep[];
  suggestedModules: string[];
  versioningPlan: string[];
  versionDiffChecklist: string[];
  confirmationChecklist: string[];
  permissionNotes: string[];
  capabilityReview: string[];
  failureRecovery: string[];
  repairLoop: string[];
  repairPrompts: string[];
  riskNotes: string[];
  appPrompt: string;
};

type CategoryProfile = {
  labelZh: string;
  labelEn: string;
  appNameZh: string;
  appNameEn: string;
  templateNameZh: string;
  templateNameEn: string;
  keywords: string[];
  modulesZh: string[];
  modulesEn: string[];
  templateFitZh: string[];
  templateFitEn: string[];
  risksZh: string[];
  risksEn: string[];
  permissionZh: string[];
  permissionEn: string[];
  repairZh: string[];
  repairEn: string[];
};

type TemplateContract = {
  inputsZh: string[];
  inputsEn: string[];
  outputsZh: string[];
  outputsEn: string[];
  qualityGatesZh: string[];
  qualityGatesEn: string[];
  dangerousActionsZh: string[];
  dangerousActionsEn: string[];
};

type TemplateVariant = {
  id: string;
  nameZh: string;
  nameEn: string;
  useCasesZh: string[];
  useCasesEn: string[];
  fitZh: string;
  fitEn: string;
  qualityGateZh: string;
  qualityGateEn: string;
  riskLevel?: ProblemBlueprintTemplateOption["riskLevel"];
};

const categoryProfiles: Record<ProblemBlueprintCategory, CategoryProfile> = {
  ledger: {
    labelZh: "记账/收支",
    labelEn: "Ledger",
    appNameZh: "智能记账处理台",
    appNameEn: "Smart Ledger Console",
    templateNameZh: "收支台账模板",
    templateNameEn: "Income and expense ledger template",
    keywords: ["记账", "账单", "支出", "收入", "预算", "报销", "invoice", "expense", "budget", "receipt", "ledger"],
    modulesZh: ["收入/支出录入", "分类汇总", "预算提醒", "本地持久化"],
    modulesEn: ["income/expense entry", "category summary", "budget warning", "local persistence"],
    templateFitZh: ["适合月度预算、报销整理、账单分类和轻量财务复盘。", "默认生成可编辑示例数据、分类筛选、汇总视图和 CSV 导出确认。"],
    templateFitEn: ["Fits monthly budgets, reimbursement sorting, bill categorization, and lightweight finance reviews.", "Defaults to editable sample data, category filters, summary views, and CSV export confirmation."],
    risksZh: ["不要在程序里保存银行卡号、身份证号或完整支付凭证。"],
    risksEn: ["Do not store bank card numbers, IDs, or full payment credentials in the generated app."],
    permissionZh: ["默认只使用浏览器本地存储。", "导出 CSV 前让用户确认字段。"],
    permissionEn: ["Use browser local storage by default.", "Confirm fields before exporting CSV."],
    repairZh: ["如果分类汇总不对，只修分类规则和计算公式。", "如果预算提醒误报，先展示阈值和触发记录再修。"],
    repairEn: ["If category totals are wrong, patch only the category rules and formulas.", "If budget warnings misfire, show thresholds and trigger records before patching."],
  },
  planner: {
    labelZh: "规划/排程",
    labelEn: "Planner",
    appNameZh: "目标规划执行台",
    appNameEn: "Goal Planning Console",
    templateNameZh: "目标拆解模板",
    templateNameEn: "Goal breakdown template",
    keywords: ["规划", "计划", "日程", "安排", "项目", "路线", "plan", "schedule", "roadmap", "calendar", "project"],
    modulesZh: ["目标拆解", "优先级排序", "时间块", "进度检查"],
    modulesEn: ["goal breakdown", "priority sorting", "time blocks", "progress checks"],
    templateFitZh: ["适合把目标拆成任务、时间块、优先级和检查点。", "默认不写入外部日历，只生成可调整的本地计划面板。"],
    templateFitEn: ["Fits turning goals into tasks, time blocks, priorities, and checkpoints.", "Does not write to external calendars by default; generates an editable local planning board."],
    risksZh: ["规划建议需要用户确认，不能自动替用户承诺时间或发送消息。"],
    risksEn: ["Planning suggestions need user confirmation and must not automatically commit time or send messages."],
    permissionZh: ["不自动写入日历或发送消息。", "任何外部动作都必须先弹出确认。"],
    permissionEn: ["Do not write to calendars or send messages automatically.", "Require confirmation before any external action."],
    repairZh: ["如果任务拆解过粗，要求按天、优先级或里程碑重排。", "如果时间块冲突，先列出冲突项再修排程逻辑。"],
    repairEn: ["If breakdown is too coarse, regenerate by day, priority, or milestone.", "If time blocks conflict, list conflicts before patching scheduling logic."],
  },
  organizer: {
    labelZh: "整理/归档",
    labelEn: "Organizer",
    appNameZh: "信息整理工作台",
    appNameEn: "Information Organizer",
    templateNameZh: "信息归档模板",
    templateNameEn: "Information organizer template",
    keywords: ["整理", "归档", "分类", "清单", "资料", "笔记", "organize", "sort", "archive", "notes", "inventory"],
    modulesZh: ["批量条目", "标签分类", "筛选搜索", "导出摘要"],
    modulesEn: ["batch entries", "tag grouping", "search/filter", "summary export"],
    templateFitZh: ["适合把散乱资料整理成清单、标签、摘要和可检索视图。", "默认保留原始条目和整理结果，方便人工复核。"],
    templateFitEn: ["Fits turning messy material into lists, tags, summaries, and searchable views.", "Keeps original entries alongside organized output for manual review."],
    risksZh: ["导入资料前先去掉密钥、地址、手机号等敏感字段。"],
    risksEn: ["Remove keys, addresses, phone numbers, and other sensitive fields before importing data."],
    permissionZh: ["导入文本只在当前程序内处理。", "导出摘要前显示预览。"],
    permissionEn: ["Imported text is handled inside the generated app only.", "Show a preview before exporting summaries."],
    repairZh: ["如果标签分错，要求只调整标签规则并保留原始数据。", "如果摘要遗漏，要求显示被引用的原文片段再修。"],
    repairEn: ["If tags are wrong, patch only tagging rules and preserve source data.", "If summaries omit details, show cited source snippets before patching."],
  },
  habit: {
    labelZh: "打卡/习惯",
    labelEn: "Habit",
    appNameZh: "打卡追踪面板",
    appNameEn: "Habit Tracking Board",
    templateNameZh: "打卡追踪模板",
    templateNameEn: "Habit tracking template",
    keywords: ["打卡", "习惯", "签到", "复盘", "训练", "habit", "check-in", "routine", "streak", "review"],
    modulesZh: ["每日打卡", "连续天数", "复盘记录", "趋势面板"],
    modulesEn: ["daily check-in", "streak counter", "review notes", "trend panel"],
    templateFitZh: ["适合习惯打卡、复盘、连续天数和趋势记录。", "默认支持补记和撤销，避免误点破坏连续记录。"],
    templateFitEn: ["Fits habit check-ins, reviews, streaks, and trend tracking.", "Supports backfill and undo by default so accidental taps do not corrupt streaks."],
    risksZh: ["健康、训练、用药等场景只做记录提醒，不替代专业建议。"],
    risksEn: ["Health, training, and medication scenarios are for tracking only, not professional advice."],
    permissionZh: ["只做本地记录和提醒文案。", "不自动发送健康、训练或用药结论。"],
    permissionEn: ["Keep tracking and reminder copy local.", "Do not automatically send health, training, or medication conclusions."],
    repairZh: ["如果连续天数不准，优先修日期边界和补记规则。", "如果趋势图误导，改成显示原始记录和简单统计。"],
    repairEn: ["If streaks are wrong, patch date boundaries and backfill rules first.", "If trend charts mislead, switch to raw records plus simple stats."],
  },
  calculator: {
    labelZh: "计算/换算",
    labelEn: "Calculator",
    appNameZh: "计算辅助器",
    appNameEn: "Calculation Helper",
    templateNameZh: "参数计算模板",
    templateNameEn: "Parameter calculator template",
    keywords: ["计算", "换算", "公式", "报价", "利息", "税", "calculate", "formula", "quote", "interest", "tax"],
    modulesZh: ["参数输入", "公式结果", "场景对比", "校验提示"],
    modulesEn: ["parameter inputs", "formula result", "scenario comparison", "validation hints"],
    templateFitZh: ["适合报价、换算、税费、利息和方案对比。", "默认展示公式、输入校验和人工复核提示。"],
    templateFitEn: ["Fits quotes, conversions, tax, interest, and scenario comparison.", "Shows formulas, validation, and manual review prompts by default."],
    risksZh: ["金额、税务、投资结果需要标注为估算，并保留人工复核入口。"],
    risksEn: ["Money, tax, and investment results should be marked as estimates with a manual review path."],
    permissionZh: ["计算结果标记为估算。", "高风险金额结果必须显示人工复核提示。"],
    permissionEn: ["Mark calculation results as estimates.", "Show manual review guidance for high-impact money results."],
    repairZh: ["如果公式错误，只修公式并显示修复前后样例。", "如果单位不清楚，先要求用户确认单位再重新计算。"],
    repairEn: ["If a formula is wrong, patch only the formula and show before/after examples.", "If units are unclear, ask for unit confirmation before recalculating."],
  },
  form: {
    labelZh: "表单/收集",
    labelEn: "Form",
    appNameZh: "表单收集器",
    appNameEn: "Form Collector",
    templateNameZh: "本地表单模板",
    templateNameEn: "Local form template",
    keywords: ["表单", "收集", "登记", "问卷", "报名", "form", "survey", "register", "intake"],
    modulesZh: ["字段配置", "填写校验", "结果列表", "本地导出"],
    modulesEn: ["field setup", "input validation", "result list", "local export"],
    templateFitZh: ["适合登记、问卷、报名、申请和内部收集。", "默认支持字段说明、必填校验、预览和导出确认。"],
    templateFitEn: ["Fits registration, surveys, signups, requests, and internal collection.", "Supports field help, required validation, preview, and export confirmation by default."],
    risksZh: ["不要默认收集身份证、精确住址、密钥等高敏字段。"],
    risksEn: ["Do not collect IDs, exact addresses, keys, or other highly sensitive fields by default."],
    permissionZh: ["新增敏感字段前要求用户确认。", "导出前显示字段和记录数量。"],
    permissionEn: ["Ask for confirmation before adding sensitive fields.", "Show fields and record count before export."],
    repairZh: ["如果字段不完整，新增字段前先列出会影响的记录。", "如果校验太严格，保留原始输入并放宽规则。"],
    repairEn: ["If fields are incomplete, list affected records before adding fields.", "If validation is too strict, preserve raw input and loosen rules."],
  },
  workflow: {
    labelZh: "流程/面板",
    labelEn: "Workflow",
    appNameZh: "流程控制面板",
    appNameEn: "Workflow Control Panel",
    templateNameZh: "流程看板模板",
    templateNameEn: "Workflow board template",
    keywords: ["流程", "审批", "面板", "看板", "状态", "workflow", "kanban", "pipeline", "status", "panel"],
    modulesZh: ["步骤看板", "状态切换", "阻塞项", "下一步建议"],
    modulesEn: ["step board", "status changes", "blockers", "next action suggestions"],
    templateFitZh: ["适合跟进线索、审批流、项目阶段和重复步骤面板。", "默认每次状态切换都保留时间和备注。"],
    templateFitEn: ["Fits lead follow-up, approvals, project stages, and repeated step boards.", "Keeps time and notes for every status transition by default."],
    risksZh: ["涉及删除、发送、支付、系统调用时必须保留二次确认。"],
    risksEn: ["Deleting, sending, payment, or system actions must keep explicit confirmation."],
    permissionZh: ["状态修改只影响本地流程数据。", "删除、发送、系统调用必须二次确认。"],
    permissionEn: ["Status changes affect only local workflow data.", "Deletion, sending, and system calls require a second confirmation."],
    repairZh: ["如果状态流转不对，只修状态机和按钮条件。", "如果误删风险较高，改成归档并增加撤销。"],
    repairEn: ["If state transitions are wrong, patch only the state machine and button guards.", "If deletion risk is high, switch to archive plus undo."],
  },
  lookup: {
    labelZh: "查询/检索",
    labelEn: "Lookup",
    appNameZh: "查询整理助手",
    appNameEn: "Lookup Assistant",
    templateNameZh: "查询整理模板",
    templateNameEn: "Lookup organizer template",
    keywords: ["查询", "检索", "搜索", "资料库", "知识库", "lookup", "search", "database", "knowledge"],
    modulesZh: ["查询输入", "结果筛选", "引用记录", "离线缓存"],
    modulesEn: ["query input", "result filtering", "source notes", "offline cache"],
    templateFitZh: ["适合资料查询、知识库检索、结果筛选和引用记录。", "默认展示来源、更新时间和缓存状态。"],
    templateFitEn: ["Fits reference lookup, knowledge-base search, result filtering, and source notes.", "Shows sources, update time, and cache state by default."],
    risksZh: ["联网查询结果要显示来源和时间，避免把过期信息当事实。"],
    risksEn: ["Web lookup results should show source and time to avoid treating stale information as fact."],
    permissionZh: ["联网查询必须显示来源和时间。", "缓存结果要标注更新时间。"],
    permissionEn: ["Web lookup must show source and timestamp.", "Cached results should show the last updated time."],
    repairZh: ["如果结果过期，要求刷新来源并标注更新时间。", "如果筛选不准，只修过滤条件和排序规则。"],
    repairEn: ["If results are stale, refresh sources and show update time.", "If filtering is wrong, patch filters and sorting only."],
  },
  general: {
    labelZh: "通用问题",
    labelEn: "General",
    appNameZh: "问题解决工作台",
    appNameEn: "Problem Solver Workspace",
    templateNameZh: "通用问题解决模板",
    templateNameEn: "General problem-solving template",
    keywords: [],
    modulesZh: ["目标输入", "步骤拆解", "结果记录", "继续调整"],
    modulesEn: ["goal input", "step breakdown", "result log", "continued refinement"],
    templateFitZh: ["适合还没有明确分类的真实问题。", "默认先生成目标、输入、输出和完成标准，再生成程序。"],
    templateFitEn: ["Fits real problems that do not have a clear category yet.", "Defines goal, inputs, outputs, and success criteria before generating the app."],
    risksZh: ["先让用户确认目标、输入数据和输出格式，再生成可执行程序。"],
    risksEn: ["Ask the user to confirm the goal, input data, and output format before generating a runnable app."],
    permissionZh: ["默认只处理用户输入的数据。", "外部动作和数据导出都需要确认。"],
    permissionEn: ["Handle only user-provided data by default.", "External actions and data export require confirmation."],
    repairZh: ["如果方向跑偏，先回到问题简报再重新生成。", "如果用户补充新条件，保留旧版本并生成新版本对比。"],
    repairEn: ["If direction drifts, return to the problem brief before regenerating.", "If the user adds constraints, keep the old version and generate a comparable new version."],
  },
};

const templateContracts: Record<ProblemBlueprintCategory, TemplateContract> = {
  ledger: {
    inputsZh: ["金额、类型、日期、分类、备注", "预算阈值和周期", "可选 CSV 粘贴导入"],
    inputsEn: ["amount, type, date, category, note", "budget threshold and period", "optional pasted CSV import"],
    outputsZh: ["本月收支汇总", "分类占比和超预算提醒", "可撤销的记录列表"],
    outputsEn: ["monthly income and expense summary", "category breakdown and budget warnings", "undoable transaction list"],
    qualityGatesZh: ["金额必须校验为有效数字", "删除和清空必须可撤销", "预算提醒要显示触发规则"],
    qualityGatesEn: ["amount must validate as a number", "delete and reset must be undoable", "budget warnings must show the trigger rule"],
    dangerousActionsZh: ["不得默认收集银行卡/身份证", "导出前必须预览字段", "不自动联网上传账单"],
    dangerousActionsEn: ["do not collect card or ID numbers by default", "preview fields before export", "do not upload bills automatically"],
  },
  planner: {
    inputsZh: ["目标、截止时间、可用时间", "优先级和限制条件", "可选里程碑"],
    inputsEn: ["goal, deadline, available time", "priority and constraints", "optional milestones"],
    outputsZh: ["任务拆解", "时间块安排", "冲突和下一步建议"],
    outputsEn: ["task breakdown", "time-block plan", "conflicts and next-action suggestions"],
    qualityGatesZh: ["每个任务必须有状态", "时间冲突要显式标出", "完成标准要可编辑"],
    qualityGatesEn: ["each task must have a status", "time conflicts must be visible", "success criteria must be editable"],
    dangerousActionsZh: ["不自动写入外部日历", "不自动替用户发送承诺", "外部动作必须二次确认"],
    dangerousActionsEn: ["do not write to external calendars automatically", "do not send commitments for the user", "external actions require confirmation"],
  },
  organizer: {
    inputsZh: ["原始文本/条目", "标签或分类规则", "整理目标"],
    inputsEn: ["raw text or entries", "tags or grouping rules", "organization goal"],
    outputsZh: ["标签化清单", "搜索/筛选视图", "可复制摘要"],
    outputsEn: ["tagged list", "search and filter view", "copyable summary"],
    qualityGatesZh: ["保留原始条目", "标签规则可修改", "摘要必须能追溯来源"],
    qualityGatesEn: ["preserve original entries", "tag rules must be editable", "summaries must trace back to source"],
    dangerousActionsZh: ["导入前提示移除敏感信息", "不默认上传资料", "导出摘要前预览"],
    dangerousActionsEn: ["prompt users to remove sensitive data before import", "do not upload material by default", "preview summaries before export"],
  },
  habit: {
    inputsZh: ["习惯名称、频率、目标", "每日记录和备注", "补记日期"],
    inputsEn: ["habit name, frequency, target", "daily record and note", "backfill date"],
    outputsZh: ["今日打卡状态", "连续天数和趋势", "复盘列表"],
    outputsEn: ["today's check-in status", "streak and trend", "review list"],
    qualityGatesZh: ["误点可撤销", "跨日边界清晰", "补记不破坏真实记录"],
    qualityGatesEn: ["accidental taps are undoable", "day boundary is explicit", "backfill does not corrupt real records"],
    dangerousActionsZh: ["健康/用药只做记录不做诊断", "不自动发送打卡结论", "提醒文案需用户确认"],
    dangerousActionsEn: ["health or medication is tracking only, not diagnosis", "do not send check-in conclusions automatically", "reminder copy needs user confirmation"],
  },
  calculator: {
    inputsZh: ["参数、单位、公式假设", "可选场景变量", "人工复核备注"],
    inputsEn: ["parameters, units, formula assumptions", "optional scenario variables", "manual review notes"],
    outputsZh: ["计算结果", "公式解释", "多场景对比"],
    outputsEn: ["calculation result", "formula explanation", "scenario comparison"],
    qualityGatesZh: ["单位必须显示", "结果标注为估算", "异常输入给出原因"],
    qualityGatesEn: ["units must be visible", "results are marked as estimates", "invalid inputs explain why"],
    dangerousActionsZh: ["不把金额结果当财务建议", "不自动提交报价/税务信息", "高影响结果需人工复核"],
    dangerousActionsEn: ["do not treat money results as financial advice", "do not submit quotes or tax data automatically", "high-impact results require manual review"],
  },
  form: {
    inputsZh: ["字段名、类型、必填状态", "说明文本", "填写记录"],
    inputsEn: ["field name, type, required state", "help text", "submitted records"],
    outputsZh: ["填写表单", "记录列表", "导出预览"],
    outputsEn: ["entry form", "record list", "export preview"],
    qualityGatesZh: ["必填和格式校验", "敏感字段显式标记", "导出显示记录数量"],
    qualityGatesEn: ["required and format validation", "sensitive fields are marked", "export shows record count"],
    dangerousActionsZh: ["不默认收集高敏字段", "删除记录必须确认", "导出前显示字段列表"],
    dangerousActionsEn: ["do not collect highly sensitive fields by default", "deleting records requires confirmation", "show field list before export"],
  },
  workflow: {
    inputsZh: ["流程阶段", "条目名称和负责人", "状态备注和阻塞项"],
    inputsEn: ["workflow stages", "item name and owner", "status note and blockers"],
    outputsZh: ["流程看板", "状态历史", "下一步动作"],
    outputsEn: ["workflow board", "status history", "next actions"],
    qualityGatesZh: ["状态切换可追溯", "归档优先于删除", "阻塞项必须可见"],
    qualityGatesEn: ["status transitions are traceable", "archive before delete", "blockers must be visible"],
    dangerousActionsZh: ["发送、删除、系统调用必须确认", "不自动审批或支付", "危险动作进入权限中心"],
    dangerousActionsEn: ["sending, deleting, and system calls require confirmation", "do not approve or pay automatically", "risky actions go through permission center"],
  },
  lookup: {
    inputsZh: ["查询词", "资料来源", "筛选条件"],
    inputsEn: ["query", "source list", "filters"],
    outputsZh: ["结果列表", "来源/时间标注", "缓存记录"],
    outputsEn: ["result list", "source and timestamp labels", "cache record"],
    qualityGatesZh: ["结果必须标注来源", "缓存要显示更新时间", "无结果时给改查建议"],
    qualityGatesEn: ["results must show source", "cache shows last updated time", "empty results suggest query changes"],
    dangerousActionsZh: ["联网查询必须说明来源", "不把过期缓存当事实", "不自动打开不可信链接"],
    dangerousActionsEn: ["web lookup must explain sources", "do not treat stale cache as fact", "do not open untrusted links automatically"],
  },
  general: {
    inputsZh: ["目标、输入数据、约束条件", "成功标准", "用户确认项"],
    inputsEn: ["goal, input data, constraints", "success criteria", "user confirmations"],
    outputsZh: ["问题简报", "可运行面板", "结果记录"],
    outputsEn: ["problem brief", "runnable panel", "result log"],
    qualityGatesZh: ["先确认目标再生成", "输出格式可编辑", "所有外部动作可撤销或可确认"],
    qualityGatesEn: ["confirm the goal before generation", "output format is editable", "all external actions are undoable or confirmable"],
    dangerousActionsZh: ["默认不联网、不发送、不删除", "新增危险能力必须解释原因", "保留回滚版本"],
    dangerousActionsEn: ["default to no network, sending, or deletion", "explain any new risky capability", "keep rollback versions"],
  },
};

const templateVariants: Record<ProblemBlueprintCategory, TemplateVariant[]> = {
  ledger: [
    { id: "core", nameZh: "收支台账模板", nameEn: "Income and expense ledger template", useCasesZh: ["月度预算", "分类汇总"], useCasesEn: ["monthly budget", "category summary"], fitZh: "适合日常收支、分类汇总和预算提醒。", fitEn: "Fits daily income/expense tracking, category totals, and budget warnings.", qualityGateZh: "预算提醒必须显示触发阈值。", qualityGateEn: "Budget warnings must show the trigger threshold.", riskLevel: "medium" },
    { id: "reimbursement", nameZh: "报销整理模板", nameEn: "Reimbursement organizer template", useCasesZh: ["报销单整理", "票据清单"], useCasesEn: ["expense claims", "receipt checklist"], fitZh: "适合把票据、用途、金额和状态整理成可导出清单。", fitEn: "Fits turning receipts, purpose, amount, and status into an exportable list.", qualityGateZh: "每条报销记录必须保留状态和备注。", qualityGateEn: "Every reimbursement item must keep status and notes.", riskLevel: "medium" },
    { id: "subscription", nameZh: "订阅续费模板", nameEn: "Subscription renewal template", useCasesZh: ["订阅管理", "续费提醒"], useCasesEn: ["subscription tracking", "renewal reminders"], fitZh: "适合管理订阅、续费日期、价格变化和取消提醒。", fitEn: "Fits subscriptions, renewal dates, price changes, and cancellation reminders.", qualityGateZh: "续费提醒必须显示日期来源和剩余天数。", qualityGateEn: "Renewal reminders must show date source and days remaining.", riskLevel: "low" },
  ],
  planner: [
    { id: "core", nameZh: "目标拆解模板", nameEn: "Goal breakdown template", useCasesZh: ["目标规划", "每日任务"], useCasesEn: ["goal planning", "daily tasks"], fitZh: "适合目标拆解、优先级和时间块。", fitEn: "Fits goal breakdown, priorities, and time blocks.", qualityGateZh: "每个任务必须有状态和完成标准。", qualityGateEn: "Every task must have status and success criteria.", riskLevel: "medium" },
    { id: "roadmap", nameZh: "项目路线图模板", nameEn: "Project roadmap template", useCasesZh: ["里程碑", "版本计划"], useCasesEn: ["milestones", "release plan"], fitZh: "适合把项目拆成阶段、风险、验收标准和下一步。", fitEn: "Fits phases, risks, acceptance criteria, and next actions.", qualityGateZh: "每个里程碑必须有验收标准。", qualityGateEn: "Every milestone must have acceptance criteria.", riskLevel: "medium" },
    { id: "agenda", nameZh: "会议行动项模板", nameEn: "Meeting action template", useCasesZh: ["会议纪要", "行动跟进"], useCasesEn: ["meeting notes", "action follow-up"], fitZh: "适合整理会议决定、负责人、截止时间和跟进状态。", fitEn: "Fits decisions, owners, deadlines, and follow-up status.", qualityGateZh: "行动项必须包含负责人或待确认状态。", qualityGateEn: "Action items need an owner or pending-confirmation state.", riskLevel: "low" },
  ],
  organizer: [
    { id: "core", nameZh: "信息归档模板", nameEn: "Information organizer template", useCasesZh: ["笔记整理", "资料归档"], useCasesEn: ["note sorting", "material archive"], fitZh: "适合标签、摘要、搜索和来源保留。", fitEn: "Fits tags, summaries, search, and source preservation.", qualityGateZh: "摘要必须能追溯原始条目。", qualityGateEn: "Summaries must trace back to source entries.", riskLevel: "low" },
    { id: "inventory", nameZh: "物品清单模板", nameEn: "Inventory list template", useCasesZh: ["资产清单", "搬家整理"], useCasesEn: ["asset list", "moving checklist"], fitZh: "适合记录物品、位置、状态、数量和处理结果。", fitEn: "Fits items, locations, status, quantity, and disposition.", qualityGateZh: "数量、位置和状态必须可筛选。", qualityGateEn: "Quantity, location, and status must be filterable.", riskLevel: "low" },
    { id: "research", nameZh: "资料研究模板", nameEn: "Research synthesis template", useCasesZh: ["资料对比", "观点整理"], useCasesEn: ["source comparison", "insight synthesis"], fitZh: "适合多来源资料对比、摘录、结论和未确认问题。", fitEn: "Fits comparing sources, excerpts, conclusions, and open questions.", qualityGateZh: "每个结论必须显示来源或未确认标记。", qualityGateEn: "Every conclusion needs a source or unverified marker.", riskLevel: "medium" },
  ],
  habit: [
    { id: "core", nameZh: "打卡追踪模板", nameEn: "Habit tracking template", useCasesZh: ["每日打卡", "复盘"], useCasesEn: ["daily check-in", "review"], fitZh: "适合每日记录、连续天数和趋势。", fitEn: "Fits daily records, streaks, and trends.", qualityGateZh: "误点必须可撤销。", qualityGateEn: "Accidental taps must be undoable.", riskLevel: "medium" },
    { id: "training", nameZh: "训练记录模板", nameEn: "Training log template", useCasesZh: ["运动训练", "练习复盘"], useCasesEn: ["workout log", "practice review"], fitZh: "适合记录训练项目、强度、反馈和恢复状态。", fitEn: "Fits training activity, intensity, feedback, and recovery state.", qualityGateZh: "健康相关内容必须标注为记录而非建议。", qualityGateEn: "Health-related content must be labeled as tracking, not advice.", riskLevel: "medium" },
    { id: "streak-review", nameZh: "连续复盘模板", nameEn: "Streak review template", useCasesZh: ["连续目标", "周复盘"], useCasesEn: ["streak goals", "weekly review"], fitZh: "适合按周复盘、识别中断原因和调整目标。", fitEn: "Fits weekly reviews, break reasons, and goal adjustment.", qualityGateZh: "中断原因和目标调整必须可编辑。", qualityGateEn: "Break reasons and goal adjustments must be editable.", riskLevel: "low" },
  ],
  calculator: [
    { id: "core", nameZh: "参数计算模板", nameEn: "Parameter calculator template", useCasesZh: ["换算", "报价"], useCasesEn: ["conversion", "quote"], fitZh: "适合参数输入、公式结果和场景对比。", fitEn: "Fits parameter input, formula output, and scenario comparison.", qualityGateZh: "公式和单位必须展示给用户。", qualityGateEn: "Formula and units must be visible to the user.", riskLevel: "medium" },
    { id: "quote", nameZh: "报价测算模板", nameEn: "Quote estimator template", useCasesZh: ["报价单", "成本测算"], useCasesEn: ["quote sheet", "cost estimate"], fitZh: "适合成本、利润、税费和折扣测算。", fitEn: "Fits cost, margin, tax, and discount estimates.", qualityGateZh: "报价结果必须标记为估算并可人工复核。", qualityGateEn: "Quote results must be marked as estimates and reviewable.", riskLevel: "medium" },
    { id: "comparison", nameZh: "方案对比模板", nameEn: "Scenario comparison template", useCasesZh: ["方案选择", "参数对比"], useCasesEn: ["option choice", "parameter comparison"], fitZh: "适合多个方案的参数、权重和结果比较。", fitEn: "Fits comparing options, weights, and outcomes.", qualityGateZh: "权重和假设必须可编辑。", qualityGateEn: "Weights and assumptions must be editable.", riskLevel: "medium" },
  ],
  form: [
    { id: "core", nameZh: "本地表单模板", nameEn: "Local form template", useCasesZh: ["报名", "登记"], useCasesEn: ["signup", "registration"], fitZh: "适合字段配置、填写校验和本地导出。", fitEn: "Fits field setup, validation, and local export.", qualityGateZh: "导出前必须显示字段和记录数量。", qualityGateEn: "Export must show fields and record count first.", riskLevel: "medium" },
    { id: "intake", nameZh: "需求收集模板", nameEn: "Request intake template", useCasesZh: ["需求收集", "问题登记"], useCasesEn: ["request intake", "issue intake"], fitZh: "适合收集需求、优先级、附件说明和处理状态。", fitEn: "Fits requests, priorities, attachment notes, and handling state.", qualityGateZh: "高敏字段必须默认关闭。", qualityGateEn: "Highly sensitive fields must default off.", riskLevel: "medium" },
    { id: "inspection", nameZh: "检查表模板", nameEn: "Inspection checklist template", useCasesZh: ["巡检", "验收"], useCasesEn: ["inspection", "acceptance"], fitZh: "适合逐项检查、异常记录和结论导出。", fitEn: "Fits item-by-item checks, exception notes, and result export.", qualityGateZh: "异常项必须可筛选并保留说明。", qualityGateEn: "Exception items must be filterable with notes.", riskLevel: "low" },
  ],
  workflow: [
    { id: "core", nameZh: "流程看板模板", nameEn: "Workflow board template", useCasesZh: ["流程管理", "状态跟进"], useCasesEn: ["workflow management", "status tracking"], fitZh: "适合阶段、状态、阻塞项和下一步。", fitEn: "Fits stages, status, blockers, and next actions.", qualityGateZh: "状态切换必须可追溯。", qualityGateEn: "Status transitions must be traceable.", riskLevel: "medium" },
    { id: "crm", nameZh: "客户跟进模板", nameEn: "Customer follow-up template", useCasesZh: ["客户线索", "销售跟进"], useCasesEn: ["customer leads", "sales follow-up"], fitZh: "适合线索状态、跟进记录、下次联系和风险提示。", fitEn: "Fits lead status, follow-up notes, next contact, and risk flags.", qualityGateZh: "联系动作必须需要用户确认。", qualityGateEn: "Contact actions must require user confirmation.", riskLevel: "medium" },
    { id: "incident", nameZh: "问题排查模板", nameEn: "Incident triage template", useCasesZh: ["故障排查", "问题闭环"], useCasesEn: ["incident triage", "issue closure"], fitZh: "适合记录现象、影响、假设、尝试和结论。", fitEn: "Fits symptoms, impact, hypotheses, attempts, and conclusions.", qualityGateZh: "每次尝试都必须保留时间和结果。", qualityGateEn: "Each attempt must keep time and result.", riskLevel: "medium" },
  ],
  lookup: [
    { id: "core", nameZh: "查询整理模板", nameEn: "Lookup organizer template", useCasesZh: ["资料查询", "来源标注"], useCasesEn: ["reference lookup", "source labels"], fitZh: "适合查询、筛选、来源和缓存状态。", fitEn: "Fits queries, filters, sources, and cache state.", qualityGateZh: "每条结果必须显示来源和时间。", qualityGateEn: "Every result must show source and timestamp.", riskLevel: "medium" },
    { id: "faq", nameZh: "FAQ 检索模板", nameEn: "FAQ search template", useCasesZh: ["常见问题", "答案整理"], useCasesEn: ["FAQ", "answer organizer"], fitZh: "适合问答库检索、相似问题和引用答案。", fitEn: "Fits Q&A search, similar questions, and cited answers.", qualityGateZh: "答案必须保留原始问题或来源。", qualityGateEn: "Answers must keep the original question or source.", riskLevel: "low" },
    { id: "catalog", nameZh: "目录检索模板", nameEn: "Catalog lookup template", useCasesZh: ["商品/资料目录", "筛选比较"], useCasesEn: ["item catalog", "filter comparison"], fitZh: "适合目录筛选、排序、收藏和对比。", fitEn: "Fits catalog filtering, sorting, favorites, and comparison.", qualityGateZh: "筛选条件必须可清空和复位。", qualityGateEn: "Filters must be clearable and resettable.", riskLevel: "low" },
  ],
  general: [
    { id: "core", nameZh: "通用问题解决模板", nameEn: "General problem-solving template", useCasesZh: ["未知问题", "临时工具"], useCasesEn: ["unknown task", "temporary tool"], fitZh: "适合先确认目标、输入、输出和完成标准。", fitEn: "Fits confirming goal, inputs, outputs, and success criteria first.", qualityGateZh: "生成前必须确认问题边界。", qualityGateEn: "Problem boundary must be confirmed before generation.", riskLevel: "low" },
    { id: "decision", nameZh: "决策辅助模板", nameEn: "Decision helper template", useCasesZh: ["方案选择", "权衡利弊"], useCasesEn: ["option choice", "tradeoff review"], fitZh: "适合列出选项、权重、风险和下一步。", fitEn: "Fits options, weights, risks, and next action.", qualityGateZh: "决策结果必须标注为辅助参考。", qualityGateEn: "Decision output must be marked as assistive reference.", riskLevel: "medium" },
    { id: "checklist", nameZh: "任务清单模板", nameEn: "Task checklist template", useCasesZh: ["执行清单", "步骤检查"], useCasesEn: ["execution checklist", "step checks"], fitZh: "适合把问题拆成步骤、确认项和完成记录。", fitEn: "Fits steps, confirmations, and completion records.", qualityGateZh: "每个步骤必须能标记完成和撤销。", qualityGateEn: "Each step must be completable and undoable.", riskLevel: "low" },
  ],
};

function detectLanguage(value: string): "zh-CN" | "en-US" {
  return /[\u3400-\u9fff]/.test(value) ? "zh-CN" : "en-US";
}

function normalizeProblem(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, PROBLEM_BLUEPRINT_MAX_INPUT_CHARS);
}

function scoreCategory(problem: string, profile: CategoryProfile) {
  const lower = problem.toLowerCase();
  return profile.keywords.reduce((score, keyword) => (lower.includes(keyword.toLowerCase()) ? score + 1 : score), 0);
}

function detectCategory(problem: string): ProblemBlueprintCategory {
  let bestCategory: ProblemBlueprintCategory = "general";
  let bestScore = 0;

  for (const [category, profile] of Object.entries(categoryProfiles) as Array<[ProblemBlueprintCategory, CategoryProfile]>) {
    const score = scoreCategory(problem, profile);
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  return bestCategory;
}

function estimateTemplateRisk(category: ProblemBlueprintCategory): ProblemBlueprintTemplateOption["riskLevel"] {
  if (category === "ledger" || category === "form" || category === "workflow") return "medium";
  if (category === "planner" || category === "habit" || category === "calculator" || category === "lookup") return "medium";
  return "low";
}

function buildTemplateOption(
  category: ProblemBlueprintCategory,
  language: ProblemBlueprint["language"],
  matchScore: number,
  role: ProblemBlueprintTemplateOption["role"],
  variant: TemplateVariant = templateVariants[category][0],
): ProblemBlueprintTemplateOption {
  const profile = categoryProfiles[category];
  const contract = templateContracts[category];
  const localized = localizedContract(language, contract);
  const name = language === "en-US" ? variant.nameEn : variant.nameZh;
  const categoryLabel = language === "en-US" ? profile.labelEn : profile.labelZh;
  const riskLevel = variant.riskLevel || estimateTemplateRisk(category);
  const reason = language === "en-US"
    ? role === "primary"
      ? `Best match for the current problem; start from ${name} and keep unrelated modules out.`
      : `Alternative pattern if the task also needs ${categoryLabel.toLowerCase()} controls.`
    : role === "primary"
      ? `当前问题的最佳匹配；从「${name}」开始，并移除无关模块。`
      : `如果这个任务还需要「${categoryLabel}」能力，可以作为备选模板。`;

  return {
    id: variant.id === "core" ? `problem-${category}` : `problem-${category}-${variant.id}`,
    category,
    variantId: variant.id,
    name,
    categoryLabel,
    role,
    matchScore,
    fitSummary: language === "en-US" ? variant.fitEn : variant.fitZh,
    useCases: language === "en-US" ? variant.useCasesEn : variant.useCasesZh,
    inputs: localized.inputs.slice(0, 3),
    outputs: localized.outputs.slice(0, 3),
    qualityGates: [language === "en-US" ? variant.qualityGateEn : variant.qualityGateZh, ...localized.qualityGates].slice(0, 3),
    riskLevel,
    riskNotes: (language === "en-US" ? profile.risksEn : profile.risksZh).slice(0, 2),
    reason,
  };
}

function buildTemplateLibrary(problem: string, language: ProblemBlueprint["language"], primary: ProblemBlueprintCategory) {
  const ranked = (Object.entries(categoryProfiles) as Array<[ProblemBlueprintCategory, CategoryProfile]>)
    .filter(([category]) => category !== "general")
    .map(([category, profile]) => ({
      category,
      score: category === primary ? 100 : Math.min(92, scoreCategory(problem, profile) * 24 + 38),
    }))
    .sort((left, right) => {
      if (left.category === primary) return -1;
      if (right.category === primary) return 1;
      return right.score - left.score || left.category.localeCompare(right.category);
    });
  const primaryVariants = templateVariants[primary] || templateVariants.general;
  const primaryOptions = primaryVariants.slice(0, 3).map((variant, index) => buildTemplateOption(
    primary,
    language,
    index === 0 ? 100 : 94 - index * 4,
    index === 0 ? "primary" : "alternative",
    variant,
  ));
  const categoryOptions = ranked
    .filter((item) => item.category !== primary)
    .slice(0, 3)
    .map((item) => buildTemplateOption(
      item.category,
      language,
      Math.max(35, item.score),
      "alternative",
      templateVariants[item.category][0],
    ));
  return [...primaryOptions, ...categoryOptions].slice(0, 6);
}

function buildSteps(language: ProblemBlueprint["language"], profile: CategoryProfile): ProblemBlueprintStep[] {
  if (language === "en-US") {
    return [
      {
        id: "clarify",
        title: "Clarify the outcome",
        detail: "Turn the current need into clear inputs, outputs, and success criteria.",
        artifact: "Problem brief",
      },
      {
        id: "build",
        title: "Generate the helper app",
        detail: `Create a runnable ${profile.labelEn.toLowerCase()} tool that works locally and can be refined in Studio.`,
        artifact: "Runnable app",
      },
      {
        id: "use",
        title: "Run, record, and adjust",
        detail: "Use the app on the real task, keep results local, and continue debugging the UI or logic when needed.",
        artifact: "Saved workflow",
      },
    ];
  }

  return [
    {
      id: "clarify",
      title: "明确要解决的结果",
      detail: "把当前需求整理成输入、输出和完成标准，避免只生成一个空壳界面。",
      artifact: "问题简报",
    },
    {
      id: "build",
      title: "生成解决程序",
      detail: `生成一个可运行的${profile.labelZh}工具，数据留在本地，并能继续在 Studio 里调试。`,
      artifact: "可运行程序",
    },
    {
      id: "use",
      title: "执行、记录、继续调整",
      detail: "把程序用于真实任务，记录结果，再按实际反馈继续修改界面或逻辑。",
      artifact: "已保存流程",
    },
  ];
}

function buildConfirmationChecklist(language: ProblemBlueprint["language"], profile: CategoryProfile, problem: string) {
  if (language === "en-US") {
    return [
      "Confirm the real problem, success criteria, and expected output.",
      `Confirm the generated app should use: ${profile.modulesEn.join(", ")}.`,
      "Confirm sample data is editable and local-only before using it on real work.",
    ];
  }

  return [
    "确认真实问题、完成标准和期望输出。",
    `确认生成程序需要包含：${profile.modulesZh.join("、")}。`,
    "正式使用前，确认示例数据可编辑且只保存在本地。",
  ];
}

function buildTemplateChecklist(language: ProblemBlueprint["language"], profile: CategoryProfile) {
  if (language === "en-US") {
    return [
      `Start from ${profile.templateNameEn}, then remove anything that does not serve the current problem.`,
      "Keep editable sample data local-only and visibly separate from real work data.",
      "Cover empty, import, export, reset, and undo states before calling the generated app ready.",
    ];
  }

  return [
    `先使用「${profile.templateNameZh}」，再删掉和当前问题无关的模块。`,
    "示例数据必须可编辑、只保存在本地，并和真实数据明显区分。",
    "正式使用前补齐空状态、导入、导出、重置和撤销状态。",
  ];
}

function localizedContract(language: ProblemBlueprint["language"], contract: TemplateContract) {
  return {
    inputs: language === "en-US" ? contract.inputsEn : contract.inputsZh,
    outputs: language === "en-US" ? contract.outputsEn : contract.outputsZh,
    qualityGates: language === "en-US" ? contract.qualityGatesEn : contract.qualityGatesZh,
    dangerousActions: language === "en-US" ? contract.dangerousActionsEn : contract.dangerousActionsZh,
  };
}

function buildFailureRecovery(language: ProblemBlueprint["language"]) {
  if (language === "en-US") {
    return [
      "If the generated app misses the point, keep the current version and regenerate from the saved blueprint.",
      "If validation fails, ask Studio to patch the broken field, formula, or state transition.",
      "If the task becomes risky, stop external actions and keep the app in local draft mode.",
    ];
  }

  return [
    "如果生成结果跑偏，保留当前版本，并用已保存蓝图重新生成。",
    "如果校验失败，让 Studio 只修坏掉的字段、公式或状态流转。",
    "如果任务变成高风险动作，先停止外部调用，把程序留在本地草稿模式。",
  ];
}

function buildVersionDiffChecklist(language: ProblemBlueprint["language"]) {
  if (language === "en-US") {
    return [
      "Compare changed inputs, stored state shape, formulas, and validation rules.",
      "Compare permissions, export fields, and any requestAction/requestCapability usage.",
      "Keep the previous runnable version until the new version passes a real sample task.",
    ];
  }

  return [
    "对比输入字段、存储结构、公式和校验规则的变化。",
    "对比权限、导出字段，以及 requestAction/requestCapability 调用变化。",
    "新版本通过真实样例前，保留上一个可运行版本。",
  ];
}

function buildVersioningPlan(language: ProblemBlueprint["language"], profile: CategoryProfile) {
  if (language === "en-US") {
    return [
      `Start from the ${profile.templateNameEn}.`,
      "Save each generated app version with a short reason: initial draft, validation fix, UI cleanup, or logic repair.",
      "Before replacing a working version, compare what changed in inputs, state, permissions, and risky actions.",
    ];
  }

  return [
    `从「${profile.templateNameZh}」开始生成。`,
    "每次生成版本都记录原因：初稿、校验修复、界面整理或逻辑修复。",
    "替换可用版本前，对比输入、状态、权限和高风险动作的变化。",
  ];
}

function buildCapabilityReview(language: ProblemBlueprint["language"], profile: CategoryProfile, contract: TemplateContract) {
  const localized = localizedContract(language, contract);
  if (language === "en-US") {
    return [
      `Allowed by default: local state, validation, editable sample data, and ${profile.modulesEn.join(", ")}.`,
      `Review before enabling: ${localized.dangerousActions.join("; ")}.`,
      "Any requestAction or requestCapability call must explain user benefit, risk, and rollback before approval.",
    ];
  }

  return [
    `默认允许：本地状态、输入校验、可编辑示例数据，以及${profile.modulesZh.join("、")}。`,
    `启用前复核：${localized.dangerousActions.join("；")}。`,
    "任何 requestAction 或 requestCapability 调用都必须说明用户收益、风险和回滚方式后再批准。",
  ];
}

function buildRepairLoop(language: ProblemBlueprint["language"]) {
  if (language === "en-US") {
    return [
      "Capture runtime events and user-visible failures before changing code.",
      "Generate a narrow repair proposal with risk, permission review, and version safety notes.",
      "Compare against the previous runnable version, then save a new version or roll back.",
    ];
  }

  return [
    "先记录运行事件和用户可见失败，再修改代码。",
    "生成带风险、权限复核和版本安全说明的窄范围修复提案。",
    "对比上一个可运行版本，再保存新版本或回滚。",
  ];
}

function buildTemplateReadiness(
  language: ProblemBlueprint["language"],
  profile: CategoryProfile,
  contract: TemplateContract,
  isReady: boolean,
): ProblemBlueprintReadiness {
  const localized = localizedContract(language, contract);
  const checks: ProblemBlueprintReadinessCheck[] = language === "en-US"
    ? [
        { id: "template-match", label: "Template match", detail: `Starts from ${profile.templateNameEn} and removes unrelated modules.`, status: isReady ? "ready" : "blocked", weight: 20 },
        { id: "input-output", label: "Input/output contract", detail: `Uses ${localized.inputs.length} input group(s) and ${localized.outputs.length} output view(s).`, status: isReady ? "ready" : "blocked", weight: 18 },
        { id: "quality-gates", label: "Quality gates", detail: localized.qualityGates.join("; "), status: isReady ? "ready" : "blocked", weight: 18 },
        { id: "permission-boundary", label: "Permission boundary", detail: localized.dangerousActions.join("; "), status: isReady ? "review" : "blocked", weight: 16 },
        { id: "version-safety", label: "Version safety", detail: "Keeps old runnable versions until the new version passes a real sample task.", status: isReady ? "ready" : "blocked", weight: 14 },
        { id: "repair-loop", label: "Repair loop", detail: "Runtime events, repair proposal, version comparison, and rollback stay in the loop.", status: isReady ? "review" : "blocked", weight: 14 },
      ]
    : [
        { id: "template-match", label: "模板匹配", detail: `从「${profile.templateNameZh}」开始，并移除无关模块。`, status: isReady ? "ready" : "blocked", weight: 20 },
        { id: "input-output", label: "输入输出契约", detail: `包含 ${localized.inputs.length} 组输入和 ${localized.outputs.length} 组输出视图。`, status: isReady ? "ready" : "blocked", weight: 18 },
        { id: "quality-gates", label: "质量门槛", detail: localized.qualityGates.join("；"), status: isReady ? "ready" : "blocked", weight: 18 },
        { id: "permission-boundary", label: "权限边界", detail: localized.dangerousActions.join("；"), status: isReady ? "review" : "blocked", weight: 16 },
        { id: "version-safety", label: "版本安全", detail: "新版本通过真实样例前，保留旧的可运行版本。", status: isReady ? "ready" : "blocked", weight: 14 },
        { id: "repair-loop", label: "修复循环", detail: "运行事件、修复提案、版本对比和回滚保持在同一闭环里。", status: isReady ? "review" : "blocked", weight: 14 },
      ];
  const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0);
  const weightedScore = checks.reduce((sum, check) => {
    if (check.status === "ready") return sum + check.weight;
    if (check.status === "review") return sum + check.weight * 0.7;
    return sum;
  }, 0);
  const score = Math.round((weightedScore / totalWeight) * 100);
  const level: ProblemBlueprintReadiness["level"] = score >= 85 ? "ready" : score >= 60 ? "review" : "draft";
  const nextActions = language === "en-US"
    ? [
        "Review permission-boundary and repair-loop checks before generating.",
        "Run one real sample task before promoting the generated app.",
        "Keep rollback available until the new version is proven.",
      ]
    : [
        "生成前先复核权限边界和修复循环。",
        "用一个真实样例跑通后，再把生成程序标记为可用。",
        "新版本被证明可用前，保留回滚入口。",
      ];

  return { score, level, checks, nextActions };
}

function buildQualityScore(
  language: ProblemBlueprint["language"],
  profile: CategoryProfile,
  contract: TemplateContract,
  readiness: ProblemBlueprintReadiness,
  isReady: boolean,
): ProblemBlueprintQualityScore {
  const localized = localizedContract(language, contract);
  const dimensions: ProblemBlueprintQualityDimension[] = language === "en-US"
    ? [
        { id: "task-fit", label: "Task fit", score: isReady ? 92 : 0, status: isReady ? "pass" : "blocked", evidence: `Uses ${profile.templateNameEn} for ${profile.labelEn.toLowerCase()} work.` },
        { id: "data-safety", label: "Data safety", score: 86, status: "review", evidence: localized.dangerousActions.join("; ") },
        { id: "interaction-completeness", label: "Interaction completeness", score: 88, status: "pass", evidence: "Requires empty, import, export, reset, and undo states." },
        { id: "state-reliability", label: "State reliability", score: 84, status: "review", evidence: "Keeps editable sample data local and preserves state shape during repair." },
        { id: "repairability", label: "Repairability", score: 82, status: "review", evidence: "Runtime events, repair proposal, version compare, and rollback are required." },
        { id: "permission-safety", label: "Permission safety", score: 80, status: "review", evidence: "External actions require requestAction/requestCapability review." },
      ]
    : [
        { id: "task-fit", label: "任务匹配", score: isReady ? 92 : 0, status: isReady ? "pass" : "blocked", evidence: `使用「${profile.templateNameZh}」处理「${profile.labelZh}」问题。` },
        { id: "data-safety", label: "数据安全", score: 86, status: "review", evidence: localized.dangerousActions.join("；") },
        { id: "interaction-completeness", label: "交互完整度", score: 88, status: "pass", evidence: "要求覆盖空状态、导入、导出、重置和撤销状态。" },
        { id: "state-reliability", label: "状态可靠性", score: 84, status: "review", evidence: "示例数据留在本地，修复时保留状态结构。" },
        { id: "repairability", label: "可修复性", score: 82, status: "review", evidence: "必须串起运行事件、修复提案、版本对比和回滚。" },
        { id: "permission-safety", label: "权限安全", score: 80, status: "review", evidence: "外部动作必须经过 requestAction/requestCapability 复核。" },
      ];
  const score = isReady
    ? Math.round((dimensions.reduce((sum, item) => sum + item.score, 0) / dimensions.length) * 0.75 + readiness.score * 0.25)
    : 0;
  const level: ProblemBlueprintQualityScore["level"] = score >= 88 ? "strong" : score >= 70 ? "usable" : "draft";
  const acceptanceCriteria = language === "en-US"
    ? [
        "A real sample task can be completed without editing source code.",
        "Invalid inputs show user-readable recovery guidance.",
        "State, export, permissions, and rollback are visible before promotion.",
      ]
    : [
        "不用改源码也能完成一个真实样例任务。",
        "输入错误时显示用户能看懂的恢复提示。",
        "上线前能看到状态、导出、权限和回滚入口。",
      ];
  const failureTriggers = language === "en-US"
    ? [
        "Generated app cannot complete the main sample task.",
        "A formula, validation rule, or state transition produces incorrect output.",
        "A new external action, permission, or data export appears without explanation.",
      ]
    : [
        "生成程序无法完成主样例任务。",
        "公式、校验或状态流转产生错误结果。",
        "新增外部动作、权限或导出字段但没有解释。",
      ];
  return { score, level, dimensions, acceptanceCriteria, failureTriggers };
}

function buildAutoRepairLoop(
  language: ProblemBlueprint["language"],
  qualityScore: ProblemBlueprintQualityScore,
): ProblemBlueprintAutoRepairLoop {
  const canAutoRepair = qualityScore.level !== "draft";
  if (language === "en-US") {
    return {
      mode: canAutoRepair ? "guarded-auto-repair" : "manual-review",
      retryLimit: 2,
      canAutoRepair,
      autoRepairSignals: [
        "Runtime error with no new permission surface.",
        "Validation, formula, layout, or state migration issue contained in the generated app.",
        "Version comparison reports low or medium risk.",
      ],
      manualReviewSignals: [
        "Phone, SMS, Shortcuts, file, clipboard, shell, calendar, reminder, or network action changed.",
        "requestAction/requestCapability is added or broadened.",
        "Two repair attempts fail or the quality score drops.",
      ],
      rollbackRule: "Always keep the last runnable version; roll back before a third repair attempt.",
      verificationSteps: [
        "Run the main sample task after repair.",
        "Compare changed code and permissions before saving.",
        "Save as a new version with the repair reason.",
      ],
    };
  }
  return {
    mode: canAutoRepair ? "guarded-auto-repair" : "manual-review",
    retryLimit: 2,
    canAutoRepair,
    autoRepairSignals: [
      "没有新增权限面的运行错误。",
      "生成程序内部的校验、公式、布局或状态迁移问题。",
      "版本对比显示低风险或中风险。",
    ],
    manualReviewSignals: [
      "电话、短信、快捷指令、文件、剪贴板、脚本、日历、提醒事项或联网动作发生变化。",
      "新增或扩大 requestAction/requestCapability 权限调用。",
      "连续两次修复失败，或质量评分下降。",
    ],
    rollbackRule: "始终保留上一个可运行版本；第三次修复前必须先回滚。",
    verificationSteps: [
      "修复后跑通主样例任务。",
      "保存前对比代码和权限变化。",
      "用修复原因保存成新版本。",
    ],
  };
}

function buildSummary(language: ProblemBlueprint["language"], profile: CategoryProfile, problem: string) {
  if (!problem) {
    return language === "en-US"
      ? "Describe a real task and OwnOrbit will turn it into a runnable helper app."
      : "描述一个真实问题，OwnOrbit 会把它转成可运行的解决程序。";
  }

  if (language === "en-US") {
    return `OwnOrbit recognized this as a ${profile.labelEn.toLowerCase()} task and prepared a runnable app plan for the current problem.`;
  }

  return `OwnOrbit 已将这个需求识别为「${profile.labelZh}」问题，并准备好生成一个解决当前问题的可运行程序。`;
}

function buildAppPrompt(language: ProblemBlueprint["language"], profile: CategoryProfile, contract: TemplateContract, problem: string, templateLibrary: ProblemBlueprintTemplateOption[]) {
  if (!problem) return "";
  const localized = localizedContract(language, contract);
  const readiness = buildTemplateReadiness(language, profile, contract, true);
  const qualityScore = buildQualityScore(language, profile, contract, readiness, true);
  const autoRepairLoop = buildAutoRepairLoop(language, qualityScore);

  if (language === "en-US") {
    return [
      "Generate a runnable problem-solving app for the user's current task.",
      `Problem: ${problem}`,
      `Problem type: ${profile.labelEn}`,
      `Required modules: ${profile.modulesEn.join(", ")}.`,
      `Template inputs: ${localized.inputs.join("; ")}.`,
      `Template outputs: ${localized.outputs.join("; ")}.`,
      `Quality gates: ${localized.qualityGates.join("; ")}.`,
      `Dangerous action boundary: ${localized.dangerousActions.join("; ")}.`,
      "The app should help the user solve the task directly, not merely visualize a description.",
      "Use local state/persistence where useful, include clear empty states, validation, and editable sample data.",
      `Before generation, ask for confirmation on: ${buildConfirmationChecklist(language, profile, problem).join(" ")}`,
      `Permission boundary: ${profile.permissionEn.join(" ")}`,
      `Failure recovery: ${buildFailureRecovery(language).join(" ")}`,
      `Template fit: ${profile.templateFitEn.join(" ")}`,
      `Template library candidates: ${templateLibrary.map((template) => `${template.name} (${template.role}, score ${template.matchScore}): ${template.reason}`).join(" | ")}`,
      `Template checklist: ${buildTemplateChecklist(language, profile).join(" ")}`,
      `Readiness checks: ${readiness.checks.map((check) => `${check.label}: ${check.detail}`).join(" ")}`,
      `Quality score: ${qualityScore.score}/${qualityScore.level}. ${qualityScore.dimensions.map((dimension) => `${dimension.label} ${dimension.score}: ${dimension.evidence}`).join(" ")}`,
      `Acceptance criteria: ${qualityScore.acceptanceCriteria.join(" ")}`,
      `Failure triggers: ${qualityScore.failureTriggers.join(" ")}`,
      `Auto-repair loop: mode ${autoRepairLoop.mode}, retry limit ${autoRepairLoop.retryLimit}. Auto repair only for: ${autoRepairLoop.autoRepairSignals.join(" ")} Manual review when: ${autoRepairLoop.manualReviewSignals.join(" ")} Rollback: ${autoRepairLoop.rollbackRule}`,
      `Versioning plan: ${buildVersioningPlan(language, profile).join(" ")}`,
      `Version diff checklist: ${buildVersionDiffChecklist(language).join(" ")}`,
      `Capability review: ${buildCapabilityReview(language, profile, contract).join(" ")}`,
      `Repair loop: ${buildRepairLoop(language).join(" ")}`,
      `Repair prompts: ${profile.repairEn.join(" ")}`,
      `Safety note: ${profile.risksEn.join(" ")}`,
    ].join("\n");
  }

  return [
    "请根据用户当前要解决的问题，生成一个可运行的解决程序。",
    `问题：${problem}`,
    `问题类型：${profile.labelZh}`,
    `需要的模块：${profile.modulesZh.join("、")}。`,
    `模板输入：${localized.inputs.join("；")}。`,
    `模板输出：${localized.outputs.join("；")}。`,
    `质量门槛：${localized.qualityGates.join("；")}。`,
    `危险动作边界：${localized.dangerousActions.join("；")}。`,
    "这个程序要直接帮助用户处理问题，而不是只根据描述生成一个展示用小程序。",
    "请使用本地状态/持久化、清晰的空状态、输入校验和可编辑示例数据。",
    `生成前确认：${buildConfirmationChecklist(language, profile, problem).join(" ")}`,
    `权限边界：${profile.permissionZh.join(" ")}`,
    `失败修复：${buildFailureRecovery(language).join(" ")}`,
    `模板适配：${profile.templateFitZh.join(" ")}`,
    `候选模板库：${templateLibrary.map((template) => `${template.name}（${template.role === "primary" ? "主模板" : "备选模板"}，匹配 ${template.matchScore}）：${template.reason}`).join(" | ")}`,
    `模板检查：${buildTemplateChecklist(language, profile).join(" ")}`,
    `就绪检查：${readiness.checks.map((check) => `${check.label}：${check.detail}`).join(" ")}`,
    `质量评分：${qualityScore.score}/${qualityScore.level}。${qualityScore.dimensions.map((dimension) => `${dimension.label} ${dimension.score}：${dimension.evidence}`).join(" ")}`,
    `验收标准：${qualityScore.acceptanceCriteria.join(" ")}`,
    `失败触发：${qualityScore.failureTriggers.join(" ")}`,
    `自动修复闭环：模式 ${autoRepairLoop.mode}，最多 ${autoRepairLoop.retryLimit} 次。只允许自动修复：${autoRepairLoop.autoRepairSignals.join(" ")} 人工复核条件：${autoRepairLoop.manualReviewSignals.join(" ")} 回滚规则：${autoRepairLoop.rollbackRule}`,
    `版本计划：${buildVersioningPlan(language, profile).join(" ")}`,
    `版本差异检查：${buildVersionDiffChecklist(language).join(" ")}`,
    `能力复核：${buildCapabilityReview(language, profile, contract).join(" ")}`,
    `修复循环：${buildRepairLoop(language).join(" ")}`,
    `修复提示：${profile.repairZh.join(" ")}`,
    `安全提醒：${profile.risksZh.join(" ")}`,
  ].join("\n");
}

export function deriveProblemBlueprint(input: string): ProblemBlueprint {
  const normalizedProblem = normalizeProblem(input);
  const language = detectLanguage(input);
  const category = normalizedProblem ? detectCategory(normalizedProblem) : "general";
  const profile = categoryProfiles[category];
  const contract = templateContracts[category];
  const localized = localizedContract(language, contract);
  const isReady = normalizedProblem.length >= 4;
  const templateLibrary = buildTemplateLibrary(normalizedProblem, language, category);
  const templateReadiness = buildTemplateReadiness(language, profile, contract, isReady);
  const qualityScore = buildQualityScore(language, profile, contract, templateReadiness, isReady);
  const autoRepairLoop = buildAutoRepairLoop(language, qualityScore);

  return {
    isReady,
    language,
    category,
    templateId: `problem-${category}`,
    templateName: language === "en-US" ? profile.templateNameEn : profile.templateNameZh,
    templateLibrary,
    templateFit: language === "en-US" ? profile.templateFitEn : profile.templateFitZh,
    templateChecklist: buildTemplateChecklist(language, profile),
    templateInputs: localized.inputs,
    templateOutputs: localized.outputs,
    templateQualityGates: localized.qualityGates,
    templateDangerousActions: localized.dangerousActions,
    templateReadiness,
    qualityScore,
    autoRepairLoop,
    categoryLabel: language === "en-US" ? profile.labelEn : profile.labelZh,
    suggestedAppName: language === "en-US" ? profile.appNameEn : profile.appNameZh,
    summary: buildSummary(language, profile, normalizedProblem),
    normalizedProblem,
    steps: buildSteps(language, profile),
    suggestedModules: language === "en-US" ? profile.modulesEn : profile.modulesZh,
    versioningPlan: buildVersioningPlan(language, profile),
    versionDiffChecklist: buildVersionDiffChecklist(language),
    confirmationChecklist: buildConfirmationChecklist(language, profile, normalizedProblem),
    permissionNotes: language === "en-US" ? profile.permissionEn : profile.permissionZh,
    capabilityReview: buildCapabilityReview(language, profile, contract),
    failureRecovery: buildFailureRecovery(language),
    repairLoop: buildRepairLoop(language),
    repairPrompts: language === "en-US" ? profile.repairEn : profile.repairZh,
    riskNotes: language === "en-US" ? profile.risksEn : profile.risksZh,
    appPrompt: buildAppPrompt(language, profile, contract, normalizedProblem, templateLibrary),
  };
}
