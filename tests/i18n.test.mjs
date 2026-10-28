import assert from "node:assert/strict";
import test from "node:test";
import { enUSTranslations } from "../src/i18n/translations.en-US.ts";
import { loadTranslations } from "../src/i18n/translations.ts";
import { zhCNTranslations } from "../src/i18n/translations.zh-CN.ts";

const translations = {
  "zh-CN": zhCNTranslations,
  "en-US": enUSTranslations,
};

test("i18n locales expose the same translation keys", () => {
  const locales = Object.keys(translations);
  assert.deepEqual(locales.sort(), ["en-US", "zh-CN"]);

  const baseKeys = Object.keys(translations["zh-CN"]).sort();
  for (const locale of locales) {
    assert.deepEqual(Object.keys(translations[locale]).sort(), baseKeys, `${locale} translation keys should match zh-CN`);
  }
});

test("i18n loads only the requested locale module through the runtime loader", async () => {
  assert.equal(await loadTranslations("zh-CN"), zhCNTranslations);
  assert.equal(await loadTranslations("en-US"), enUSTranslations);
});

test("i18n translations do not contain empty strings", () => {
  for (const [locale, messages] of Object.entries(translations)) {
    for (const [key, value] of Object.entries(messages)) {
      assert.equal(typeof value, "string", `${locale}.${key} should be a string`);
      assert.ok(value.trim().length > 0, `${locale}.${key} should not be empty`);
    }
  }
});
