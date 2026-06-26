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

export type ProblemBlueprint = {
  isReady: boolean;
  language: "zh-CN" | "en-US";
  category: ProblemBlueprintCategory;
  templateId: string;
  templateName: string;
  templateFit: string[];
  categoryLabel: string;
  suggestedAppName: string;
  summary: string;
  normalizedProblem: string;
  steps: ProblemBlueprintStep[];
  suggestedModules: string[];
  versioningPlan: string[];
  confirmationChecklist: string[];
  permissionNotes: string[];
  failureRecovery: string[];
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

function buildSummary(language: ProblemBlueprint["language"], profile: CategoryProfile, problem: string) {
  if (!problem) {
    return language === "en-US"
      ? "Describe a real task and LifeOS will turn it into a runnable helper app."
      : "描述一个真实问题，LifeOS 会把它转成可运行的解决程序。";
  }

  if (language === "en-US") {
    return `LifeOS recognized this as a ${profile.labelEn.toLowerCase()} task and prepared a runnable app plan for the current problem.`;
  }

  return `LifeOS 已将这个需求识别为「${profile.labelZh}」问题，并准备好生成一个解决当前问题的可运行程序。`;
}

function buildAppPrompt(language: ProblemBlueprint["language"], profile: CategoryProfile, problem: string) {
  if (!problem) return "";

  if (language === "en-US") {
    return [
      "Generate a runnable problem-solving app for the user's current task.",
      `Problem: ${problem}`,
      `Problem type: ${profile.labelEn}`,
      `Required modules: ${profile.modulesEn.join(", ")}.`,
      "The app should help the user solve the task directly, not merely visualize a description.",
      "Use local state/persistence where useful, include clear empty states, validation, and editable sample data.",
      `Before generation, ask for confirmation on: ${buildConfirmationChecklist(language, profile, problem).join(" ")}`,
      `Permission boundary: ${profile.permissionEn.join(" ")}`,
      `Failure recovery: ${buildFailureRecovery(language).join(" ")}`,
      `Template fit: ${profile.templateFitEn.join(" ")}`,
      `Versioning plan: ${buildVersioningPlan(language, profile).join(" ")}`,
      `Repair prompts: ${profile.repairEn.join(" ")}`,
      `Safety note: ${profile.risksEn.join(" ")}`,
    ].join("\n");
  }

  return [
    "请根据用户当前要解决的问题，生成一个可运行的解决程序。",
    `问题：${problem}`,
    `问题类型：${profile.labelZh}`,
    `需要的模块：${profile.modulesZh.join("、")}。`,
    "这个程序要直接帮助用户处理问题，而不是只根据描述生成一个展示用小程序。",
    "请使用本地状态/持久化、清晰的空状态、输入校验和可编辑示例数据。",
    `生成前确认：${buildConfirmationChecklist(language, profile, problem).join(" ")}`,
    `权限边界：${profile.permissionZh.join(" ")}`,
    `失败修复：${buildFailureRecovery(language).join(" ")}`,
    `模板适配：${profile.templateFitZh.join(" ")}`,
    `版本计划：${buildVersioningPlan(language, profile).join(" ")}`,
    `修复提示：${profile.repairZh.join(" ")}`,
    `安全提醒：${profile.risksZh.join(" ")}`,
  ].join("\n");
}

export function deriveProblemBlueprint(input: string): ProblemBlueprint {
  const normalizedProblem = normalizeProblem(input);
  const language = detectLanguage(input);
  const category = normalizedProblem ? detectCategory(normalizedProblem) : "general";
  const profile = categoryProfiles[category];

  return {
    isReady: normalizedProblem.length >= 4,
    language,
    category,
    templateId: `problem-${category}`,
    templateName: language === "en-US" ? profile.templateNameEn : profile.templateNameZh,
    templateFit: language === "en-US" ? profile.templateFitEn : profile.templateFitZh,
    categoryLabel: language === "en-US" ? profile.labelEn : profile.labelZh,
    suggestedAppName: language === "en-US" ? profile.appNameEn : profile.appNameZh,
    summary: buildSummary(language, profile, normalizedProblem),
    normalizedProblem,
    steps: buildSteps(language, profile),
    suggestedModules: language === "en-US" ? profile.modulesEn : profile.modulesZh,
    versioningPlan: buildVersioningPlan(language, profile),
    confirmationChecklist: buildConfirmationChecklist(language, profile, normalizedProblem),
    permissionNotes: language === "en-US" ? profile.permissionEn : profile.permissionZh,
    failureRecovery: buildFailureRecovery(language),
    repairPrompts: language === "en-US" ? profile.repairEn : profile.repairZh,
    riskNotes: language === "en-US" ? profile.risksEn : profile.risksZh,
    appPrompt: buildAppPrompt(language, profile, normalizedProblem),
  };
}
