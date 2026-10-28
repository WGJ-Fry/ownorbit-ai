import { expect, test, type Browser, type Page } from "@playwright/test";

// A phone that was paired on a quick tunnel whose cloudflared is gone: the
// page shell still loads (in real life from the service worker cache), but
// nothing behind the address answers.
const deadOrigin = "https://e2e-dead-quick.trycloudflare.com";
// A stable address the phone learned from the desktop's endpoint list, which
// answers as this desktop.
const stableOrigin = "https://e2e-stable.tailnet.example.ts.net";
const shellOrigin = "http://127.0.0.1:3333";
const viewport = { width: 375, height: 667 };
// The connection pill floats over the chat and cannot be dismissed. Before
// the quick-tunnel copy changes its offline state ended at 185 px (zh-CN) and
// 201 px (en-US) here; it must never cover more than a third of the screen.
const pillBottomLimit = Math.floor(viewport.height / 3);

const copy = {
  "zh-CN": {
    offline: "连接中断，正在重试",
    retry: (attempt: number) => `第 ${attempt} 次重连`,
    offlineBody: "打字和图片没发出去会留在输入框里",
    lostTitle: "这个临时地址可能已失效",
    lostAction: "查看处理步骤",
    openDevice: "打开设备与连接",
    cardTitle: "连不上时按这个顺序处理",
    wakeStep: "1. 先看电脑是不是在睡眠或断网",
    renewStep: "2. 电脑端 OwnOrbit 或电脑重启过",
    renewStart: "在电脑上点“一键启动 Cloudflare Tunnel”。",
    chats: "已经发到电脑上的消息会留在电脑上",
  },
  "en-US": {
    offline: "Connection lost, retrying",
    retry: (attempt: number) => `Reconnect attempt ${attempt} `,
    offlineBody: "Typed messages and photos that didn't send stay in the input box",
    lostTitle: "Temporary address may have changed",
    lostAction: "See what to do",
    openDevice: "Open Device & Connection",
    cardTitle: "If it stops connecting, go in this order",
    wakeStep: "1. First check whether the computer is asleep or offline",
    renewStep: "2. If the desktop app or the computer restarted",
    renewStart: "On the computer, click “Start Cloudflare Tunnel”.",
    chats: "Messages that already reached the computer stay there",
  },
} as const;

async function openDeadQuickTunnelPhone(
  browser: Browser,
  locale: keyof typeof copy,
  options: { stableCandidate?: boolean; healthAnswers?: boolean } = {},
) {
  const context = await browser.newContext({ viewport, locale, serviceWorkers: "block" });
  await context.addInitScript(() => {
    if (location.hostname !== "e2e-dead-quick.trycloudflare.com" || sessionStorage.getItem("e2e-seeded")) return;
    sessionStorage.setItem("e2e-seeded", "1");
    localStorage.setItem("lifeos_mobile_install_hint_dismissed", "1");
    localStorage.setItem("lifeos_device_credential", JSON.stringify({
      device: { id: "dev_e2e_dead_quick", name: "Dead Quick Phone", type: "mobile", status: "online", createdAt: Date.now(), lastSeenAt: Date.now() },
      authMethod: "token",
      accessToken: "lifeos_e2e_dead_quick_token",
      accessTokenExpiresAt: Date.now() + 30 * 86_400_000,
    }));
  });
  if (options.stableCandidate) {
    await context.addInitScript(([quick, stable]) => {
      if (location.origin !== quick) return;
      localStorage.setItem("lifeos_endpoint_candidates_v1", JSON.stringify({
        version: "e2e",
        generatedAt: Date.now(),
        storedAt: Date.now(),
        candidates: [
          { id: "tailscale-serve-https", mode: "tailscale", baseUrl: stable, priority: 98, secure: true, stability: "stable" },
          { id: "cloudflare-1", mode: "cloudflare", baseUrl: quick, priority: 84, secure: true, stability: "temporary" },
        ],
      }));
    }, [deadOrigin, stableOrigin] as const);
    await context.route(`${stableOrigin}/api/v1/health`, (route) => route.fulfill({
      contentType: "application/json",
      headers: { "access-control-allow-origin": deadOrigin },
      body: JSON.stringify({ ok: true, service: "lifeos-local-core" }),
    }));
  }
  await context.route(`${deadOrigin}/**`, async (route) => {
    const url = new URL(route.request().url());
    // A sleeping-then-woken desktop: only the health check answers, which is
    // all the page needs to know this address still reaches it.
    if (url.pathname.startsWith("/api/") && !(options.healthAnswers && url.pathname === "/api/v1/health")) {
      await route.abort("connectionrefused");
      return;
    }
    const response = await route.fetch({ url: `${shellOrigin}${url.pathname}${url.search}` });
    await route.fulfill({ response });
  });
  await context.routeWebSocket(/\/api\/v1\/ws/, (ws) => ws.close());
  return { context, page: await context.newPage() };
}

async function pillBottom(page: Page) {
  const box = await page.getByTestId("mobile-realtime-status").boundingBox();
  expect(box).not.toBeNull();
  return Math.round(box!.y + box!.height);
}

function readIndexedDbRecord(page: Page, dbName: string, storeName: string, key: string) {
  return page.evaluate(([name, store, id]) => new Promise<unknown>((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(store)) {
        db.close();
        resolve(null);
        return;
      }
      const get = db.transaction(store, "readonly").objectStore(store).get(id);
      get.onsuccess = () => {
        db.close();
        resolve(get.result ?? null);
      };
      get.onerror = () => reject(get.error);
    };
  }), [dbName, storeName, key] as const);
}

for (const locale of ["zh-CN", "en-US"] as const) {
  test(`dead quick tunnel waits two minutes before suggesting a new address and keeps the pill small (${locale})`, async ({ browser }) => {
    const text = copy[locale];
    const { context, page } = await openDeadQuickTunnelPhone(browser, locale);
    await page.clock.install();
    await page.goto(`${deadOrigin}/mobile/chat`);
    const pill = page.getByTestId("mobile-realtime-status");
    await expect(pill).toContainText(text.offline);
    await expect(pill).toContainText(text.retry(1));
    // From here on only fastForward moves time, one reconnect at a time.
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1));
    let attempt = Number((await pill.innerText()).match(/(\d+)/)?.[1] || 1);

    // Six failed reconnects in a row (~31 s of backoff; the old trigger was
    // five) is what a sleeping Mac or a cloudflared edge reconnect looks
    // like: still a blip.
    while (attempt < 6) {
      await page.clock.fastForward(1000 * 2 ** (attempt - 1));
      attempt += 1;
      await expect(pill).toContainText(text.retry(attempt));
    }
    await expect(pill).toContainText(text.offlineBody);
    await expect(pill.getByTestId("mobile-temporary-entry-lost")).toHaveCount(0);
    await expect(pill.getByRole("link", { name: text.openDevice })).toBeVisible();
    const offlineBottom = await pillBottom(page);
    test.info().annotations.push({ type: "pill-bottom", description: `${locale} offline: ${offlineBottom}px` });
    expect(offlineBottom).toBeLessThanOrEqual(pillBottomLimit);

    // Past two minutes of failing without a break the address may be gone.
    await page.clock.fastForward(100_000);
    await expect(pill.getByTestId("mobile-temporary-entry-lost")).toHaveText(text.lostTitle);
    const lostBottom = await pillBottom(page);
    test.info().annotations.push({ type: "pill-bottom", description: `${locale} lost: ${lostBottom}px` });
    expect(lostBottom).toBeLessThanOrEqual(pillBottomLimit);

    // The pill only links to the steps; the device page carries them, cheap
    // check first.
    await page.clock.resume();
    await pill.getByRole("link", { name: text.lostAction }).click();
    await expect(page).toHaveURL(`${deadOrigin}/mobile/device#temporary-entry`);
    const card = page.getByTestId("mobile-temporary-entry-card");
    await expect(card).toContainText(text.cardTitle);
    // Sent here by the pill: the steps are open and scrolled to, below the
    // sticky header (the card starts more than 500 px down otherwise).
    await expect(card.getByText(text.wakeStep)).toBeInViewport();
    await expect.poll(async () => (await card.boundingBox())!.y).toBeLessThan(150);
    const cardText = await card.innerText();
    const order = [text.wakeStep, text.renewStep, text.renewStart, text.chats].map((part) => cardText.indexOf(part));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    await context.close();
  });
}

test("device page on a temporary address keeps its credential for base-path links and saves the token before re-pairing here", async ({ browser }) => {
  const { context, page } = await openDeadQuickTunnelPhone(browser, "zh-CN");
  await page.goto(`${deadOrigin}/mobile/device`);
  // Opened directly, the steps stay folded so the rest of the page is not
  // pushed a screen down.
  const card = page.getByTestId("mobile-temporary-entry-card");
  await expect(card).toBeVisible();
  await expect(card.getByText(copy["zh-CN"].wakeStep)).toBeHidden();
  expect((await card.boundingBox())!.height).toBeLessThan(120);
  await expect(page.getByText("Dead Quick Phone")).toBeVisible();
  await expect.poll(() => readIndexedDbRecord(page, "lifeos-device-keys", "credentials", "primary")).not.toBeNull();
  const input = page.getByPlaceholder("https://.../mobile/install/bind_...");
  const rebind = page.getByRole("button", { name: "清除旧凭证并重新绑定" });

  // This origin under a base path: the pair page could not read the token
  // there, so the link is refused and the credential stays.
  await input.fill(`${deadOrigin}/ownorbit/mobile/install/bind_e2e_same_origin_base_path`);
  await rebind.click();
  await expect(page.getByText("请粘贴电脑端复制的完整绑定链接，或 bind_ 开头的绑定 token。")).toBeVisible();
  await expect(page).toHaveURL(`${deadOrigin}/mobile/device`);
  expect(await readIndexedDbRecord(page, "lifeos-device-keys", "credentials", "primary")).not.toBeNull();

  // A root link on this origin re-pairs here: the token is saved as a pending
  // intent before the old credential goes. The install page is stubbed so
  // only what the device page stored is checked.
  await page.route(`${deadOrigin}/mobile/install/**`, (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>install</title>" }));
  await input.fill(`${deadOrigin}/mobile/install/bind_e2e_same_origin_rebind`);
  await Promise.all([
    page.waitForURL(`${deadOrigin}/mobile/install/bind_e2e_same_origin_rebind`),
    rebind.click(),
  ]);
  const pending = await readIndexedDbRecord(page, "lifeos-pairing-intent", "intents", "pending") as { token?: string } | null;
  expect(pending?.token).toBe("bind_e2e_same_origin_rebind");
  expect(await readIndexedDbRecord(page, "lifeos-device-keys", "credentials", "primary")).toBeNull();
  await context.close();
});

test("the one-tap migration is only offered while this temporary address still reaches the computer", async ({ browser }) => {
  // Dead address: migration needs a voucher from it, so the steps card must
  // not be pointing at a migration card that can only fail.
  const dead = await openDeadQuickTunnelPhone(browser, "zh-CN", { stableCandidate: true });
  await dead.page.goto(`${deadOrigin}/mobile/device#temporary-entry`);
  await expect(dead.page.getByTestId("mobile-temporary-entry-card")).toBeVisible();
  await expect(dead.page.getByText("Dead Quick Phone")).toBeVisible();
  // (The steps card quotes the migration card's title, so look for its button.)
  const migrate = (page: Page) => page.getByRole("button", { name: "迁移到稳定地址" });
  await dead.page.waitForTimeout(1500);
  await expect(migrate(dead.page)).toHaveCount(0);
  await dead.context.close();

  // Same phone once the address answers again: the migration card is there.
  const alive = await openDeadQuickTunnelPhone(browser, "zh-CN", { stableCandidate: true, healthAnswers: true });
  await alive.page.goto(`${deadOrigin}/mobile/device`);
  await expect(migrate(alive.page)).toBeVisible();
  await expect(alive.page.getByRole("heading", { name: "有更稳定的地址可用" })).toBeVisible();
  await alive.context.close();
});
