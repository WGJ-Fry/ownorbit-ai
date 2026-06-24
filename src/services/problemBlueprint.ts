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
  categoryLabel: string;
  suggestedAppName: string;
  summary: string;
  normalizedProblem: string;
  steps: ProblemBlueprintStep[];
  suggestedModules: string[];
  riskNotes: string[];
  appPrompt: string;
};

type CategoryProfile = {
  labelZh: string;
  labelEn: string;
  appNameZh: string;
  appNameEn: string;
  keywords: string[];
  modulesZh: string[];
  modulesEn: string[];
  risksZh: string[];
  risksEn: string[];
};

const categoryProfiles: Record<ProblemBlueprintCategory, CategoryProfile> = {
  ledger: {
    labelZh: "记账/收支",
    labelEn: "Ledger",
    appNameZh: "智能记账处理台",
    appNameEn: "Smart Ledger Console",
    keywords: ["记账", "账单", "支出", "收入", "预算", "报销", "invoice", "expense", "budget", "receipt", "ledger"],
    modulesZh: ["收入/支出录入", "分类汇总", "预算提醒", "本地持久化"],
    modulesEn: ["income/expense entry", "category summary", "budget warning", "local persistence"],
    risksZh: ["不要在程序里保存银行卡号、身份证号或完整支付凭证。"],
    risksEn: ["Do not store bank card numbers, IDs, or full payment credentials in the generated app."],
  },
  planner: {
    labelZh: "规划/排程",
    labelEn: "Planner",
    appNameZh: "目标规划执行台",
    appNameEn: "Goal Planning Console",
    keywords: ["规划", "计划", "日程", "安排", "项目", "路线", "plan", "schedule", "roadmap", "calendar", "project"],
    modulesZh: ["目标拆解", "优先级排序", "时间块", "进度检查"],
    modulesEn: ["goal breakdown", "priority sorting", "time blocks", "progress checks"],
    risksZh: ["规划建议需要用户确认，不能自动替用户承诺时间或发送消息。"],
    risksEn: ["Planning suggestions need user confirmation and must not automatically commit time or send messages."],
  },
  organizer: {
    labelZh: "整理/归档",
    labelEn: "Organizer",
    appNameZh: "信息整理工作台",
    appNameEn: "Information Organizer",
    keywords: ["整理", "归档", "分类", "清单", "资料", "笔记", "organize", "sort", "archive", "notes", "inventory"],
    modulesZh: ["批量条目", "标签分类", "筛选搜索", "导出摘要"],
    modulesEn: ["batch entries", "tag grouping", "search/filter", "summary export"],
    risksZh: ["导入资料前先去掉密钥、地址、手机号等敏感字段。"],
    risksEn: ["Remove keys, addresses, phone numbers, and other sensitive fields before importing data."],
  },
  habit: {
    labelZh: "打卡/习惯",
    labelEn: "Habit",
    appNameZh: "打卡追踪面板",
    appNameEn: "Habit Tracking Board",
    keywords: ["打卡", "习惯", "签到", "复盘", "训练", "habit", "check-in", "routine", "streak", "review"],
    modulesZh: ["每日打卡", "连续天数", "复盘记录", "趋势面板"],
    modulesEn: ["daily check-in", "streak counter", "review notes", "trend panel"],
    risksZh: ["健康、训练、用药等场景只做记录提醒，不替代专业建议。"],
    risksEn: ["Health, training, and medication scenarios are for tracking only, not professional advice."],
  },
  calculator: {
    labelZh: "计算/换算",
    labelEn: "Calculator",
    appNameZh: "计算辅助器",
    appNameEn: "Calculation Helper",
    keywords: ["计算", "换算", "公式", "报价", "利息", "税", "calculate", "formula", "quote", "interest", "tax"],
    modulesZh: ["参数输入", "公式结果", "场景对比", "校验提示"],
    modulesEn: ["parameter inputs", "formula result", "scenario comparison", "validation hints"],
    risksZh: ["金额、税务、投资结果需要标注为估算，并保留人工复核入口。"],
    risksEn: ["Money, tax, and investment results should be marked as estimates with a manual review path."],
  },
  form: {
    labelZh: "表单/收集",
    labelEn: "Form",
    appNameZh: "表单收集器",
    appNameEn: "Form Collector",
    keywords: ["表单", "收集", "登记", "问卷", "报名", "form", "survey", "register", "intake"],
    modulesZh: ["字段配置", "填写校验", "结果列表", "本地导出"],
    modulesEn: ["field setup", "input validation", "result list", "local export"],
    risksZh: ["不要默认收集身份证、精确住址、密钥等高敏字段。"],
    risksEn: ["Do not collect IDs, exact addresses, keys, or other highly sensitive fields by default."],
  },
  workflow: {
    labelZh: "流程/面板",
    labelEn: "Workflow",
    appNameZh: "流程控制面板",
    appNameEn: "Workflow Control Panel",
    keywords: ["流程", "审批", "面板", "看板", "状态", "workflow", "kanban", "pipeline", "status", "panel"],
    modulesZh: ["步骤看板", "状态切换", "阻塞项", "下一步建议"],
    modulesEn: ["step board", "status changes", "blockers", "next action suggestions"],
    risksZh: ["涉及删除、发送、支付、系统调用时必须保留二次确认。"],
    risksEn: ["Deleting, sending, payment, or system actions must keep explicit confirmation."],
  },
  lookup: {
    labelZh: "查询/检索",
    labelEn: "Lookup",
    appNameZh: "查询整理助手",
    appNameEn: "Lookup Assistant",
    keywords: ["查询", "检索", "搜索", "资料库", "知识库", "lookup", "search", "database", "knowledge"],
    modulesZh: ["查询输入", "结果筛选", "引用记录", "离线缓存"],
    modulesEn: ["query input", "result filtering", "source notes", "offline cache"],
    risksZh: ["联网查询结果要显示来源和时间，避免把过期信息当事实。"],
    risksEn: ["Web lookup results should show source and time to avoid treating stale information as fact."],
  },
  general: {
    labelZh: "通用问题",
    labelEn: "General",
    appNameZh: "问题解决工作台",
    appNameEn: "Problem Solver Workspace",
    keywords: [],
    modulesZh: ["目标输入", "步骤拆解", "结果记录", "继续调整"],
    modulesEn: ["goal input", "step breakdown", "result log", "continued refinement"],
    risksZh: ["先让用户确认目标、输入数据和输出格式，再生成可执行程序。"],
    risksEn: ["Ask the user to confirm the goal, input data, and output format before generating a runnable app."],
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
    categoryLabel: language === "en-US" ? profile.labelEn : profile.labelZh,
    suggestedAppName: language === "en-US" ? profile.appNameEn : profile.appNameZh,
    summary: buildSummary(language, profile, normalizedProblem),
    normalizedProblem,
    steps: buildSteps(language, profile),
    suggestedModules: language === "en-US" ? profile.modulesEn : profile.modulesZh,
    riskNotes: language === "en-US" ? profile.risksEn : profile.risksZh,
    appPrompt: buildAppPrompt(language, profile, normalizedProblem),
  };
}
