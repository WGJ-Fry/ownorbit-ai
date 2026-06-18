import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const nodeCommand = process.env.LIFEOS_NODE_BINARY || process.execPath;
const nodeSpawnOptions = {};
const childProcessPathEnv = process.env.PATH || process.env.Path || "";

function request(port, pathname, options = {}) {
  return fetch(`http://127.0.0.1:${port}${pathname}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
    },
  });
}

async function waitForServer(port, child, output) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20_000) {
    if (child.exitCode !== null) throw new Error(`server exited early with code ${child.exitCode}\n${output.join("")}`);
    try {
      const response = await request(port, "/api/v1/health");
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`server did not become healthy on port ${port}; exitCode=${child.exitCode}; signalCode=${child.signalCode}\n${output.join("")}`);
}

async function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill();
  });
}

async function getOpenPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

test("production build serves desktop admin, mobile PWA, manifest, and service worker", async (t) => {
  const port = await getOpenPort();
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-frontend-smoke-"));
  const child = spawn(nodeCommand, ["dist/server.cjs"], {
    cwd: rootDir,
    env: {
      ...process.env,
      NODE_ENV: "development",
      LIFEOS_PORT: String(port),
      LIFEOS_DATA_DIR: dataDir,
      LIFEOS_HOST: "127.0.0.1",
      PUBLIC_BASE_URL: "",
      APP_URL: "",
      PATH: childProcessPathEnv,
      Path: childProcessPathEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
    ...nodeSpawnOptions,
  });
  const childOutput = [];
  child.stdout.on("data", (chunk) => childOutput.push(chunk.toString()));
  child.stderr.on("data", (chunk) => childOutput.push(chunk.toString()));

  t.after(async () => {
    await stopServer(child);
    await rm(dataDir, { recursive: true, force: true });
  });

  await waitForServer(port, child, childOutput);

  for (const route of ["/", "/chat", "/admin/login", "/admin/onboarding", "/admin/settings", "/mobile/chat", "/mobile/actions", "/mobile/device", "/mobile/pair?token=demo", "/mobile/install/bind_shell_demo_123"]) {
    const response = await request(port, route);
    assert.equal(response.status, 200, `${route} should render the SPA shell`);
    assert.match(response.headers.get("content-type") || "", /text\/html/);
    const html = await response.text();
    assert.match(html, /<div id="root">/);
    assert.match(html, /\.\/assets\//);
    assert.doesNotMatch(html, /src="\/assets\//);
  }

  const installPairHtmlResponse = await request(port, "/mobile/pair?token=bind_install_pair_page_123");
  assert.equal(installPairHtmlResponse.status, 200);
  assert.match(installPairHtmlResponse.headers.get("cache-control") || "", /no-store/);
  assert.match(installPairHtmlResponse.headers.get("set-cookie") || "", /lifeos_pairing_intent=bind_install_pair_page_123/);
  const installPairHtml = await installPairHtmlResponse.text();
  assert.match(installPairHtml, /href="\/manifest\.webmanifest\?pairingToken=bind_install_pair_page_123"|href="manifest\.webmanifest\?pairingToken=bind_install_pair_page_123"/);

  const installChatHtmlResponse = await request(port, "/mobile/chat?pairingToken=bind_install_chat_page_123");
  assert.equal(installChatHtmlResponse.status, 200);
  assert.match(installChatHtmlResponse.headers.get("cache-control") || "", /no-store/);
  assert.match(installChatHtmlResponse.headers.get("set-cookie") || "", /lifeos_pairing_intent=bind_install_chat_page_123/);
  const installChatHtml = await installChatHtmlResponse.text();
  assert.match(installChatHtml, /href="\/manifest\.webmanifest\?pairingToken=bind_install_chat_page_123"|href="manifest\.webmanifest\?pairingToken=bind_install_chat_page_123"/);

  const installPathHtmlResponse = await request(port, "/mobile/install/bind_install_path_page_123");
  assert.equal(installPathHtmlResponse.status, 200);
  assert.match(installPathHtmlResponse.headers.get("cache-control") || "", /no-store/);
  assert.match(installPathHtmlResponse.headers.get("set-cookie") || "", /lifeos_pairing_intent=bind_install_path_page_123/);
  const installPathHtml = await installPathHtmlResponse.text();
  assert.match(installPathHtml, /href="\/manifest\.webmanifest\?pairingToken=bind_install_path_page_123"|href="manifest\.webmanifest\?pairingToken=bind_install_path_page_123"/);

  const installIntentResponse = await request(port, "/api/v1/mobile/pairing-intent", {
    headers: { Cookie: "lifeos_pairing_intent=bind_install_cookie_recovery_123" },
  });
  assert.equal(installIntentResponse.status, 200);
  assert.match(installIntentResponse.headers.get("cache-control") || "", /no-store/);
  assert.deepEqual(await installIntentResponse.json(), { token: "bind_install_cookie_recovery_123" });

  const offlineResponse = await request(port, "/offline.html");
  assert.equal(offlineResponse.status, 200);
  assert.match(offlineResponse.headers.get("content-type") || "", /text\/html/);
  const offlineHtml = await offlineResponse.text();
  assert.match(offlineHtml, /You are offline/);
  assert.match(offlineHtml, /Device & Offline Queue/);
  assert.match(offlineHtml, /lifeos_offline_message_queue/);
  assert.match(offlineHtml, /lifeos-offline-queue/);
  assert.match(offlineHtml, /Queue source/);
  assert.match(offlineHtml, /IndexedDB/);
  assert.match(offlineHtml, /offline-queue-status/);
  assert.match(offlineHtml, /failed/);

  const manifestResponse = await request(port, "/manifest.webmanifest");
  assert.equal(manifestResponse.status, 200);
  assert.match(manifestResponse.headers.get("content-type") || "", /json|manifest/);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.name, "LifeOS AI");
  assert.equal(manifest.id, "/mobile/chat");
  assert.equal(manifest.start_url, "/mobile/chat");
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.display_override?.includes("standalone"));
  assert.equal(manifest.launch_handler?.client_mode, "navigate-existing");
  assert.equal(manifest.prefer_related_applications, false);
  assert.ok(manifest.icons?.length >= 1);
  assert.ok(manifest.icons.some((icon) => icon.src === "/icons/icon-192.png" && icon.sizes === "192x192" && icon.type === "image/png"));
  assert.ok(manifest.icons.some((icon) => icon.src === "/icons/icon-512.png" && icon.sizes === "512x512" && icon.type === "image/png"));
  assert.ok(manifest.icons.some((icon) => icon.purpose?.includes("maskable")));
  assert.ok(manifest.shortcuts?.every((shortcut) => shortcut.icons?.some((icon) => icon.src === "/icons/icon-192.png" && icon.type === "image/png")));
  assert.ok(manifest.screenshots?.length >= 2);
  const screenshotSources = manifest.screenshots.map((screenshot) => screenshot.src);
  assert.deepEqual(screenshotSources, ["/screenshots/real-mobile-chat.jpg", "/screenshots/real-mobile-device.jpg"]);
  assert.ok(manifest.screenshots.every((screenshot) => screenshot.sizes === "390x844"));
  assert.ok(manifest.screenshots.every((screenshot) => screenshot.type === "image/jpeg"));
  assert.ok(manifest.screenshots.every((screenshot) => screenshot.form_factor === "narrow"));
  assert.ok(manifest.screenshots.every((screenshot) => screenshot.label));

  const dynamicManifestResponse = await request(port, "/manifest.webmanifest?pairingToken=bind_install_demo_123");
  assert.equal(dynamicManifestResponse.status, 200);
  assert.match(dynamicManifestResponse.headers.get("content-type") || "", /json|manifest/);
  assert.match(dynamicManifestResponse.headers.get("cache-control") || "", /no-store/);
  const dynamicManifest = await dynamicManifestResponse.json();
  assert.equal(dynamicManifest.id, "/mobile/chat");
  assert.equal(dynamicManifest.start_url, "/mobile/install/bind_install_demo_123");
  assert.equal(dynamicManifest.shortcuts.find((shortcut) => shortcut.short_name === "Pair")?.url, "/mobile/install/bind_install_demo_123");
  assert.ok(dynamicManifest.icons.some((icon) => icon.src === "/icons/icon-512.png" && icon.type === "image/png"));

  const invalidDynamicManifestResponse = await request(port, "/manifest.webmanifest?pairingToken=not-secret");
  assert.match(invalidDynamicManifestResponse.headers.get("cache-control") || "", /no-cache/);
  const invalidDynamicManifest = await invalidDynamicManifestResponse.json();
  assert.equal(invalidDynamicManifest.start_url, "/mobile/chat");

  for (const screenshot of manifest.screenshots) {
    const screenshotResponse = await request(port, screenshot.src);
    assert.equal(screenshotResponse.status, 200);
    assert.match(screenshotResponse.headers.get("content-type") || "", /jpeg|image/);
    const bytes = new Uint8Array(await screenshotResponse.arrayBuffer());
    assert.equal(bytes[0], 0xff);
    assert.equal(bytes[1], 0xd8);
    assert.equal(bytes[bytes.length - 2], 0xff);
    assert.equal(bytes[bytes.length - 1], 0xd9);
  }

  for (const icon of ["/icons/icon-192.png", "/icons/icon-512.png"]) {
    const iconResponse = await request(port, icon);
    assert.equal(iconResponse.status, 200);
    assert.match(iconResponse.headers.get("content-type") || "", /png|image/);
  }

  const serviceWorkerResponse = await request(port, "/sw.js");
  assert.equal(serviceWorkerResponse.status, 200);
  assert.match(serviceWorkerResponse.headers.get("content-type") || "", /javascript/);
  const serviceWorker = await serviceWorkerResponse.text();
  assert.match(serviceWorker, /lifeos-ai-shell-v\d+/);
  assert.match(serviceWorker, /SHELL_ASSETS/);
  assert.match(serviceWorker, /extractBuildAssets/);
  assert.match(serviceWorker, /cacheBuildAssets/);
  assert.match(serviceWorker, /html\.match\(/);
  assert.match(serviceWorker, /assets/);
  assert.match(serviceWorker, /withBasePath\("\/"\)/);
  assert.match(serviceWorker, /cache\.addAll\(buildAssets\)/);
  assert.match(serviceWorker, /\/mobile\/chat/);
  assert.match(serviceWorker, /\/mobile\/device/);
  assert.match(serviceWorker, /\/mobile\/actions/);
  assert.match(serviceWorker, /OFFLINE_FALLBACK/);
  assert.match(serviceWorker, /\/offline\.html/);
  assert.match(serviceWorker, /\/screenshots\/real-mobile-chat\.jpg/);
  assert.match(serviceWorker, /\/screenshots\/real-mobile-device\.jpg/);
  assert.match(serviceWorker, /\/icons\/icon-192\.png/);
  assert.match(serviceWorker, /\/icons\/icon-512\.png/);
  assert.match(serviceWorker, /lifeos-offline-queue/);
  assert.match(serviceWorker, /LIFEOS_SYNC_OFFLINE_QUEUE/);
  assert.match(serviceWorker, /LIFEOS_SKIP_WAITING/);
  assert.match(serviceWorker, /if \(!response\.ok\) return response;/);

  const mainSource = await readFile(path.join(rootDir, "src", "main.tsx"), "utf8");
  assert.match(mainSource, /controllerchange/);
  assert.match(mainSource, /window\.location\.reload\(\)/);
  assert.match(mainSource, /registration\.update\(\)/);
  assert.match(mainSource, /LIFEOS_SKIP_WAITING/);
  assert.match(mainSource, /basename=\{lifeosBasePath \|\| undefined\}/);
  assert.match(mainSource, /navigator\.serviceWorker\.register\(`\$\{lifeosBasePath\}\/sw\.js`/);

  const indexHtmlSource = await readFile(path.join(rootDir, "index.html"), "utf8");
  const serverSource = await readFile(path.join(rootDir, "server.ts"), "utf8");
  assert.match(indexHtmlSource, /apple-mobile-web-app-capable/);
  assert.match(indexHtmlSource, /apple-touch-icon" sizes="192x192" href="icons\/icon-192\.png"/);
  assert.match(indexHtmlSource, /apple-touch-icon" sizes="512x512" href="icons\/icon-512\.png"/);
  assert.doesNotMatch(indexHtmlSource, /href="\/icons\//);
  assert.match(serverSource, /RUNNING_BUNDLED_SERVER/);
  assert.match(serverSource, /process\.env\.NODE_ENV !== "production" && !RUNNING_BUNDLED_SERVER/);

  const appSource = await readFile(path.join(rootDir, "src", "App.tsx"), "utf8");
  assert.match(appSource, /useOfflineQueueSync\(flushOfflineMessages\)/);
  assert.match(appSource, /resolveChatStateChanges\(stateChanges\)/);
  assert.match(appSource, /loadStoredChatMessages/);
  assert.match(appSource, /persistStoredChatMessages/);
  assert.doesNotMatch(appSource, /localStorage\.getItem\("lifeos_messages"/);
  assert.doesNotMatch(appSource, /localStorage\.setItem\("lifeos_messages"/);

  const chatMessageStorageSource = await readFile(path.join(rootDir, "src", "services", "chatMessageStorage.ts"), "utf8");
  assert.match(chatMessageStorageSource, /parseStoredChatMessages/);
  assert.match(chatMessageStorageSource, /defaultChatMessages/);
  assert.match(chatMessageStorageSource, /catch/);

  const chatPersistenceSource = await readFile(path.join(rootDir, "src", "hooks", "useChatPersistence.ts"), "utf8");
  const chatSessionStorageSource = await readFile(path.join(rootDir, "src", "services", "chatSessionStorage.ts"), "utf8");
  const lifeosApiSource = await readFile(path.join(rootDir, "src", "services", "lifeosApi.ts"), "utf8");
  assert.match(chatPersistenceSource, /loadActiveChatSessionId/);
  assert.match(chatPersistenceSource, /saveActiveChatSessionId/);
  assert.doesNotMatch(chatPersistenceSource, /localStorage\.(getItem|setItem)\("lifeos_active_chat_session_id"/);
  assert.match(chatSessionStorageSource, /ACTIVE_CHAT_SESSION_STORAGE_KEY/);
  assert.match(chatSessionStorageSource, /catch/);
  assert.match(lifeosApiSource, /clearActiveChatSessionId/);
  assert.doesNotMatch(lifeosApiSource, /localStorage\.removeItem\("lifeos_active_chat_session_id"/);

  const offlineQueueSyncHookSource = await readFile(path.join(rootDir, "src", "hooks", "useOfflineQueueSync.ts"), "utf8");
  assert.match(offlineQueueSyncHookSource, /offlineQueueSummary\.nextRetryAt/);
  assert.match(offlineQueueSyncHookSource, /window\.setTimeout\(\(\) => \{\s*void syncQueuedMessages\(\);/);

  const realtimeHookSource = await readFile(path.join(rootDir, "src", "hooks", "useLifeOSRealtime.ts"), "utf8");
  assert.match(realtimeHookSource, /reconnectTimerRef/);
  assert.match(realtimeHookSource, /clearReconnectTimer/);
  assert.match(realtimeHookSource, /window\.addEventListener\("online", handleOnline\)/);
  assert.match(realtimeHookSource, /document\.addEventListener\("visibilitychange", handleVisibilityChange\)/);
  assert.match(realtimeHookSource, /socketRef\.current !== ws/);

  const chatStateChangesSource = await readFile(path.join(rootDir, "src", "services", "chatStateChanges.ts"), "utf8");
  assert.match(chatStateChangesSource, /OPEN_APP/);
  assert.match(chatStateChangesSource, /REQUEST_APP_GENERATION/);
  assert.match(chatStateChangesSource, /widgetArgKeys/);

  const loginSource = await readFile(path.join(rootDir, "src", "pages", "admin", "AdminLoginPage.tsx"), "utf8");
  assert.match(loginSource, /onboardingRequired/);
  assert.match(loginSource, /session\.nextPath/);
  assert.match(lifeosApiSource, /admin\|mobile\|chat/);

  const onboardingSource = await readFile(path.join(rootDir, "src", "pages", "admin", "AdminOnboardingPage.tsx"), "utf8");
  const translationsSource = await readFile(path.join(rootDir, "src", "i18n", "translations.ts"), "utf8");
  assert.match(onboardingSource, /getOnboardingStatus/);
  assert.match(onboardingSource, /completeOnboarding/);
  assert.match(onboardingSource, /getBackupSchedule/);
  assert.match(onboardingSource, /updateBackupSchedule/);
  assert.match(onboardingSource, /updateActiveAiProvider/);
  assert.match(onboardingSource, /onboarding\.enableDailyBackup/);
  assert.match(onboardingSource, /backupSchedule\.nextRunAt/);
  assert.match(onboardingSource, /onboarding\.defaultProvider/);
  assert.match(onboardingSource, /onboarding\.setDefault/);
  assert.match(onboardingSource, /onboarding\.alreadyDefault/);
  assert.match(onboardingSource, /onboarding\.localEndpointLabel/);
  assert.match(onboardingSource, /type=\{isLocalProvider \? "url" : "password"\}/);
  assert.match(onboardingSource, /onboarding\.apiKeyHint/);
  assert.match(onboardingSource, /onboarding\.openConnectionGuide/);
  assert.match(onboardingSource, /\/admin\/settings#mobile-connect/);
  assert.match(onboardingSource, /onboarding\.finish/);
  assert.match(onboardingSource, /completedSteps} \/ 4/);
  assert.match(translationsSource, /开启每日自动备份/);
  assert.match(translationsSource, /本地模型端点/);
  assert.match(translationsSource, /Local Model Endpoint/);
  assert.match(translationsSource, /Set as Default Chat Provider/);
  const mobileChatSource = await readFile(path.join(rootDir, "src", "pages", "mobile", "MobileChatPage.tsx"), "utf8");
  assert.match(mobileChatSource, /mobile\.pastePairing/);
  assert.match(mobileChatSource, /mobile\.usePairingLink/);
  assert.match(mobileChatSource, /mobile\.pairingInvalid/);
  assert.match(translationsSource, /If scanning fails, paste the pairing link from the desktop/);
  assert.match(mobileChatSource, /consumePendingPairingToken/);
  assert.match(mobileChatSource, /peekPendingPairingToken/);
  assert.match(mobileChatSource, /recoveringPairingIntent/);
  assert.match(mobileChatSource, /mobile\.recoveringPairing/);
  assert.match(translationsSource, /正在恢复添加到桌面时保存的绑定信息/);
  assert.match(mobileChatSource, /launchPairingToken/);
  assert.match(mobileChatSource, /setPairingManifestToken/);
  assert.match(mobileChatSource, /pairingInstallPath/);
  assert.match(mobileChatSource, /pairingToken/);
  assert.doesNotMatch(mobileChatSource, /window\.location\.replace\(`\/mobile\/pair\?token=/);
  assert.doesNotMatch(mobileChatSource, /href="\/mobile\/pair"/);

  const mobilePairSource = await readFile(path.join(rootDir, "src", "pages", "mobile", "MobilePairPage.tsx"), "utf8");
  assert.match(mobilePairSource, /setPairingManifestToken/);
  assert.match(mobilePairSource, /consumePendingPairingToken/);
  assert.match(mobilePairSource, /pairingInstallPath/);
  assert.match(mobilePairSource, /history\.replaceState/);
  assert.doesNotMatch(mobilePairSource, /window\.location\.replace\(`\/mobile\/pair\?token=/);
  assert.match(mobilePairSource, /mobilePair\.installFirstHint/);
  assert.match(mobilePairSource, /mobilePair\.homeScreenHint/);
  assert.match(mobilePairSource, /testMobileRemoteConnectivity/);
  assert.match(mobilePairSource, /reportMobileConnectivity/);
  assert.match(mobilePairSource, /MobileConnectivityCard/);
  assert.match(mobilePairSource, /mobilePair\.connectivityTest/);
  assert.match(translationsSource, /保存 24 小时/);
  assert.match(translationsSource, /自动恢复到确认绑定页/);
  assert.match(translationsSource, /设备凭证已经保存/);
  assert.match(translationsSource, /测试当前手机连通性/);

  const mobileDeviceSource = await readFile(path.join(rootDir, "src", "pages", "mobile", "MobileDevicePage.tsx"), "utf8");
  assert.match(mobileDeviceSource, /getPwaCapabilityStatus/);
  assert.match(mobileDeviceSource, /getRemoteEntryStatus/);
  assert.match(mobileDeviceSource, /getRemoteEntryGuidance/);
  assert.match(mobileDeviceSource, /currentEntryGuidance/);
  assert.match(mobileDeviceSource, /mobileDevice\.pwaTitle/);
  assert.match(translationsSource, /PWA 安装与后台同步/);
  assert.match(mobileDeviceSource, /Service Worker/);
  assert.match(mobileDeviceSource, /Background Sync/);
  assert.match(mobileDeviceSource, /IndexedDB/);
  assert.match(mobileDeviceSource, /pwaCapabilities\.recommendations/);
  assert.match(mobileDeviceSource, /getHealth/);
  assert.match(mobileDeviceSource, /mobileDevice\.remoteEntryTitle/);
  assert.match(mobileDeviceSource, /mobileDevice\.remoteVerdict/);
  assert.match(mobileDeviceSource, /mobileDevice\.connectivityTest/);
  assert.match(mobileDeviceSource, /testMobileRemoteConnectivity/);
  assert.match(mobileDeviceSource, /reportMobileConnectivity/);
  assert.match(mobileDeviceSource, /MobileConnectivityCard/);
  assert.match(mobileDeviceSource, /queueSummary=\{queueSummary\}/);
  assert.match(mobileDeviceSource, /onRetry=\{handleConnectivityTest\}/);
  const mobileConnectivityCardSource = await readFile(path.join(rootDir, "src", "pages", "mobile", "MobileConnectivityCard.tsx"), "utf8");
  assert.match(mobileConnectivityCardSource, /getMobileRecoveryHints/);
  assert.match(mobileConnectivityCardSource, /getMobileConnectivityIssue/);
  assert.match(mobileConnectivityCardSource, /primaryIssue/);
  assert.match(mobileConnectivityCardSource, /isHttpRemoteBase/);
  assert.match(mobileConnectivityCardSource, /tailscaleHttpFallback/);
  assert.match(mobileConnectivityCardSource, /queueSummary/);
  assert.match(mobileConnectivityCardSource, /tailscale:\/\//);
  assert.match(mobileConnectivityCardSource, /mobileDevice\.openTailscale/);
  assert.match(mobileConnectivityCardSource, /mobileDevice\.rebindRemoteEntry/);
  assert.match(mobileConnectivityCardSource, /mobileDevice\.retryRealtime/);
  assert.match(translationsSource, /远程入口自检/);
  assert.match(translationsSource, /当前入口建议/);
  assert.match(translationsSource, /测试当前手机连通性/);
  assert.match(translationsSource, /打开 Tailscale/);
  assert.match(translationsSource, /重新绑定远程入口/);
  assert.match(translationsSource, /离线消息同步失败/);
  assert.match(translationsSource, /临时 Cloudflare Tunnel 很可能已失效/);
  assert.match(translationsSource, /Tailscale 通路不可达/);
  assert.match(translationsSource, /只有实时通道失败/);
  assert.match(translationsSource, /实时聊天通道/);
  assert.match(translationsSource, /Tailscale HTTPS 入口/);
  assert.match(translationsSource, /Tailscale HTTP 临时兜底入口/);
  assert.match(translationsSource, /同局域网入口/);
  assert.match(translationsSource, /当前使用临时 Cloudflare 地址/);
  assert.match(translationsSource, /当前入口与电脑端配置不一致/);

  const pwaCapabilitiesSource = await readFile(path.join(rootDir, "src", "services", "pwaCapabilities.ts"), "utf8");
  assert.match(pwaCapabilitiesSource, /serviceWorkerControlled/);
  assert.match(pwaCapabilitiesSource, /backgroundSyncSupported/);
  assert.match(pwaCapabilitiesSource, /indexedDbSupported/);
  assert.match(pwaCapabilitiesSource, /getRemoteEntryStatus/);
  assert.match(pwaCapabilitiesSource, /getRemoteEntryGuidance/);
  assert.match(pwaCapabilitiesSource, /getMobileRecoveryHints/);
  assert.match(pwaCapabilitiesSource, /getMobileConnectivityIssue/);
  assert.match(pwaCapabilitiesSource, /connectivityGuidanceTailscaleHttp/);
  assert.match(pwaCapabilitiesSource, /connectivityGuidanceFailedQueue/);
  assert.match(pwaCapabilitiesSource, /connectivityIssueTemporaryExpired/);
  assert.match(pwaCapabilitiesSource, /connectivityIssueTailscaleOffline/);
  assert.match(pwaCapabilitiesSource, /connectivityIssueWebSocket/);
  assert.match(pwaCapabilitiesSource, /testMobileRemoteConnectivity/);
  assert.match(pwaCapabilitiesSource, /\/api\/v1\/health/);
  assert.match(pwaCapabilitiesSource, /\/api\/v1\/ws/);
  const dashboardSource = await readFile(path.join(rootDir, "src", "pages", "admin", "AdminDashboardPage.tsx"), "utf8");
  assert.match(dashboardSource, /connectivityReport/);
  const deviceConnectivityStatusSource = await readFile(path.join(rootDir, "src", "pages", "admin", "DeviceConnectivityStatus.tsx"), "utf8");
  assert.match(deviceConnectivityStatusSource, /mobileShellOk/);
  assert.match(deviceConnectivityStatusSource, /dashboard\.mobileConnectivityChecks/);
  assert.match(deviceConnectivityStatusSource, /dashboard\.mobileConnectivityOk/);
  assert.match(translationsSource, /最近手机异地自检通过/);
  assert.match(pwaCapabilitiesSource, /temporary-cloudflare/);
  assert.match(pwaCapabilitiesSource, /configured-mismatch/);
  assert.match(pwaCapabilitiesSource, /After pairing, add LifeOS to the home screen/);
  assert.match(pwaCapabilitiesSource, /background sync is unavailable/);

  const sensitiveMainSource = await readFile(path.join(rootDir, "src", "main.tsx"), "utf8");
  assert.match(sensitiveMainSource, /clearSensitiveLocalStorageResidue/);

  const sensitiveLocalStorageSource = await readFile(path.join(rootDir, "src", "services", "sensitiveLocalStorage.ts"), "utf8");
  assert.match(sensitiveLocalStorageSource, /failedKeys/);
  assert.match(sensitiveLocalStorageSource, /try \{/);
  assert.match(sensitiveLocalStorageSource, /Some browser modes expose localStorage/);

  const syncedStateSource = await readFile(path.join(rootDir, "src", "hooks", "useSyncedClientState.ts"), "utf8");
  assert.match(syncedStateSource, /isSensitiveLocalStorageKey/);
  assert.match(syncedStateSource, /localStorage\.removeItem\(key\)/);
  assert.match(syncedStateSource, /!isSensitiveLocalStorageKey\(key\)/);
  assert.match(syncedStateSource, /export function readLocalState/);
  assert.match(syncedStateSource, /export function writeLocalState/);
  assert.match(syncedStateSource, /typeof localStorage === "undefined"/);
  assert.match(syncedStateSource, /Local cache is best-effort/);

  const studioConnectionSource = await readFile(path.join(rootDir, "src", "components", "apps", "studio", "useStudioConnectionSettings.ts"), "utf8");
  assert.doesNotMatch(studioConnectionSource, /useSyncedClientState\("lifeos_proxy_url"/);
  assert.match(studioConnectionSource, /clearSensitiveLocalStorageResidue/);
  assert.match(studioConnectionSource, /summarizeProxySubscriptionUrl/);
  assert.match(studioConnectionSource, /setProxyUrl\(""\)/);

  const studioAppSource = await readFile(path.join(rootDir, "src", "components", "apps", "StudioApp.tsx"), "utf8");
  assert.match(studioAppSource, /useStudioSimulatorState\(\)/);

  const studioSimulatorSource = await readFile(path.join(rootDir, "src", "components", "apps", "studio", "useStudioSimulatorState.ts"), "utf8");
  assert.match(studioSimulatorSource, /jarvis-sandbox-frame-log/);
  assert.match(studioSimulatorSource, /setRefineHistory\(\(prev\) => \[version, \.\.\.prev\]\.slice\(0, 10\)\)/);
  assert.match(studioSimulatorSource, /setSimulatorLogs\(\(prev\) => \[\.\.\.prev, log\]\.slice\(-6\)\)/);

  assert.match(mobileDeviceSource, /retryOfflineMessage/);
  assert.match(mobileDeviceSource, /removeOfflineMessages/);
  assert.match(mobileDeviceSource, /pairingInstallPath/);
  assert.doesNotMatch(mobileDeviceSource, /window\.location\.href = `\/mobile\/pair\?token=/);
  assert.match(mobileDeviceSource, /getOfflineMessageQueueStorageStatus/);
  assert.match(mobileDeviceSource, /MobileOfflineQueueCards/);
  assert.match(mobileDeviceSource, /clearOfflineMessageQueue/);

  assert.match(mobileDeviceSource, /mobileDevice\.confirmRemoveItem/);
  assert.match(mobileDeviceSource, /mobileDevice\.confirmClearQueue/);
  assert.match(mobileDeviceSource, /mobileDevice\.pastePairingLink/);
  assert.match(mobileDeviceSource, /mobileDevice\.rebindButton/);
  assert.match(mobileDeviceSource, /revokeCurrentDeviceBinding/);
  assert.match(mobileDeviceSource, /mobileDevice\.forgetBinding/);
  assert.match(mobileDeviceSource, /mobile\/install\/bind_/);
  assert.match(mobileDeviceSource, /mobileDevice\.storageTitle/);
  assert.match(mobileDeviceSource, /IndexedDB/);
  assert.match(mobileDeviceSource, /mobileDevice\.legacyCredential/);
  assert.match(translationsSource, /删除这条离线消息/);
  assert.match(translationsSource, /清空离线消息队列/);
  assert.match(translationsSource, /粘贴电脑端绑定链接/);
  assert.match(translationsSource, /清除旧凭证并重新绑定/);
  assert.match(translationsSource, /解除并撤销绑定/);
  assert.match(translationsSource, /bind_ 开头的绑定 token/);
  assert.match(translationsSource, /设备凭证存储/);
  assert.match(translationsSource, /localStorage 旧凭证/);
  assert.doesNotMatch(mobileDeviceSource, /href="\/mobile\/pair"/);

  const mobileOfflineQueueCardsSource = await readFile(path.join(rootDir, "src", "pages", "mobile", "MobileOfflineQueueCards.tsx"), "utf8");
  assert.match(mobileOfflineQueueCardsSource, /getOfflineMessageStatusLabel/);
  assert.match(mobileOfflineQueueCardsSource, /getOfflineMessageRetryLabel/);
  assert.match(mobileOfflineQueueCardsSource, /getOfflineMessageQueueStorageLabel/);
  assert.match(mobileOfflineQueueCardsSource, /getOfflineMessageQueueUsageLabel/);
  assert.match(mobileOfflineQueueCardsSource, /offlineQueue\.storageTitle/);
  assert.match(mobileOfflineQueueCardsSource, /offlineQueue\.legacyMirror/);
  assert.match(mobileOfflineQueueCardsSource, /offlineQueue\.persistentStorage/);
  assert.match(mobileOfflineQueueCardsSource, /offlineQueue\.failureReason/);
  assert.match(mobileOfflineQueueCardsSource, /offlineQueue\.retryOne/);
  assert.match(mobileDeviceSource, /offlineQueue\.remoteEntryTitle/);
  assert.match(mobileDeviceSource, /currentEntryGuidance\.map/);
  assert.match(translationsSource, /offlineQueue\.remoteEntryTitle/);
  assert.match(translationsSource, /离线队列存储/);
  assert.match(translationsSource, /localStorage 兼容镜像/);
  assert.match(translationsSource, /持久化存储/);
  assert.match(translationsSource, /失败原因/);
  assert.match(translationsSource, /单条重试/);

  const offlineQueueBannerSource = await readFile(path.join(rootDir, "src", "components", "chat", "OfflineQueueBanner.tsx"), "utf8");
  assert.match(offlineQueueBannerSource, /getOfflineMessageStatusLabel/);
  assert.match(offlineQueueBannerSource, /getOfflineMessageRetryLabel/);
  assert.doesNotMatch(offlineQueueBannerSource, /\{item\.status\}/);

  const offlineQueueSource = await readFile(path.join(rootDir, "src", "services", "offlineMessageQueue.ts"), "utf8");
  assert.match(offlineQueueSource, /getOfflineMessageStatusLabel/);
  assert.match(offlineQueueSource, /getOfflineMessageRetryLabel/);
  assert.match(offlineQueueSource, /getOfflineMessageQueueStorageStatus/);
  assert.match(offlineQueueSource, /formatOfflineMessageQueueBytes/);
  assert.match(offlineQueueSource, /getOfflineMessageQueueStorageLabel/);
  assert.match(offlineQueueSource, /getOfflineMessageQueueUsageLabel/);
  assert.match(offlineQueueSource, /IndexedDB primary storage/);
  assert.match(offlineQueueSource, /hydrateOfflineMessageQueue/);
  assert.match(offlineQueueSource, /writeIndexedQueue/);
  assert.match(offlineQueueSource, /persistentStorageGranted/);
  assert.match(offlineQueueSource, /Browser storage is near its limit/);
  assert.match(offlineQueueSource, /Ready to retry/);

  const mobileActionsSource = await readFile(path.join(rootDir, "src", "components", "apps", "SystemActionsApp.tsx"), "utf8");
  assert.match(mobileActionsSource, /actions\.loggedCount/);
  assert.match(mobileActionsSource, /actionLogSummary/);
  assert.match(mobileActionsSource, /ActionMetric/);
  assert.match(mobileActionsSource, /actions\.clearLogs/);
  assert.match(mobileActionsSource, /actions\.metricHighRisk/);
  assert.match(mobileActionsSource, /actions\.latestRecord/);
  assert.match(mobileActionsSource, /actions\.logLineOne/);
  assert.match(mobileActionsSource, /actions\.logLineTwo/);
  assert.match(mobileActionsSource, /riskLabel\(latestActionLog\.risk, t\)/);
  assert.match(mobileActionsSource, /loadAllowedUrlSchemes/);
  assert.match(mobileActionsSource, /writeSystemActionStorage/);
  assert.match(translationsSource, /动作权限中心/);
  assert.match(translationsSource, /清空记录/);
  assert.doesNotMatch(mobileActionsSource, /localStorage\.getItem\("lifeos_allowed_url_schemes"/);
  assert.doesNotMatch(mobileActionsSource, /localStorage\.setItem\("lifeos_system_actions"/);

  const systemActionStorageSource = await readFile(path.join(rootDir, "src", "services", "systemActionStorage.ts"), "utf8");
  assert.match(systemActionStorageSource, /loadSavedSystemActions/);
  assert.match(systemActionStorageSource, /loadSystemActionLogs/);
  assert.match(systemActionStorageSource, /normalizeSystemActionLog/);
  assert.match(systemActionStorageSource, /catch/);

  const connectionGuideSource = await readFile(path.join(rootDir, "src", "pages", "admin", "ConnectionGuide.tsx"), "utf8");
  assert.match(connectionGuideSource, /id="mobile-connect"/);
  assert.match(connectionGuideSource, /connection\.recommendedAddress/);
  assert.match(connectionGuideSource, /connection\.recommendedEnv/);
  assert.match(connectionGuideSource, /recommended-env/);
  assert.match(connectionGuideSource, /connection\.copyRecommendedEnv/);
  assert.match(connectionGuideSource, /connectionCandidates/);
  assert.match(connectionGuideSource, /connection\.restartBadge/);
  assert.match(connectionGuideSource, /connection\.copyMobileEntry/);
  assert.match(connectionGuideSource, /connection\.mobileEntry/);
  assert.match(connectionGuideSource, /connection\.pairingQrHint/);
  assert.match(translationsSource, /mobile\/install/);
  assert.doesNotMatch(connectionGuideSource, /copyText\("recommended-pair"/);
  assert.doesNotMatch(connectionGuideSource, /copyText\(candidate\.id, candidate\.mobilePairUrl\)/);
  assert.match(connectionGuideSource, /candidate\.envTemplate/);
  assert.match(connectionGuideSource, /candidate\.restartInstruction/);
  assert.match(connectionGuideSource, /connection\.copyEnv/);
  assert.match(connectionGuideSource, /saveDesktopConnectionConfig/);
  assert.match(connectionGuideSource, /connection\.saveDesktopConfig/);
  assert.match(connectionGuideSource, /connection\.packageRestartHint/);
  assert.match(connectionGuideSource, /TailscaleServeActions/);
  assert.match(connectionGuideSource, /startTailscaleHttpsServe/);
  const tailscaleServeActionsSource = await readFile(path.join(rootDir, "src", "pages", "admin", "TailscaleServeActions.tsx"), "utf8");
  assert.match(tailscaleServeActionsSource, /connection\.tailscaleServeStart/);
  assert.match(tailscaleServeActionsSource, /connection\.tailscaleServeUrl/);
  assert.match(tailscaleServeActionsSource, /tailscale\.magicDnsEnabled/);
  assert.match(tailscaleServeActionsSource, /connection\.tailscaleLoginRequired/);
  assert.match(tailscaleServeActionsSource, /connection\.tailscaleMagicDnsRequired/);
  assert.match(connectionGuideSource, /tailscale\.loginCommand/);
  assert.match(connectionGuideSource, /connection\.notDetected/);
  assert.match(translationsSource, /推荐绑定地址/);
  assert.match(translationsSource, /推荐启动环境/);
  assert.match(translationsSource, /复制推荐启动环境/);
  assert.match(translationsSource, /需重启生效/);
  assert.match(translationsSource, /复制手机入口/);
  assert.match(translationsSource, /手机端入口/);
  assert.match(translationsSource, /复制启动环境/);
  assert.match(translationsSource, /保存到桌面启动配置/);
  assert.match(translationsSource, /安装包用户/);
  assert.match(translationsSource, /退出并重新打开 LifeOS AI/);
  assert.match(translationsSource, /一键启动 Tailscale HTTPS Serve/);
  assert.match(translationsSource, /未检测到 MagicDNS/);
  assert.match(translationsSource, /Tailscale is installed but not online/);
  assert.match(connectionGuideSource, /desktopRuntimeConfig/);
  assert.match(connectionGuideSource, /connection\.testSavedRemote/);
  assert.match(connectionGuideSource, /saved-desktop-config/);
  assert.match(connectionGuideSource, /remoteValidationReport/);
  assert.match(connectionGuideSource, /connection\.remoteValidationOk/);
  assert.match(connectionGuideSource, /connection\.remoteValidationFail/);
  assert.match(connectionGuideSource, /persist,\s*label/);
  assert.match(connectionGuideSource, /desktopRuntimeConfig!\.publicBaseUrl/);
  assert.match(connectionGuideSource, /CustomRemoteEntryCard/);
  assert.match(connectionGuideSource, /RemoteReadinessCard/);
  assert.match(connectionGuideSource, /ConnectionToolStatus/);
  assert.match(connectionGuideSource, /installCopy/);
  const connectionToolStatusSource = await readFile(path.join(rootDir, "src", "pages", "admin", "ConnectionToolStatus.tsx"), "utf8");
  assert.match(connectionToolStatusSource, /connection\.copyInstallAria/);
  assert.match(connectionToolStatusSource, /connection\.openInstallGuide/);
  assert.match(translationsSource, /复制安装命令/);
  assert.match(translationsSource, /Copy Install Command/);
  assert.match(translationsSource, /验收已保存异地入口/);
  assert.match(translationsSource, /Smoke Test Saved Remote Entry/);
  const remoteReadinessCardSource = await readFile(path.join(rootDir, "src", "pages", "admin", "RemoteReadinessCard.tsx"), "utf8");
  assert.match(remoteReadinessCardSource, /remoteReadiness/);
  assert.match(remoteReadinessCardSource, /connection\.readiness\.status\.ready/);
  assert.match(remoteReadinessCardSource, /connection\.readiness\.item\.needsPublicOptIn/);
  const remoteHealthSummaryCardSource = await readFile(path.join(rootDir, "src", "pages", "admin", "RemoteHealthSummaryCard.tsx"), "utf8");
  const remoteAcceptanceChecklistSource = await readFile(path.join(rootDir, "src", "pages", "admin", "RemoteAcceptanceChecklistCard.tsx"), "utf8");
  const remoteStabilitySectionSource = await readFile(path.join(rootDir, "src", "pages", "admin", "RemoteStabilitySection.tsx"), "utf8");
  assert.match(connectionGuideSource, /RemoteStabilitySection/);
  assert.match(remoteStabilitySectionSource, /remoteHealthSummary/);
  assert.match(remoteStabilitySectionSource, /remoteHealthMonitor/);
  assert.match(remoteStabilitySectionSource, /remoteRecoveryReport/);
  assert.match(remoteStabilitySectionSource, /RemoteHealthSummaryCard/);
  assert.match(remoteStabilitySectionSource, /RemoteAcceptanceChecklistCard/);
  assert.match(remoteHealthSummaryCardSource, /connection\.health\.status\.healthy/);
  assert.match(remoteHealthSummaryCardSource, /qr-warning/);
  assert.match(remoteHealthSummaryCardSource, /entryKindKey/);
  assert.match(remoteHealthSummaryCardSource, /summary\.entryKind/);
  assert.match(translationsSource, /connection\.health\.entry\.tailscale/);
  assert.match(translationsSource, /connection\.health\.entry\.temporaryCloudflare/);
  assert.match(remoteHealthSummaryCardSource, /connection\.health\.check\.websocket/);
  assert.match(remoteHealthSummaryCardSource, /checkDetailText/);
  assert.match(remoteHealthSummaryCardSource, /connection\.health\.qrExpired/);
  assert.match(remoteHealthSummaryCardSource, /connection\.health\.recommendation\.replaceTemporaryTunnel/);
  assert.match(remoteHealthSummaryCardSource, /connection\.health\.recommendation\.refreshPairingQr/);
  assert.match(remoteHealthSummaryCardSource, /connection\.monitor\.title/);
  assert.match(remoteHealthSummaryCardSource, /monitor\.nextRunAt/);
  assert.match(remoteHealthSummaryCardSource, /monitor\.lastRunAt/);
  assert.match(translationsSource, /后台远程健康监控/);
  assert.match(translationsSource, /Background Remote Health Monitor/);
  assert.match(translationsSource, /最近生成的绑定二维码已过期/);
  const remoteValidationReportSource = await readFile(path.join(rootDir, "server", "remoteValidationReport.ts"), "utf8");
  assert.match(remoteValidationReportSource, /pairingEntryMismatch/);
  assert.match(remoteValidationReportSource, /pairingSession\?: \{ baseUrl\?: string \| null/);
  assert.match(remoteHealthSummaryCardSource, /connection\.recovery\.title/);
  assert.match(remoteHealthSummaryCardSource, /connection\.recovery\.summary/);
  assert.match(remoteHealthSummaryCardSource, /connection\.recovery\.health/);
  assert.match(remoteHealthSummaryCardSource, /recoveryActionKey/);
  assert.match(remoteHealthSummaryCardSource, /recovery\?\.recoveryAction \?\? "none"/);
  assert.match(remoteHealthSummaryCardSource, /healthOkBefore/);
  assert.match(remoteHealthSummaryCardSource, /healthOkAfter/);
  assert.match(remoteHealthSummaryCardSource, /restoredBaseUrl/);
  assert.match(translationsSource, /connection\.recovery\.restoredBaseUrl/);
  assert.match(translationsSource, /connection\.recovery\.action\.checkTailscale/);
  assert.match(translationsSource, /恢复前：\{\{before\}\}；恢复后：\{\{after\}\}/);
  assert.match(translationsSource, /长期异地验收未完成/);
  assert.match(remoteAcceptanceChecklistSource, /connection\.acceptance\.title/);
  assert.match(remoteAcceptanceChecklistSource, /connection\.acceptance\.smokeTitle/);
  assert.match(remoteAcceptanceChecklistSource, /connection\.acceptance\.copySmokeCommand/);
  assert.match(remoteAcceptanceChecklistSource, /connection\.acceptance\.commandTitle/);
  assert.match(remoteAcceptanceChecklistSource, /navigator\.clipboard\.writeText/);
  assert.match(remoteAcceptanceChecklistSource, /connection\.acceptance\.copyCommand/);
  assert.match(remoteAcceptanceChecklistSource, /connection\.acceptance\.runNow/);
  assert.match(remoteAcceptanceChecklistSource, /onRunAcceptance/);
  assert.match(remoteAcceptanceChecklistSource, /connection\.acceptance\.importTitle/);
  assert.match(remoteAcceptanceChecklistSource, /connection\.acceptance\.latestEvidence/);
  assert.match(remoteAcceptanceChecklistSource, /connection\.acceptance\.automatedPassed/);
  assert.match(remoteAcceptanceChecklistSource, /connection\.acceptance\.summaryReady/);
  assert.match(remoteAcceptanceChecklistSource, /connection\.acceptance\.nextActions/);
  assert.match(remoteAcceptanceChecklistSource, /summary\.blockingItems/);
  assert.match(remoteAcceptanceChecklistSource, /summary\.hasLongTermEntry/);
  assert.match(remoteStabilitySectionSource, /remoteAcceptanceSummary/);
  assert.match(remoteAcceptanceChecklistSource, /completionStatus/);
  assert.match(remoteAcceptanceChecklistSource, /connection\.acceptance\.manualStillRequired/);
  assert.match(remoteAcceptanceChecklistSource, /onImportReport/);
  assert.match(remoteAcceptanceChecklistSource, /runbooks\.latest/);
  assert.match(remoteAcceptanceChecklistSource, /connection\.acceptance\.markDone/);
  assert.match(remoteAcceptanceChecklistSource, /onAccept/);
  assert.match(remoteAcceptanceChecklistSource, /cellular-mobile-chat/);
  assert.match(remoteAcceptanceChecklistSource, /network-interruption/);
  assert.match(remoteAcceptanceChecklistSource, /diagnostic-export/);
  assert.match(remoteAcceptanceChecklistSource, /ci-remote-mock/);
  assert.match(remoteStabilitySectionSource, /acceptanceEvidence/);
  assert.match(remoteStabilitySectionSource, /Phone Wi-Fi disabled/);
  assert.match(remoteStabilitySectionSource, /Desktop app restarted/);
  assert.match(remoteStabilitySectionSource, /acceptingId/);
  assert.match(remoteStabilitySectionSource, /LIFEOS_REMOTE_ACCEPTANCE_OUT/);
  assert.match(remoteStabilitySectionSource, /LIFEOS_REMOTE_BASE_URL/);
  assert.match(remoteStabilitySectionSource, /npm run remote:smoke/);
  assert.match(remoteStabilitySectionSource, /npm run remote:acceptance/);
  assert.match(remoteStabilitySectionSource, /importRemoteAcceptanceReport/);
  assert.match(remoteStabilitySectionSource, /runRemoteAcceptance/);
  assert.match(remoteStabilitySectionSource, /JSON\.parse/);
  assert.match(translationsSource, /长期异地验收清单/);
  assert.match(translationsSource, /快速连通检查/);
  assert.match(translationsSource, /Quick Connectivity Smoke/);
  assert.match(translationsSource, /远程验收命令/);
  assert.match(translationsSource, /运行自动验收/);
  assert.match(translationsSource, /导入真实验收结果/);
  assert.match(translationsSource, /最近导入的真实验收/);
  assert.match(translationsSource, /最近自动恢复/);
  assert.match(translationsSource, /remote-acceptance\.json/);
  assert.match(translationsSource, /Long-Term Remote Acceptance Checklist/);
  assert.match(translationsSource, /Remote Acceptance Command/);
  assert.match(translationsSource, /Run Automated Acceptance/);
  assert.match(translationsSource, /Import Real Acceptance Evidence/);
  assert.match(translationsSource, /Latest Imported Real Acceptance/);
  assert.match(translationsSource, /Latest Auto-Recovery/);
  assert.match(translationsSource, /我已真实验收/);
  assert.match(translationsSource, /I verified this/);
  const customRemoteEntrySource = await readFile(path.join(rootDir, "src", "pages", "admin", "CustomRemoteEntryCard.tsx"), "utf8");
  assert.match(customRemoteEntrySource, /connection\.customTitle/);
  assert.match(customRemoteEntrySource, /testConnectionUrl/);
  assert.match(customRemoteEntrySource, /result\.steps/);
  assert.match(customRemoteEntrySource, /saveDesktopConnectionConfig/);
  assert.match(customRemoteEntrySource, /mode: "configured"/);
  assert.match(customRemoteEntrySource, /normalizedUrl\.startsWith\("https:\/\/"\)/);
  assert.match(translationsSource, /稳定异地入口/);
  assert.match(translationsSource, /已可长期异地使用/);
  assert.match(translationsSource, /LIFEOS_ALLOW_PUBLIC=1/);
  assert.match(translationsSource, /项通过/);
  assert.match(translationsSource, /checks passed/);
  assert.match(translationsSource, /Cloudflare Named Tunnel/);
  assert.match(translationsSource, /自动检查已通过，仍需完成真实手机\/重启\/断网验收/);
  assert.match(translationsSource, /credentials JSON 已找到/);
  assert.match(translationsSource, /credentials JSON is missing/);

  const cloudflareNamedTunnelCardSource = await readFile(path.join(rootDir, "src", "pages", "admin", "CloudflareNamedTunnelCard.tsx"), "utf8");
  assert.match(cloudflareNamedTunnelCardSource, /credentialsFileExists/);
  assert.match(cloudflareNamedTunnelCardSource, /connection\.namedCredentialsReady/);
  assert.match(cloudflareNamedTunnelCardSource, /connection\.namedCredentialsMissing/);

  const devicePairSource = await readFile(path.join(rootDir, "src", "pages", "admin", "DevicePairPage.tsx"), "utf8");
  assert.match(devicePairSource, /connectionCandidates/);
  assert.match(devicePairSource, /testConnectionUrl/);
  assert.match(devicePairSource, /devicePair\.testCurrent/);
  assert.match(devicePairSource, /connection\.secureRecommended/);
  assert.match(devicePairSource, /connection\.trustedNetworkOnly/);
  assert.match(devicePairSource, /connection\.restartBadge/);
  assert.match(devicePairSource, /activeCandidate\.envTemplate/);
  assert.match(devicePairSource, /activeCandidate\.restartInstruction/);
  assert.match(devicePairSource, /copiedEnv/);
  assert.match(devicePairSource, /devicePair\.copyEnv/);
  assert.match(devicePairSource, /devicePair\.restartTitle/);
  assert.match(devicePairSource, /devicePair\.temporaryTitle/);
  assert.match(devicePairSource, /devicePair\.temporaryBody/);
  assert.match(translationsSource, /测试当前绑定地址/);
  assert.match(translationsSource, /推荐安全/);
  assert.match(translationsSource, /仅可信网络/);
  assert.match(translationsSource, /复制当前绑定启动环境/);
  assert.match(translationsSource, /重启后生效/);
  assert.match(translationsSource, /这是临时地址/);

  const adminDashboardSource = await readFile(path.join(rootDir, "src", "pages", "admin", "AdminDashboardPage.tsx"), "utf8");
  assert.match(adminDashboardSource, /dashboard\.publicRiskTitle/);
  assert.match(adminDashboardSource, /health\.publicRisk\.items\.map/);
  assert.match(adminDashboardSource, /dashboard\.openSecuritySettings/);
  assert.match(adminDashboardSource, /dashboard\.createBackupNow/);
  assert.match(adminDashboardSource, /dashboard\.enableAutoBackup/);
  assert.match(adminDashboardSource, /\/admin\/settings#backup-schedule/);
  assert.match(adminDashboardSource, /previewBackup/);
  assert.match(adminDashboardSource, /dashboard\.preRestorePreview/);
  assert.match(adminDashboardSource, /dashboard\.restoreRisk/);
  assert.match(adminDashboardSource, /dashboard\.ordinaryBackupSafe/);
  assert.match(adminDashboardSource, /buildRestoreConfirmMessage/);
  assert.match(translationsSource, /公网\/异地访问存在待处理风险/);
  assert.match(translationsSource, /恢复前预览/);
  assert.match(translationsSource, /普通备份已排除敏感密钥/);

  const configDiagnosticsPanelSource = await readFile(path.join(rootDir, "src", "pages", "admin", "settings", "ConfigDiagnosticsPanel.tsx"), "utf8");
  assert.match(configDiagnosticsPanelSource, /diagnostics\.releasePackage/);
  assert.match(configDiagnosticsPanelSource, /diagnostics\.release\.manifestAvailable/);
  assert.match(configDiagnosticsPanelSource, /diagnostics\.release\.checksumAvailable/);
  assert.match(configDiagnosticsPanelSource, /latestArtifact/);
  assert.match(configDiagnosticsPanelSource, /backupSchedule\.enabled/);
  assert.match(configDiagnosticsPanelSource, /diagnostics\.autoBackup/);
  assert.match(translationsSource, /发布包/);
  assert.match(translationsSource, /自动备份/);

  const backupRestorePanelSource = await readFile(path.join(rootDir, "src", "pages", "admin", "settings", "BackupRestorePanel.tsx"), "utf8");
  assert.match(backupRestorePanelSource, /id="backup-schedule"/);
  assert.match(backupRestorePanelSource, /previewDataCleanup/);
  assert.match(backupRestorePanelSource, /backup\.previewCleanup/);
  assert.match(backupRestorePanelSource, /cleanupPreview/);
  assert.match(backupRestorePanelSource, /buildCleanupConfirmMessage/);
  assert.match(backupRestorePanelSource, /BackupPreviewCard/);
  assert.match(backupRestorePanelSource, /BackupList/);
  assert.match(translationsSource, /预览清理/);

  const backupListSource = await readFile(path.join(rootDir, "src", "pages", "admin", "settings", "BackupList.tsx"), "utf8");
  assert.match(backupListSource, /backupList\.empty/);
  assert.match(backupListSource, /backupDownloadUrl\(backup\.file\)/);
  assert.match(backupListSource, /onPreview\(backup\)/);
  assert.match(backupListSource, /onRestore\(backup\)/);

  const backupPreviewCardSource = await readFile(path.join(rootDir, "src", "pages", "admin", "settings", "BackupPreviewCard.tsx"), "utf8");
  assert.match(backupPreviewCardSource, /backupPreview\.title/);
  assert.match(backupPreviewCardSource, /preview\.tables/);
  assert.match(backupPreviewCardSource, /backupPreview\.secretsExcluded/);
  assert.match(backupPreviewCardSource, /backupPreview\.risks/);

  const backupRestoreUiSource = await readFile(path.join(rootDir, "src", "services", "backupRestoreUi.ts"), "utf8");
  assert.match(backupRestoreUiSource, /Backup preview:/);
  assert.match(backupRestoreUiSource, /Estimated cleanup/);
  assert.match(backupRestoreUiSource, /formatCleanupSummary/);

  const aiKeyPanelSource = await readFile(path.join(rootDir, "src", "pages", "admin", "settings", "AiKeyPanel.tsx"), "utf8");
  const chatRuntimeSettingsSource = await readFile(path.join(rootDir, "src", "services", "chatRuntimeSettings.ts"), "utf8");
  const aiRuntimeSource = await readFile(path.join(rootDir, "src", "services", "aiRuntime.ts"), "utf8");
  assert.match(aiKeyPanelSource, /listAiProviders/);
  assert.match(aiKeyPanelSource, /saveAiProviderKey/);
  assert.match(aiKeyPanelSource, /updateActiveAiProvider/);
  assert.match(aiKeyPanelSource, /updateAiProviderModel/);
  assert.match(aiKeyPanelSource, /testAiProvider/);
  assert.match(aiKeyPanelSource, /Google Gemini API Key/);
  assert.match(aiKeyPanelSource, /Responses \/ Chat Completions/);
  assert.match(aiKeyPanelSource, /aiKey\.details\.openrouter/);
  assert.match(aiKeyPanelSource, /Ollama \/ LM Studio endpoint/);
  assert.match(aiKeyPanelSource, /aiKey\.systemUnavailable/);
  assert.match(aiKeyPanelSource, /aiKey\.currentLocation/);
  assert.match(aiKeyPanelSource, /aiKey\.priorityStrategy/);
  assert.match(aiKeyPanelSource, /aiKey\.defaultProviderTitle/);
  assert.match(aiKeyPanelSource, /aiKey\.setDefault/);
  assert.match(aiKeyPanelSource, /aiKey\.migrateHint/);
  assert.match(translationsSource, /多模型聚合路由/);
  assert.match(translationsSource, /系统安全存储不可用/);
  assert.match(translationsSource, /当前保存位置/);
  assert.match(translationsSource, /优先策略/);
  assert.match(translationsSource, /默认聊天 Provider/);
  assert.match(translationsSource, /设为默认聊天 Provider/);
  assert.match(translationsSource, /重新保存一次可迁移到系统安全存储/);
  assert.match(chatRuntimeSettingsSource, /lifeos_active_ai_provider/);
  assert.match(chatRuntimeSettingsSource, /providerId/);
  assert.match(chatRuntimeSettingsSource, /readLocalRuntimeValue/);
  assert.match(chatRuntimeSettingsSource, /lifeos_proxy_nodes/);
  assert.doesNotMatch(chatRuntimeSettingsSource, /getClientState\("[^"]+", localStorage\.getItem/);
  assert.match(aiRuntimeSource, /providerId\?: string/);
});

test("development server injects pairing manifest before Vite serves mobile install pages", async (t) => {
  const port = await getOpenPort();
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-frontend-dev-smoke-"));
  const child = spawn(nodeCommand, ["--import", "tsx", "server.ts"], {
    cwd: rootDir,
    env: {
      ...process.env,
      NODE_ENV: "development",
      LIFEOS_PORT: String(port),
      LIFEOS_DATA_DIR: dataDir,
      LIFEOS_HOST: "127.0.0.1",
      PUBLIC_BASE_URL: "",
      APP_URL: "",
      PATH: childProcessPathEnv,
      Path: childProcessPathEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
    ...nodeSpawnOptions,
  });
  const childOutput = [];
  child.stdout.on("data", (chunk) => childOutput.push(chunk.toString()));
  child.stderr.on("data", (chunk) => childOutput.push(chunk.toString()));

  t.after(async () => {
    await stopServer(child);
    await rm(dataDir, { recursive: true, force: true });
  });

  await waitForServer(port, child, childOutput);

  const pairResponse = await request(port, "/mobile/pair?token=bind_dev_install_pair_123");
  assert.equal(pairResponse.status, 200);
  assert.match(pairResponse.headers.get("cache-control") || "", /no-store/);
  assert.match(pairResponse.headers.get("set-cookie") || "", /lifeos_pairing_intent=bind_dev_install_pair_123/);
  const pairHtml = await pairResponse.text();
  assert.match(pairHtml, /href="\/manifest\.webmanifest\?pairingToken=bind_dev_install_pair_123"/);

  const chatResponse = await request(port, "/mobile/chat?pairingToken=bind_dev_install_chat_123");
  assert.equal(chatResponse.status, 200);
  assert.match(chatResponse.headers.get("cache-control") || "", /no-store/);
  assert.match(chatResponse.headers.get("set-cookie") || "", /lifeos_pairing_intent=bind_dev_install_chat_123/);
  const chatHtml = await chatResponse.text();
  assert.match(chatHtml, /href="\/manifest\.webmanifest\?pairingToken=bind_dev_install_chat_123"/);

  const installPathResponse = await request(port, "/mobile/install/bind_dev_install_path_123");
  assert.equal(installPathResponse.status, 200);
  assert.match(installPathResponse.headers.get("cache-control") || "", /no-store/);
  assert.match(installPathResponse.headers.get("set-cookie") || "", /lifeos_pairing_intent=bind_dev_install_path_123/);
  const installPathHtml = await installPathResponse.text();
  assert.match(installPathHtml, /href="\/manifest\.webmanifest\?pairingToken=bind_dev_install_path_123"/);
});
