import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "allow" });

test("PWA caches lazy locale and route chunks before an offline restart", async ({ context, page }) => {
  await page.goto("/mobile/chat");
  await expect(page.getByRole("heading", { name: /OwnOrbit (?:手机端|Mobile)/ })).toBeVisible();

  await expect.poll(async () => page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    const cacheNames = await caches.keys();
    const urls = (await Promise.all(cacheNames.map(async (cacheName) => {
      const cache = await caches.open(cacheName);
      return (await cache.keys()).map((request) => request.url);
    }))).flat();
    return {
      controlled: Boolean(navigator.serviceWorker.controller),
      hasChineseLocale: urls.some((url) => /translations-zh-CN/.test(url)),
      hasEnglishLocale: urls.some((url) => /translations-en-US/.test(url)),
      hasMobileChat: urls.some((url) => /MobileChatPage/.test(url)),
    };
  }), { timeout: 20_000 }).toEqual({
    controlled: true,
    hasChineseLocale: true,
    hasEnglishLocale: true,
    hasMobileChat: true,
  });

  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /OwnOrbit (?:手机端|Mobile)/ })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
