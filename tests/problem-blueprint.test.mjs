import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveProblemBlueprint,
  PROBLEM_BLUEPRINT_MAX_INPUT_CHARS,
} from "../src/services/problemBlueprint.ts";

test("problem blueprint turns accounting needs into a runnable app prompt", () => {
  const blueprint = deriveProblemBlueprint("帮我做一个本月支出记账、预算提醒和分类汇总面板");

  assert.equal(blueprint.isReady, true);
  assert.equal(blueprint.language, "zh-CN");
  assert.equal(blueprint.category, "ledger");
  assert.equal(blueprint.templateId, "problem-ledger");
  assert.match(blueprint.templateName, /台账模板/);
  assert.ok(blueprint.templateFit.some((item) => item.includes("CSV")));
  assert.match(blueprint.categoryLabel, /记账/);
  assert.match(blueprint.summary, /可运行程序/);
  assert.match(blueprint.appPrompt, /生成一个可运行的解决程序/);
  assert.match(blueprint.appPrompt, /不是只根据描述生成一个展示用小程序/);
  assert.match(blueprint.appPrompt, /生成前确认/);
  assert.match(blueprint.appPrompt, /权限边界/);
  assert.match(blueprint.appPrompt, /失败修复/);
  assert.match(blueprint.appPrompt, /模板适配/);
  assert.match(blueprint.appPrompt, /版本计划/);
  assert.match(blueprint.appPrompt, /修复提示/);
  assert.equal(blueprint.steps.length, 3);
  assert.ok(blueprint.suggestedModules.some((item) => item.includes("预算")));
  assert.ok(blueprint.versioningPlan.some((item) => item.includes("替换可用版本前")));
  assert.ok(blueprint.confirmationChecklist.some((item) => item.includes("完成标准")));
  assert.ok(blueprint.permissionNotes.some((item) => item.includes("本地存储")));
  assert.ok(blueprint.failureRecovery.some((item) => item.includes("重新生成")));
  assert.ok(blueprint.repairPrompts.some((item) => item.includes("分类规则")));
  assert.ok(blueprint.riskNotes.some((item) => item.includes("银行卡号")));
});

test("problem blueprint recognizes planning and habit scenarios", () => {
  const planner = deriveProblemBlueprint("把下周项目计划拆成每天任务和优先级");
  const habit = deriveProblemBlueprint("做一个每天喝水打卡和复盘工具");

  assert.equal(planner.category, "planner");
  assert.equal(habit.category, "habit");
  assert.ok(planner.suggestedModules.some((item) => item.includes("优先级")));
  assert.ok(habit.suggestedModules.some((item) => item.includes("打卡")));
});

test("problem blueprint preserves English app generation guidance", () => {
  const blueprint = deriveProblemBlueprint("Create a customer lead follow-up workflow panel with status tracking");

  assert.equal(blueprint.language, "en-US");
  assert.equal(blueprint.category, "workflow");
  assert.equal(blueprint.templateId, "problem-workflow");
  assert.match(blueprint.templateName, /Workflow board template/);
  assert.match(blueprint.appPrompt, /runnable problem-solving app/);
  assert.match(blueprint.appPrompt, /not merely visualize a description/);
  assert.match(blueprint.appPrompt, /Before generation/);
  assert.match(blueprint.appPrompt, /Permission boundary/);
  assert.match(blueprint.appPrompt, /Failure recovery/);
  assert.match(blueprint.appPrompt, /Template fit/);
  assert.match(blueprint.appPrompt, /Versioning plan/);
  assert.match(blueprint.appPrompt, /Repair prompts/);
  assert.ok(blueprint.suggestedModules.includes("step board"));
  assert.ok(blueprint.templateFit.some((item) => item.includes("project stages")));
  assert.ok(blueprint.versioningPlan.some((item) => item.includes("Save each generated app version")));
  assert.ok(blueprint.confirmationChecklist.some((item) => item.includes("success criteria")));
  assert.ok(blueprint.permissionNotes.some((item) => item.includes("second confirmation")));
  assert.ok(blueprint.failureRecovery.some((item) => item.includes("regenerate")));
  assert.ok(blueprint.repairPrompts.some((item) => item.includes("state machine")));
});

test("problem blueprint limits state payload size and handles empty input safely", () => {
  const empty = deriveProblemBlueprint("");
  const long = deriveProblemBlueprint(`规划${"很长".repeat(600)}`);

  assert.equal(empty.isReady, false);
  assert.equal(empty.appPrompt, "");
  assert.equal(long.isReady, true);
  assert.equal(long.normalizedProblem.length, PROBLEM_BLUEPRINT_MAX_INPUT_CHARS);
  assert.ok(long.appPrompt.length < PROBLEM_BLUEPRINT_MAX_INPUT_CHARS + 700);
});
