import { devices, expect, test, type Route } from "@playwright/test";

const password = "correct horse battery staple";
const rotatedPassword = "LifeOS remote passphrase 2026!";

async function csrfHeaders(page: import("@playwright/test").Page) {
  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === "lifeos_csrf")?.value;
  expect(csrf).toBeTruthy();
  return { "X-LifeOS-CSRF": csrf! };
}

async function writeOfflineQueue(page: import("@playwright/test").Page, queue: Array<Record<string, unknown>>) {
  await page.evaluate(async (items) => {
    localStorage.setItem("lifeos_offline_message_queue", JSON.stringify(items));
    const request = indexedDB.open("lifeos-offline-queue", 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("queues")) request.result.createObjectStore("queues");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("queues", "readwrite");
      transaction.objectStore("queues").put({ queue: items, updatedAt: Date.now() }, "primary");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }, queue);
}

type IcloudOnboardingPhase = "missing-entry" | "entry-ready" | "phone-confirmed";

function makeIcloudFileAvailability(exists: boolean) {
  return {
    exists,
    readable: exists,
    placeholder: false,
    placeholderPath: "",
    size: exists ? 4096 : 0,
    metadata: {
      available: true,
      downloaded: exists,
      downloading: false,
      uploaded: exists,
      uploading: false,
      downloadingStatus: "",
      uploadingStatus: "",
      syncState: exists ? "synced" : "unknown",
      error: "",
    },
    updatedAt: exists ? Date.now() : 0,
    placeholderUpdatedAt: 0,
    syncStuck: false,
    state: exists ? "ready" : "missing",
  };
}

function makeIcloudOnboardingDiagnostics(phase: IcloudOnboardingPhase) {
  const now = Date.now();
  const hasEntry = phase !== "missing-entry";
  const phoneConfirmed = phase === "phone-confirmed";
  const entryGeneratedAt = hasEntry ? now - 5_000 : 0;
  const baseUrl = "https://lifeos-apple-e2e.example.test";
  const handoffFilePath = "/Users/test/Library/Mobile Documents/com~apple~CloudDocs/LifeOS AI/lifeos-mobile-entry.html";
  const packetFilePath = "/Users/test/Library/Mobile Documents/com~apple~CloudDocs/LifeOS AI/lifeos-mobile-entry.json";
  const indexFilePath = "/Users/test/Library/Mobile Documents/com~apple~CloudDocs/LifeOS AI/lifeos-mobile-entry-index.html";
  const entryChecksum = "a".repeat(64);
  const icloudFile = makeIcloudFileAvailability(hasEntry);
  const syncReadiness = hasEntry
    ? {
      status: "ready",
      severity: "ok",
      canOpenOnPhone: true,
      action: "open-files-app",
      userStep: {
        id: "open-phone-files-app",
        primaryAction: "open-files-app",
        titleKey: "onboarding.appleRemoteIcloudNextStepPhoneTitle",
        bodyKey: "onboarding.appleRemoteIcloudNextStepPhoneBody",
        severity: "ok",
        pendingCount: 0,
        pendingFiles: [],
        missingFiles: [],
        humanRecovery: {
          titleKey: "onboarding.appleRemoteIcloudHumanRecoveryOpenTitle",
          bodyKey: "onboarding.appleRemoteIcloudHumanRecoveryOpenBody",
          primaryCtaKey: "onboarding.appleRemoteIcloudActionOpenFiles",
          afterKey: "onboarding.appleRemoteIcloudFollowupOpenFiles",
          desktopAction: "none",
          phoneAction: "open-files-app",
          showTechnicalDetails: false,
          severity: "ok",
        },
      },
      pendingCount: 0,
      pendingFiles: [],
      missingFiles: [],
      htmlFileState: "ready",
      packetFileState: "ready",
      indexFileState: "ready",
    }
    : {
      status: "no-entry",
      severity: "warning",
      canOpenOnPhone: false,
      action: "export-entry",
      userStep: {
        id: "create-phone-entry",
        primaryAction: "export-icloud-entry",
        titleKey: "onboarding.appleRemoteIcloudNextStepExportTitle",
        bodyKey: "onboarding.appleRemoteIcloudNextStepExportBody",
        severity: "warning",
        pendingCount: 0,
        pendingFiles: [],
        missingFiles: ["html", "packet", "index"],
        humanRecovery: {
          titleKey: "onboarding.appleRemoteIcloudHumanRecoveryExportTitle",
          bodyKey: "onboarding.appleRemoteIcloudHumanRecoveryExportBody",
          primaryCtaKey: "onboarding.appleRemoteIcloudActionCreateEntry",
          afterKey: "onboarding.appleRemoteIcloudFollowupCreateEntry",
          desktopAction: "export-icloud-entry",
          phoneAction: "open-files-app-after-sync",
          showTechnicalDetails: false,
          severity: "warning",
        },
      },
      pendingCount: 0,
      pendingFiles: [],
      missingFiles: ["html", "packet", "index"],
      htmlFileState: "missing",
      packetFileState: "missing",
      indexFileState: "missing",
    };
  const diagnostics = {
    host: "127.0.0.1",
    port: "3333",
    publicBaseUrl: "",
    publicAccessAllowed: false,
    lanUrls: ["http://192.168.31.10:3333"],
    lanEnvTemplate: "LIFEOS_HOST=0.0.0.0 LIFEOS_ALLOW_PUBLIC=1 npm run start",
    recommendedBaseUrl: baseUrl,
    remoteReadiness: {
      status: "ready",
      severity: "ok",
      candidateId: "cloudflare-apple-e2e",
      baseUrl,
      blockers: [],
      actions: [{ id: "ready", detail: "HTTPS entry is ready for mobile pairing." }],
    },
    connectionCandidates: [
      {
        id: "cloudflare-apple-e2e",
        label: "Cloudflare Tunnel",
        baseUrl,
        mode: "cloudflare",
        priority: 90,
        requiresRestart: false,
        stability: "stable",
        secure: true,
        envTemplate: `PUBLIC_BASE_URL=${baseUrl} npm run start`,
        restartInstruction: "",
        mobilePairUrl: `${baseUrl}/mobile/pair`,
        mobileChatUrl: `${baseUrl}/mobile/chat`,
        notes: ["Stable HTTPS entry for Apple onboarding."],
      },
    ],
    desktopRuntimeConfig: {
      mode: "cloudflare",
      label: "Cloudflare Tunnel",
      host: "127.0.0.1",
      port: 3333,
      publicBaseUrl: baseUrl,
      allowPublic: false,
      baseUrl,
      updatedAt: now,
    },
    icloud: {
      platform: "darwin",
      platformSupported: true,
      available: true,
      canExport: true,
      desktopId: "desktop-e2e",
      desktopName: "Playwright Mac",
      desktopSlug: "playwright-mac",
      drivePath: "/Users/test/Library/Mobile Documents/com~apple~CloudDocs",
      appFolderPath: "/Users/test/Library/Mobile Documents/com~apple~CloudDocs/LifeOS AI",
      handoffFilePath: hasEntry ? handoffFilePath : "",
      packetFilePath: hasEntry ? packetFilePath : "",
      indexFilePath: hasEntry ? indexFilePath : "",
      historyFilePath: "/Users/test/Library/Mobile Documents/com~apple~CloudDocs/LifeOS AI/lifeos-mobile-entry-history.json",
      availableEntries: hasEntry ? [{
        desktopId: "desktop-e2e",
        desktopName: "Playwright Mac",
        desktopSlug: "playwright-mac",
        fileName: "lifeos-mobile-entry.html",
        htmlFileName: "lifeos-mobile-entry.html",
        packetFileName: "lifeos-mobile-entry.json",
        label: "Playwright Mac",
        baseUrl,
        mode: "cloudflare",
        stability: "stable",
        secure: true,
        generatedAt: entryGeneratedAt,
        refreshAfter: now + 86_400_000,
        expiresAt: now + 604_800_000,
        entryChecksumSha256: entryChecksum,
      }] : [],
      entryHistory: [],
      lifecycle: {
        retentionLimit: 5,
        expiredGraceMs: 604_800_000,
        entryCount: hasEntry ? 1 : 0,
        expiredEntryCount: 0,
        prunableEntryCount: 0,
        orphanedFileCount: 0,
      },
      recommendedBaseUrl: baseUrl,
      recommendedLabel: "Cloudflare Tunnel",
      recommendedMode: "cloudflare",
      recommendedStability: "stable",
      handoffHealth: {
        status: hasEntry ? "fresh" : "missing",
        needsRefresh: false,
        lastExportedAt: entryGeneratedAt,
        lastExportedBaseUrl: hasEntry ? baseUrl : "",
        refreshAfter: hasEntry ? now + 86_400_000 : 0,
        expiresAt: hasEntry ? now + 604_800_000 : 0,
        refreshAfterMs: 86_400_000,
        expiresAfterMs: 604_800_000,
        checksumOk: hasEntry ? true : null,
        entryChecksumSha256: hasEntry ? entryChecksum : "",
        expectedChecksumSha256: hasEntry ? entryChecksum : "",
        htmlConsistency: {
          status: hasEntry ? "matching" : "missing",
          ok: hasEntry,
          exists: hasEntry,
          checksumSha256: hasEntry ? entryChecksum : "",
          generatedAt: entryGeneratedAt,
          reason: hasEntry ? "matching" : "missing",
        },
        reason: hasEntry ? "fresh" : "missing",
      },
      indexConsistency: {
        status: hasEntry ? "matching" : "missing",
        ok: hasEntry,
        exists: hasEntry,
        checksumSha256: hasEntry ? entryChecksum : "",
        expectedChecksumSha256: hasEntry ? entryChecksum : "",
        generatedAt: entryGeneratedAt,
        latestEntryGeneratedAt: entryGeneratedAt,
        expectedLatestEntryGeneratedAt: entryGeneratedAt,
        entryCount: hasEntry ? 1 : 0,
        expectedEntryCount: hasEntry ? 1 : 0,
        writerDesktopId: "desktop-e2e",
        reason: hasEntry ? "matching" : "missing",
      },
      availability: {
        status: "ready",
        severity: "ok",
        drivePathDetected: true,
        appFolderExists: true,
        driveWritable: true,
        appFolderWritable: true,
        placeholderCount: 0,
        metadataPendingCount: 0,
        pendingCount: 0,
        placeholderStuckCount: 0,
        metadataStuckCount: 0,
        syncStuckCount: 0,
        syncStuckAfterMs: 180_000,
        placeholderSamples: [],
        account: { checked: true, status: "ready", signedIn: true, driveEnabled: true, source: "override", error: "" },
        syncService: { checked: true, running: true, processNames: ["bird"], error: "" },
        handoffFile: icloudFile,
        packetFile: icloudFile,
        indexFile: icloudFile,
      },
      syncReadiness,
      dataSync: {
        enabled: false,
        ready: false,
        mode: "handoff-only",
        status: "not-enabled",
        severity: "warning",
        dataSyncScope: "entry-file-only",
        containerId: "",
        teamIdConfigured: false,
        bundleId: "ai.lifeos.desktop",
        nativeHelper: { configured: false, detected: false, executable: false },
        entitlements: { detected: false, mentionsCloudKit: false, mentionsContainer: false },
        selectedDataTypes: [],
        blockedDataTypes: ["chat", "memory", "tasks", "devices"],
        blockedDataTypePolicy: "CloudKit native client required before syncing user data.",
        notSyncedDataTypes: ["chat", "memory", "tasks", "devices"],
        credentialBoundary: {
          policy: "CloudKit may mirror reviewable device trust metadata, but it must never grant access or sync login material.",
          safeDataType: "device-trust",
          safeFields: ["deviceIdHash", "displayName", "deviceType", "trustState", "publicKeyFingerprint"],
          neverSyncedFields: ["device access token", "device token hash", "raw device credential", "device private key", "session cookie", "private key", "raw public key"],
          importedDeviceAction: "Imported Apple device records stay review-only until the user rebinds the phone or explicitly approves local trust.",
          phoneRecoveryAction: "Create a new pairing QR and rotate the old device token instead of restoring credentials from iCloud.",
          userFacingSummary: "iCloud can help LifeOS remember which Apple device was seen, but it cannot silently log that device in.",
        },
        recordPlan: [],
        requiredNativeCapabilities: ["CloudKit container", "native helper"],
        nativeHelperContract: {
          protocolVersion: 1,
          transport: "json-stdio",
          requestSchema: "lifeos-cloudkit-helper-request.v1",
          responseSchema: "lifeos-cloudkit-helper-response.v1",
          operations: ["probe", "roundtrip"],
          commandArgs: ["--lifeos-cloudkit-json"],
          timeoutMs: 5000,
        },
        acceptanceGates: [
          { id: "native-helper", status: "blocked", detail: "Native helper is not configured." },
        ],
        requiresNativeAppleClient: true,
        requiresCloudKitContainer: true,
        requiresExplicitUserOptIn: true,
        nextAction: "Configure CloudKit native sync when native clients ship.",
      },
      phoneConfirmation: {
        status: phoneConfirmed ? "confirmed" : "missing",
        severity: phoneConfirmed ? "ok" : "warning",
        action: phoneConfirmed ? "none" : "open-on-phone",
        confirmedAt: phoneConfirmed ? now : 0,
        confirmedDeviceId: phoneConfirmed ? "iphone-e2e" : "",
        confirmedDeviceName: phoneConfirmed ? "Playwright iPhone" : "",
        confirmedDeviceType: phoneConfirmed ? "ios" : "",
        confirmedEntryBaseUrl: phoneConfirmed ? baseUrl : "",
        confirmedEntryGeneratedAt: phoneConfirmed ? entryGeneratedAt : 0,
        expectedEntryGeneratedAt: entryGeneratedAt,
        expectedBaseUrl: baseUrl,
        latestProblemAt: 0,
        latestProblemEventType: "",
        latestProblemDeviceName: "",
        reason: phoneConfirmed ? "phone-opened-current-entry" : "waiting-for-phone",
      },
      pairingSession: {
        status: phoneConfirmed ? "missing" : "missing",
        severity: phoneConfirmed ? "warning" : "warning",
        action: phoneConfirmed ? "create-qr" : "none",
        bindingId: "",
        baseUrl,
        expectedBaseUrl: baseUrl,
        createdAt: 0,
        expiresAt: 0,
        confirmedAt: 0,
        confirmedDeviceId: "",
        expired: false,
        secondsRemaining: 0,
        reason: phoneConfirmed ? "phone-ready-for-qr" : "waiting-for-phone",
      },
      realtimeTransport: false,
      transport: "handoff-only",
      openInstruction: "Open iPhone Files app: iCloud Drive > LifeOS AI > lifeos-mobile-entry.html",
      notes: ["E2E fixture for Apple first launch."],
      latestEntryOpenEvent: phoneConfirmed ? {
        id: "event-current-e2e",
        eventType: "opened-current-entry",
        deviceId: "iphone-e2e",
        deviceName: "Playwright iPhone",
        deviceType: "ios",
        entryBaseUrl: baseUrl,
        entryGeneratedAt,
        occurredAt: now,
      } : null,
      latestIgnoredEntryEvent: null,
      latestEntryIssueEvent: null,
      latestEntryRepair: {
        status: phoneConfirmed ? "current-entry-opened" : "none",
        severity: "ok",
        action: "none",
        eventId: phoneConfirmed ? "event-current-e2e" : "",
        eventType: phoneConfirmed ? "opened-current-entry" : "",
        deviceId: phoneConfirmed ? "iphone-e2e" : "",
        deviceName: phoneConfirmed ? "Playwright iPhone" : "",
        deviceType: phoneConfirmed ? "ios" : "",
        eventAt: phoneConfirmed ? now : 0,
        entryBaseUrl: phoneConfirmed ? baseUrl : "",
        currentBaseUrl: baseUrl,
        storedBaseUrl: baseUrl,
        recommendedBaseUrl: baseUrl,
        lastExportedBaseUrl: baseUrl,
        entryGeneratedAt,
        storedGeneratedAt: entryGeneratedAt,
        checksumPresent: hasEntry,
        needsRefresh: false,
        needsQr: false,
        reason: phoneConfirmed ? "current-entry-opened" : "none",
      },
      latestRepairImport: null,
      acceptance: {
        ready: false,
        generatedAt: now,
        passed: phoneConfirmed ? 2 : hasEntry ? 1 : 0,
        total: 9,
        needsAction: phoneConfirmed ? 1 : 2,
        manualRequired: 5,
        recommendedAction: phoneConfirmed ? "regenerate-qr" : hasEntry ? "open-on-phone" : "export-icloud-entry",
        nextItemId: phoneConfirmed ? "pairing-qr-current" : hasEntry ? "phone-opened-current-entry" : "icloud-entry-synced",
        nextManualItemId: "cellular-mobile-chat",
        items: [
          { id: "icloud-entry-synced", status: hasEntry ? "passed" : "needs-action", severity: hasEntry ? "ok" : "warning", evidence: hasEntry ? "entry synced" : "entry missing", action: hasEntry ? "ready" : "export-icloud-entry" },
          { id: "phone-opened-current-entry", status: phoneConfirmed ? "passed" : "needs-action", severity: phoneConfirmed ? "ok" : "warning", evidence: phoneConfirmed ? "phone opened current entry" : "waiting", action: phoneConfirmed ? "ready" : "open-on-phone" },
          { id: "pairing-qr-current", status: "needs-action", severity: "warning", evidence: "QR not confirmed yet", action: "regenerate-qr" },
          { id: "cellular-mobile-chat", status: "manual-required", severity: "warning", evidence: "Real device evidence required", action: "record-real-world-check" },
        ],
      },
    },
    remoteValidationReport: {
      id: "remote-e2e",
      label: "Cloudflare Tunnel",
      baseUrl,
      url: baseUrl,
      ok: true,
      status: 200,
      latencyMs: 12,
      passed: 3,
      total: 3,
      createdAt: now,
      httpsStatus: { ok: true, protocol: "https:", requiredForLongTerm: true, trustedByRuntime: true },
      steps: [],
      recommendations: [],
    },
    remoteHealthMonitor: {
      enabled: true,
      status: "healthy",
      lastRunAt: now,
      nextRunAt: now + 60_000,
      intervalMs: 60_000,
      lastError: "",
      report: null,
    },
    cloudflare: {
      installed: true,
      running: true,
      managed: { running: false, starting: false, url: "", pid: null, startedAt: null, command: "", lastOutput: "", lastError: "" },
      version: "cloudflared version 2026.6.0",
      detectedUrls: [baseUrl],
      suggestedCommand: "cloudflared tunnel --url http://127.0.0.1:3333",
      installCommand: "brew install cloudflared",
      envTemplate: `PUBLIC_BASE_URL=${baseUrl} npm run start`,
      notes: ["Cloudflare Tunnel is ready."],
    },
    tailscale: {
      installed: false,
      online: false,
      version: "",
      deviceName: "",
      tailnetName: "",
      urls: [],
      magicDnsUrls: [],
      mobileUrls: [],
      installCommand: "brew install --cask tailscale-app",
      installUrl: "https://tailscale.com/download",
      envTemplate: "LIFEOS_HOST=0.0.0.0 LIFEOS_ALLOW_PUBLIC=1 npm run start",
      notes: ["Tailscale CLI is unavailable in this fixture."],
    },
    safety: {
      publicModeRequired: false,
      requiresHttpsForInternet: false,
      notes: ["HTTPS tunnel is used for Apple onboarding."],
    },
  };
  return diagnostics;
}

test("admin setup, mobile binding, chat shell, and device revoke flow", async ({ browser, page }) => {
  let icloudPhase: IcloudOnboardingPhase = "missing-entry";
  let icloudExportAttempts = 0;
  let networkDiagnosticsAttempts = 0;
  let inlinePairingStartAttempts = 0;
  let inlinePairingStartFulfilled = 0;
  const onboardingContext = page.context();
  await onboardingContext.route("**/api/v1/admin/network-diagnostics", async (route) => {
    networkDiagnosticsAttempts += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(makeIcloudOnboardingDiagnostics(icloudPhase)),
    });
  });
  await onboardingContext.route("**/api/v1/admin/icloud-handoff/export", async (route) => {
    icloudExportAttempts += 1;
    if (icloudPhase !== "phone-confirmed") icloudPhase = "entry-ready";
    const diagnostics = makeIcloudOnboardingDiagnostics(icloudPhase);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        handoff: {
          ...diagnostics.icloud,
          ok: true,
          generatedAt: Date.now(),
          cleanup: {
            removedEntryCount: 0,
            removedOrphanedFileCount: 0,
            removedFiles: [],
            errorCount: 0,
            errors: [],
            expiredGraceMs: 604_800_000,
          },
        },
        diagnostics,
        message: "LifeOS mobile entry was exported to iCloud Drive.",
      }),
    });
  });
  await page.context().addInitScript(() => {
    localStorage.setItem("lifeos_locale", "zh-CN");
  });
  await page.goto("/admin/login");
  await expect(page.getByText("首次启动向导")).toBeVisible();
  await expect(page.getByText("配置 AI Key，并创建第一份备份")).toBeVisible();
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByLabel("确认密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "完成初始化" }).click();
  await expect(page).toHaveURL(/\/admin\/onboarding/);
  await expect(page.getByText("先把 LifeOS AI 用起来")).toBeVisible();
  await expect(page.getByText("每一步只做一件事")).toBeVisible();
  await expect(page.getByText("第一步：接上一个模型")).toBeVisible();
  await expect(page.getByLabel("选择模型服务")).toBeVisible();
  await expect(page.getByText("高级功能、备份和诊断")).toBeVisible();
  await expect(page.getByText("创建备份")).toBeHidden();
  await expect(page.getByTestId("onboarding-progress-count")).toHaveText("0 / 3");
  await page.route("**/api/v1/admin/ai-providers/openai/test", async (route) => {
    expect(route.request().method()).toBe("POST");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        provider: {
          id: "openai",
          provider: "OpenAI",
          envVar: "OPENAI_API_KEY",
          configured: true,
          source: "database",
          storage: "local_aes_gcm",
          active: true,
          selectedModel: "gpt-4o",
          defaultModel: "gpt-4o-mini",
          models: ["gpt-4o-mini", "gpt-4o"],
        },
        message: "OpenAI 连接测试通过。",
      }),
    });
  });
  await page.getByLabel("选择模型服务").selectOption("openai");
  await page.getByText("高级：指定模型 ID").click();
  await page.getByLabel("OpenAI 模型").fill("gpt-4o");
  await page.getByPlaceholder("输入 API Key").fill("sk-playwright-onboarding-secret-value");
  networkDiagnosticsAttempts = 0;
  await page.getByRole("button", { name: "保存并继续" }).click();
  await expect(page.getByText("第二步：用手机扫码")).toBeVisible();
  await expect.poll(() => networkDiagnosticsAttempts, { timeout: 15_000 }).toBeGreaterThan(0);
  const quickIcloudEntry = page.getByTestId("onboarding-icloud-quick-entry");
  await expect(quickIcloudEntry).toBeVisible({ timeout: 15_000 });
  await expect(quickIcloudEntry).toContainText("Apple");
  await expect(page.getByTestId("onboarding-icloud-default-flow")).toBeVisible();
  await expect(page.getByTestId("onboarding-device-backup-qr")).toBeVisible();
  await expect(page.getByTestId("onboarding-progress-count")).toHaveText("1 / 3");
  await expect.poll(() => icloudExportAttempts).toBe(1);
  await page.reload();
  await expect(page.getByText("第二步：用手机扫码")).toBeVisible();
  const openIcloudFilesCard = page.getByTestId("onboarding-icloud-open-files-first");
  await expect(openIcloudFilesCard).toBeVisible({ timeout: 15_000 });
  let inlinePairingBaseUrl: string | undefined;
  const inlinePairingStartHandler = async (route: Route) => {
    const posted = route.request().postDataJSON() as { baseUrl?: string };
    inlinePairingBaseUrl = posted.baseUrl;
    const baseUrl = inlinePairingBaseUrl || "https://lifeos-apple-e2e.example.test";
    inlinePairingStartAttempts += 1;
    // Keep the response slower than one pickup poll so the confirmed-phone
    // state cannot regress while an inline QR is being created.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: "icloud-inline-e2e",
        token: "bind_icloud_inline_e2e",
        expiresAt: Date.now() + 120_000,
        baseUrl,
        pairingUrl: `${baseUrl}/mobile/install/bind_icloud_inline_e2e`,
        localName: "LifeOS Test",
      }),
    });
    inlinePairingStartFulfilled += 1;
  };
  await onboardingContext.route("**/api/v1/devices/bind/start", inlinePairingStartHandler);
  await onboardingContext.route("**/api/v1/devices/bind/icloud-inline-e2e", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: "icloud-inline-e2e",
        expiresAt: Date.now() + 120_000,
        device: null,
      }),
    });
  });
  icloudPhase = "phone-confirmed";
  await page.reload();
  await expect(page.getByTestId("onboarding-icloud-qr-after-pickup")).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => inlinePairingStartAttempts, { timeout: 15_000 }).toBe(1);
  await expect.poll(() => inlinePairingStartFulfilled, { timeout: 15_000 }).toBe(1);
  expect(inlinePairingBaseUrl).toBe("https://lifeos-apple-e2e.example.test");
  await expect(page.getByTestId("onboarding-icloud-inline-qr")).toBeVisible({ timeout: 15_000 });
  await onboardingContext.unroute("**/api/v1/devices/bind/start", inlinePairingStartHandler);
  await page.unroute("**/api/v1/admin/ai-providers/openai/test");
  await page.getByText("高级功能、备份和诊断").click();
  await expect(page.getByText("首次启动检查表")).toBeVisible();
  await expect(page.getByText("如果遇到问题")).toBeVisible();
  await expect(page.getByRole("heading", { name: "启动安全自检" })).toBeVisible();
  await page.getByRole("button", { name: "创建备份" }).click();
  await expect(page.getByText(/已创建初始备份：lifeos-.*\.db/)).toBeVisible();
  await expect(page.getByTestId("onboarding-progress-count")).toHaveText("1 / 3");
  await expect(page.getByText("已有备份：1 份")).toBeVisible();
  await page.getByRole("button", { name: "开启每日自动备份" }).click();
  await expect(page.getByText("已开启每日自动备份。之后 LifeOS AI 会定期创建 SQLite 快照。")).toBeVisible();
  await expect(page.getByText("自动备份：已开启，每 24 小时")).toBeVisible();
  await expect(page.getByText(/下次自动备份：/)).toBeVisible();
  await page.getByRole("link", { name: "进入控制台" }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/);
  await expect(page.getByText("LifeOS Local Core")).toBeVisible();

  await page.route("**/api/v1/admin/network-diagnostics", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        host: "127.0.0.1",
        port: "3333",
        publicBaseUrl: "",
        publicAccessAllowed: false,
        lanUrls: ["http://192.168.31.10:3333"],
        lanEnvTemplate: "LIFEOS_HOST=0.0.0.0 LIFEOS_ALLOW_PUBLIC=1 npm run start",
        recommendedBaseUrl: "https://pair.example.test",
        connectionCandidates: [
          {
            id: "cloudflare-0",
            label: "Cloudflare Tunnel",
            baseUrl: "https://pair.example.test",
            mode: "cloudflare",
            priority: 90,
            requiresRestart: true,
            secure: true,
            mobilePairUrl: "https://pair.example.test/mobile/pair",
            mobileChatUrl: "https://pair.example.test/mobile/chat",
            envTemplate: "LIFEOS_HOST=0.0.0.0 LIFEOS_ALLOW_PUBLIC=1 LIFEOS_TRUST_PROXY=1 PUBLIC_BASE_URL=https://pair.example.test npm run start",
            restartInstruction: "复制环境变量后重启 LifeOS AI。",
            notes: ["适合异地访问。复制启动环境并重启后，绑定二维码会使用这个 HTTPS 地址。"],
          },
        ],
        cloudflare: {
          installed: true,
          running: true,
          managed: {
            running: false,
            starting: false,
            url: "",
            pid: null,
            startedAt: null,
            command: "",
            lastOutput: "",
            lastError: "",
          },
          version: "cloudflared version 2026.6.0",
          detectedUrls: ["https://pair.example.test"],
          suggestedCommand: "cloudflared tunnel --url http://127.0.0.1:3333",
          installCommand: "brew install cloudflared",
          envTemplate: "LIFEOS_HOST=0.0.0.0 LIFEOS_ALLOW_PUBLIC=1 LIFEOS_TRUST_PROXY=1 PUBLIC_BASE_URL=https://pair.example.test npm run start",
          notes: ["Cloudflare Tunnel 已运行。"],
        },
        tailscale: {
          installed: false,
          online: false,
          version: "",
          deviceName: "",
          tailnetName: "",
          urls: [],
          magicDnsUrls: [],
          mobileUrls: [],
          installCommand: "brew install --cask tailscale-app",
          envTemplate: "LIFEOS_HOST=0.0.0.0 LIFEOS_ALLOW_PUBLIC=1 npm run start",
          notes: ["未检测到 Tailscale CLI。"],
        },
        safety: {
          publicModeRequired: false,
          requiresHttpsForInternet: false,
          notes: ["异地访问优先选择可信隧道。"],
        },
      }),
    });
  });
  let recommendedBindStartAttempts = 0;
  await page.route("**/api/v1/devices/bind/start", async (route) => {
    const posted = route.request().postDataJSON() as { baseUrl?: string };
    expect(posted.baseUrl).toBe("https://pair.example.test");
    if (recommendedBindStartAttempts === 0) {
      recommendedBindStartAttempts += 1;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: "sqlite busy while preparing pairing QR",
        }),
      });
      return;
    }
    recommendedBindStartAttempts += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: "bind-e2e-recommended",
        token: "bind_recommended_e2e",
        expiresAt: Date.now() + 120_000,
        baseUrl: "https://pair.example.test",
        pairingUrl: "https://pair.example.test/mobile/install/bind_recommended_e2e",
        localName: "LifeOS Test",
      }),
    });
  });
  await page.route("**/api/v1/admin/network-diagnostics/test-url", async (route) => {
    const posted = route.request().postDataJSON() as { baseUrl?: string };
    expect(posted.baseUrl).toBe("https://pair.example.test");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          ok: true,
          url: posted.baseUrl,
          status: 200,
          latencyMs: 18,
          httpsStatus: { ok: true },
          steps: [
            { id: "health", ok: true, status: 200, url: `${posted.baseUrl}/api/v1/health`, latencyMs: 6 },
            { id: "mobile-shell", ok: true, status: 200, url: `${posted.baseUrl}/mobile/chat`, latencyMs: 6 },
            { id: "websocket", ok: true, status: 101, url: `${posted.baseUrl}/api/v1/ws`, latencyMs: 6 },
          ],
        },
      }),
    });
  });
  await page.route("**/api/v1/devices/bind/bind-e2e-recommended", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: "bind-e2e-recommended",
        expiresAt: Date.now() + 120_000,
        device: null,
      }),
    });
  });
  await page.goto("/admin/devices/pair");
  await expect(page.getByText("检测到地址，但二维码还没生成")).toBeVisible();
  await expect(page.getByText(/二维码没有生成。下一步：重启 LifeOS AI/)).toBeVisible();
  await expect(page.getByText("当前检测到的地址")).toBeVisible();
  await page.getByRole("button", { name: "测试这个地址" }).click();
  await expect(page.getByText("连接测试通过：3/3 项通过，18ms，手机可访问 https://pair.example.test")).toBeVisible();
  await page.getByRole("button", { name: "用这个地址生成二维码" }).click();
  await expect(page.getByText("已根据连接诊断自动选择绑定地址")).toBeVisible();
  expect(recommendedBindStartAttempts).toBe(2);
  await expect(page.getByText("https://pair.example.test", { exact: true })).toBeVisible();
  await expect(page.getByText("推荐安全")).toBeVisible();
  await expect(page.getByText("需重启生效")).toBeVisible();
  await expect(page.getByText(/Cloudflare Tunnel · 适合异地访问/)).toBeVisible();
  await expect(page.getByText("LIFEOS_HOST=0.0.0.0 LIFEOS_ALLOW_PUBLIC=1 LIFEOS_TRUST_PROXY=1 PUBLIC_BASE_URL=https://pair.example.test npm run start")).toBeVisible();
  const currentPairingEnvButton = page.getByRole("button", { name: "复制当前绑定启动环境" });
  await expect(currentPairingEnvButton).toBeVisible();
  await currentPairingEnvButton.click();
  await expect(currentPairingEnvButton).toContainText("已复制启动环境");
  await expect(page.getByRole("button", { name: "测试当前绑定地址" })).toBeVisible();
  await page.unroute("**/api/v1/admin/network-diagnostics");
  await page.unroute("**/api/v1/admin/network-diagnostics/test-url");
  await page.unroute("**/api/v1/devices/bind/start");
  await page.unroute("**/api/v1/devices/bind/bind-e2e-recommended");

  await page.goto("/admin/settings");
  await expect(page.getByText("管理员密码", { exact: true })).toBeVisible();
  await page.getByLabel("当前密码").fill(password);
  await page.getByLabel("新密码", { exact: true }).fill("aaaaaaaaaaaa1!");
  await page.getByLabel("确认新密码").fill("aaaaaaaaaaaa1!");
  await page.getByRole("button", { name: "更新管理员密码" }).click();
  await expect(page.getByText("新密码不能包含长串重复字符。")).toBeVisible();
  await page.getByLabel("当前密码").fill(password);
  await page.getByLabel("新密码", { exact: true }).fill(rotatedPassword);
  await page.getByLabel("确认新密码").fill(rotatedPassword);
  await page.getByRole("button", { name: "更新管理员密码" }).click();
  await expect(page.getByText(/管理员密码已更新/)).toBeVisible();
  await expect(page.getByText(/建议加强|需要处理|强度通过/).first()).toBeVisible();
  await page.getByLabel("当前密码").fill(rotatedPassword);
  await page.getByLabel("新密码", { exact: true }).fill(password);
  await page.getByLabel("确认新密码").fill(password);
  await page.getByRole("button", { name: "更新管理员密码" }).click();
  await expect(page.getByText(/管理员密码已更新/)).toBeVisible();
  await page.goto("/admin/dashboard");

  const csrf = await csrfHeaders(page);
  const blockedBinding = await page.context().request.post("/api/v1/devices/bind/start");
  expect(blockedBinding.status()).toBe(403);

  await page.getByRole("button", { name: "创建备份" }).click();
  await expect(page.locator('a[href*="/api/v1/backups/"][href$="/download"]').first()).toBeVisible();

  const bindingResponse = await page.context().request.post("/api/v1/devices/bind/start", { headers: csrf });
  expect(bindingResponse.ok()).toBeTruthy();
  const binding = await bindingResponse.json();
  expect(binding.token).toMatch(/^bind_/);

  const expiredPhoneContext = await browser.newContext({
    ...devices["iPhone 14"],
    locale: "zh-CN",
  });
  await expiredPhoneContext.addInitScript(() => {
    localStorage.setItem("lifeos_locale", "zh-CN");
  });
  const expiredPhone = await expiredPhoneContext.newPage();
  await expiredPhone.route("**/api/v1/devices/bind/confirm", async (route) => {
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ error: "Binding token is invalid or expired" }),
    });
  });
  await expiredPhone.goto(`${new URL(binding.pairingUrl).origin}/mobile/install/bind_expired_e2e`);
  await expiredPhone.getByPlaceholder("例如：iPhone 15 Pro").fill("Expired Phone");
  await expiredPhone.getByRole("button", { name: "确认绑定" }).click();
  await expect(expiredPhone.getByText("这个二维码已经失效")).toBeVisible();
  await expect(expiredPhone.getByText("换一个新的绑定链接")).toBeVisible();
  await expiredPhone.getByPlaceholder("粘贴 /mobile/install/bind_... 或 bind_...").fill("not-a-pairing-link");
  await expiredPhone.getByRole("button", { name: "使用这个链接继续绑定" }).click();
  await expect(expiredPhone.getByText("绑定链接格式不对")).toBeVisible();
  await expiredPhone.getByPlaceholder("粘贴 /mobile/install/bind_... 或 bind_...").fill(binding.pairingUrl);
  await Promise.all([
    expiredPhone.waitForURL(new RegExp(`/mobile/install/${binding.token}`)),
    expiredPhone.getByRole("button", { name: "使用这个链接继续绑定" }).click(),
  ]);
  await expiredPhoneContext.close();

  const phoneContext = await browser.newContext({
    ...devices["iPhone 14"],
    locale: "zh-CN",
  });
  await phoneContext.addInitScript(() => {
    localStorage.setItem("lifeos_locale", "zh-CN");
  });
  const phone = await phoneContext.newPage();
  const phoneBaseUrl = new URL(binding.pairingUrl).origin;
  expect(new URL(binding.pairingUrl).pathname).toBe(`/mobile/install/${encodeURIComponent(binding.token)}`);
  await phone.goto(binding.pairingUrl);
  await expect(phone.getByText("确认绑定电脑")).toBeVisible();
  await expect.poll(() => phone.evaluate(() => navigator.userAgent)).toContain("iPhone");
  await expect.poll(() => phone.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(430);
  await expect.poll(() => phone.evaluate(async () => {
    const status = await fetch("/api/v1/admin/status", { credentials: "same-origin" }).then((response) => response.json());
    return Boolean(status.authenticated);
  })).toBe(false);
  await expect.poll(() => phone.evaluate(() => localStorage.getItem("lifeos_admin_session"))).toBeNull();
  await phone.getByPlaceholder("例如：iPhone 15 Pro").fill("Playwright Phone");
  await phone.getByRole("button", { name: "确认绑定" }).click();
  await expect(phone.getByText("绑定完成")).toBeVisible();
  await expect.poll(async () => phone.evaluate(() => localStorage.getItem("lifeos_device_credential"))).toBeNull();

  await page.goto("/admin/onboarding");
  await expect(page.getByTestId("onboarding-progress-count")).toHaveText("3 / 3");
  await expect(page.getByText("已准备好")).toBeVisible();

  await phone.goto(`${phoneBaseUrl}/mobile/chat`);
  await expect(phone.getByText(/已连接电脑|正在连接电脑|连接中断，正在重试/)).toBeVisible();
  await phone.route("**/api/chat", async (route) => {
    expect(route.request().method()).toBe("POST");
    const payload = route.request().postDataJSON() as { message?: string };
    expect(payload.message).toBe("第一条测试消息");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        text: "已收到第一条测试消息，聊天链路正常。",
        provider: "OpenAI",
        model: "gpt-4o",
      }),
    });
  });
  await phone.getByPlaceholder("发送指令，或召唤新应用...").fill("第一条测试消息");
  await phone.keyboard.press("Enter");
  await expect(phone.getByText("第一条测试消息")).toBeVisible();
  await expect(phone.getByText("已收到第一条测试消息，聊天链路正常。")).toBeVisible();

  await page.goto("/admin/onboarding");
  await page.getByRole("button", { name: "完成并开始聊天" }).click();
  await expect(page).toHaveURL(/\/chat/);
  await expect(page.getByText("JARVIS", { exact: true }).first()).toBeVisible();
  await expect(page.getByPlaceholder("发送指令，或召唤新应用...")).toBeVisible();
  await phone.unroute("**/api/chat");
  await expect(phone.getByText("添加到主屏幕", { exact: true })).toBeVisible();
  await phone.getByRole("button", { name: "关闭安装提示" }).click();
  await phone.reload();
  await expect(phone.getByText("添加到主屏幕", { exact: true })).toHaveCount(0);
  await phone.goto(`${phoneBaseUrl}/mobile/device`);
  await expect(phone.getByText("设备与连接")).toBeVisible();
  await expect(phone.getByText("连接恢复中心")).toBeVisible();
  await expect(phone.getByText("1. 测试当前手机")).toBeVisible();
  await expect(phone.getByRole("button", { name: "粘贴新的绑定链接" })).toBeVisible();
  await phone.getByRole("button", { name: "粘贴新的绑定链接" }).click();
  await expect(phone.getByPlaceholder("https://.../mobile/install/bind_...")).toBeFocused();
  await expect(phone.getByText("已绑定电脑端")).toBeVisible();
  await expect(phone.getByText("Playwright Phone")).toBeVisible();
  await expect(phone.getByText("WebCrypto 签名", { exact: true })).toBeVisible();
  await expect(phone.getByText("WebCrypto 签名已启用")).toBeVisible();
  await phone.getByRole("button", { name: "刷新凭证状态" }).click();
  await expect(phone.getByText("凭证状态已刷新。")).toBeVisible();
  await expect(phone.getByText("连接与离线队列")).toBeVisible();
  await writeOfflineQueue(phone, [
      {
        id: "offline-e2e-1",
        message: { role: "user", parts: [{ text: "离线失败消息" }] },
        queuedAt: Date.now(),
        fingerprint: "offline-e2e-1",
        status: "failed",
        attempts: 2,
        lastAttemptAt: Date.now(),
        lastError: "network down",
      },
      {
        id: "offline-e2e-2",
        message: { role: "user", parts: [{ text: "准备删除的离线消息" }] },
        queuedAt: Date.now(),
        fingerprint: "offline-e2e-2",
        status: "pending",
        attempts: 0,
      },
    ]);
  await phone.reload();
  await expect(phone.getByText("最近错误：network down")).toBeVisible();
  await expect(phone.getByText("离线消息明细")).toBeVisible();
  await expect(phone.getByText("离线失败消息")).toBeVisible();
  await expect(phone.getByText("失败原因：network down")).toBeVisible();
  await expect(phone.getByLabel("下次自动重试：离线失败消息")).toBeVisible();
  await expect(phone.getByText("准备删除的离线消息")).toBeVisible();
  await phone.getByRole("button", { name: "重试离线消息：离线失败消息" }).click();
  await expect(phone.getByText("这条离线消息已改为待同步。打开聊天页后会自动重试。")).toBeVisible();
  phone.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("删除这条离线消息");
    await dialog.accept();
  });
  await phone.getByRole("button", { name: "删除离线消息：准备删除的离线消息" }).click();
  await expect(phone.getByText("已删除这条离线消息。")).toBeVisible();
  await expect(phone.getByText("准备删除的离线消息")).toHaveCount(0);
  await writeOfflineQueue(phone, [
    {
      id: "offline-e2e-1",
      message: { role: "user", parts: [{ text: "离线失败消息" }] },
      queuedAt: Date.now(),
      fingerprint: "offline-e2e-1",
      status: "pending",
      attempts: 2,
    },
    {
      id: "offline-e2e-3",
      message: { role: "user", parts: [{ text: "批量重试失败消息" }] },
      queuedAt: Date.now(),
      fingerprint: "offline-e2e-3",
      status: "failed",
      attempts: 1,
      lastAttemptAt: Date.now(),
      lastError: "server unreachable",
    },
  ]);
  await phone.reload();
  await phone.getByRole("button", { name: "重试失败", exact: true }).click();
  await expect(phone.getByText("失败消息已改为待同步。打开聊天页后会自动重试。")).toBeVisible();
  phone.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("清空这台手机上的离线消息队列");
    await dialog.accept();
  });
  await phone.getByRole("button", { name: "清空队列" }).click();
  await expect(phone.getByText("已清空离线消息队列。")).toBeVisible();

  await phone.goto(`${phoneBaseUrl}/mobile/actions`);
  await expect(phone.getByText("生成程序动作审计")).toBeVisible();
  await expect(phone.getByText("程序权限策略")).toBeVisible();
  await expect(phone.getByText("还没有生成程序动作请求")).toBeVisible();
  await expect(phone.getByText("动作权限中心")).toBeVisible();
  await phone.getByPlaceholder("URL，例如：weixin:// 或 shortcuts://...").fill("weixin://open?token=super-secret-action-token&body=private-message");
  await phone.getByPlaceholder("名称，例如：打开微信").fill("Blocked App");
  await phone.getByRole("button", { name: "保存" }).click();
  await phone.getByText("URL Scheme 白名单").scrollIntoViewIfNeeded();
  await phone.getByPlaceholder("http, https, tel, sms, mailto, shortcuts").fill("http, https, shortcuts");
  await phone.getByRole("button", { name: "更新白名单" }).click();
  phone.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("已拦截未授权");
    await dialog.dismiss();
  });
  await phone.getByRole("button", { name: "打开", exact: true }).click();
  await expect(phone.getByText("已记录 1 条")).toBeVisible();
  await expect(phone.getByText("最近动作记录")).toBeVisible();
  await expect(phone.getByText("已拦截").first()).toBeVisible();
  await expect(phone.getByText(/风险：高风险/).first()).toBeVisible();
  await expect(phone.getByText(/目标：Blocked App/).first()).toBeVisible();
  await expect(phone.getByText("super-secret-action-token")).toHaveCount(0);
  await expect(phone.getByText("private-message")).toHaveCount(0);
  await expect(phone.getByText(/token=\[redacted\]/)).toBeVisible();
  phone.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("无法保存");
    await dialog.dismiss();
  });
  await phone.getByRole("button", { name: "保存" }).click();
  await phone.goto(`${phoneBaseUrl}/mobile/chat`);
  await expect(phone.locator("iframe[sandbox*='allow-same-origin']")).toHaveCount(0);

  await page.goto("/admin/dashboard");
  await expect(page.getByText("Playwright Phone")).toBeVisible();
  await page.getByRole("button", { name: "刷新凭证" }).click();
  await expect(page.getByText("Playwright Phone")).toBeVisible();

  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:3333" });
  await page.route("**/api/v1/admin/network-diagnostics", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        host: "0.0.0.0",
        port: "3333",
        publicBaseUrl: "",
        publicAccessAllowed: true,
        lanUrls: ["http://192.168.31.10:3333"],
        lanEnvTemplate: "LIFEOS_HOST=0.0.0.0 LIFEOS_ALLOW_PUBLIC=1 npm run start",
        recommendedBaseUrl: "https://amber-lifeos.trycloudflare.com",
        connectionCandidates: [
          {
            id: "cloudflare-0",
            label: "Cloudflare Tunnel",
            baseUrl: "https://amber-lifeos.trycloudflare.com",
            mode: "cloudflare",
            priority: 90,
            requiresRestart: true,
            secure: true,
            mobilePairUrl: "https://amber-lifeos.trycloudflare.com/mobile/pair",
            mobileChatUrl: "https://amber-lifeos.trycloudflare.com/mobile/chat",
            envTemplate: "LIFEOS_HOST=0.0.0.0 LIFEOS_ALLOW_PUBLIC=1 LIFEOS_TRUST_PROXY=1 PUBLIC_BASE_URL=https://amber-lifeos.trycloudflare.com npm run start",
            restartInstruction: "复制环境变量后重启 LifeOS AI。",
            notes: ["适合异地访问。复制启动环境并重启后，绑定二维码会使用这个 HTTPS 地址。"],
          },
          {
            id: "tailscale-magicdns-0",
            label: "Tailscale MagicDNS",
            baseUrl: "http://lifeos-mac.tailnet.example.ts.net:3333",
            mode: "tailscale",
            priority: 82,
            requiresRestart: true,
            secure: true,
            mobilePairUrl: "http://lifeos-mac.tailnet.example.ts.net:3333/mobile/pair",
            mobileChatUrl: "http://lifeos-mac.tailnet.example.ts.net:3333/mobile/chat",
            envTemplate: "LIFEOS_HOST=0.0.0.0 LIFEOS_ALLOW_PUBLIC=1 PUBLIC_BASE_URL=http://lifeos-mac.tailnet.example.ts.net:3333 npm run start",
            restartInstruction: "复制环境变量后重启 LifeOS AI。",
            notes: ["适合自己的手机和电脑异地连接。手机需登录同一个 Tailnet。"],
          },
          {
            id: "lan-0",
            label: "局域网 Wi-Fi",
            baseUrl: "http://192.168.31.10:3333",
            mode: "lan",
            priority: 50,
            requiresRestart: true,
            secure: false,
            mobilePairUrl: "http://192.168.31.10:3333/mobile/pair",
            mobileChatUrl: "http://192.168.31.10:3333/mobile/chat",
            envTemplate: "LIFEOS_HOST=0.0.0.0 LIFEOS_ALLOW_PUBLIC=1 npm run start",
            restartInstruction: "复制环境变量后重启 LifeOS AI。",
            notes: ["适合同一 Wi-Fi。离开当前网络后通常不可用。"],
          },
        ],
        cloudflare: {
          installed: true,
          running: true,
          managed: {
            running: false,
            starting: false,
            url: "",
            pid: null,
            startedAt: null,
            command: "",
            lastOutput: "",
            lastError: "",
          },
          version: "cloudflared version 2026.6.0",
          detectedUrls: ["https://amber-lifeos.trycloudflare.com"],
          suggestedCommand: "cloudflared tunnel --url http://127.0.0.1:3333",
          installCommand: "brew install cloudflared",
          envTemplate: "LIFEOS_HOST=0.0.0.0 LIFEOS_ALLOW_PUBLIC=1 LIFEOS_TRUST_PROXY=1 PUBLIC_BASE_URL=https://amber-lifeos.trycloudflare.com npm run start",
          notes: ["Cloudflare Tunnel 已运行。"],
        },
        tailscale: {
          installed: true,
          online: true,
          version: "1.88.0",
          deviceName: "lifeos-mac",
          tailnetName: "tailnet.example.ts.net",
          urls: ["http://100.64.0.10:3333"],
          magicDnsUrls: ["http://lifeos-mac.tailnet.example.ts.net:3333"],
          mobileUrls: ["http://lifeos-mac.tailnet.example.ts.net:3333", "http://100.64.0.10:3333"],
          installCommand: "brew install --cask tailscale-app",
          envTemplate: "LIFEOS_HOST=0.0.0.0 LIFEOS_ALLOW_PUBLIC=1 PUBLIC_BASE_URL=http://lifeos-mac.tailnet.example.ts.net:3333 npm run start",
          notes: ["Tailscale 已登录并在线。"],
        },
        safety: {
          publicModeRequired: true,
          requiresHttpsForInternet: false,
          notes: ["异地访问优先选择可信隧道。"],
        },
      }),
    });
  });
  await page.route("**/api/v1/admin/network-diagnostics/test-url", async (route) => {
    const posted = route.request().postDataJSON() as { baseUrl?: string };
    expect(posted.baseUrl).toBe("https://amber-lifeos.trycloudflare.com");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          ok: true,
          url: posted.baseUrl,
          status: 200,
          latencyMs: 24,
          steps: [
            { id: "health", ok: true, status: 200, url: `${posted.baseUrl}/api/v1/health`, latencyMs: 8 },
            { id: "mobile-shell", ok: true, status: 200, url: `${posted.baseUrl}/mobile/chat`, latencyMs: 9 },
            { id: "websocket", ok: true, status: 101, url: `${posted.baseUrl}/api/v1/ws`, latencyMs: 7 },
          ],
        },
      }),
    });
  });
  await page.evaluate(() => localStorage.setItem("lifeos_locale", "zh-CN"));
  await page.goto("/admin/settings");
  await expect(page).toHaveURL(/\/admin\/settings/);
  await expect(page.getByRole("heading", { name: "系统设置" })).toBeVisible();
  await expect(page.getByRole("link", { name: "导出诊断包" })).toBeVisible();
  await expect(page.getByText("配置诊断")).toBeVisible();
  await expect(page.getByText("GEMINI_API_KEY", { exact: true })).toBeVisible();
  await expect(page.getByText("手机连接向导")).toBeVisible();
  await expect(page.getByText("https://amber-lifeos.trycloudflare.com").first()).toBeVisible();
  await expect(page.getByText("http://100.64.0.10:3333").first()).toBeVisible();
  await expect(page.getByText("tailnet.example.ts.net", { exact: true })).toBeVisible();
  await expect(page.getByText("http://lifeos-mac.tailnet.example.ts.net:3333").first()).toBeVisible();
  await expect(page.getByText("http://192.168.31.10:3333").first()).toBeVisible();
  await expect(page.getByText("lifeos-mac", { exact: true })).toBeVisible();
  await expect(page.getByText("推荐绑定地址")).toBeVisible();
  await expect(page.getByText("Cloudflare Tunnel", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Tailscale MagicDNS", { exact: true })).toBeVisible();
  await expect(page.getByText("需重启生效").first()).toBeVisible();
  await expect(page.getByText("推荐启动环境", { exact: true })).toBeVisible();
  await expect(page.getByText("LIFEOS_HOST=0.0.0.0 LIFEOS_ALLOW_PUBLIC=1 LIFEOS_TRUST_PROXY=1 PUBLIC_BASE_URL=https://amber-lifeos.trycloudflare.com npm run start").first()).toBeVisible();
  await expect(page.getByText("手机端入口").locator("..").getByText("https://amber-lifeos.trycloudflare.com/mobile/chat")).toBeVisible();
  await expect(page.getByText("实际地址形如 /mobile/install/<token>")).toBeVisible();
  const recommendedEnvButton = page.getByRole("button", { name: "复制推荐启动环境" });
  await recommendedEnvButton.click();
  await expect(recommendedEnvButton).toContainText("已复制推荐启动环境");
  await page.getByRole("button", { name: "复制 Cloudflare Tunnel 启动环境" }).click();
  await expect(page.getByRole("button", { name: "复制 Cloudflare Tunnel 启动环境" })).toContainText("已复制启动环境");
  await page.getByRole("button", { name: "测试推荐地址" }).first().click();
  await expect(page.getByText("连接成功：3/3 项通过，24ms，https://amber-lifeos.trycloudflare.com")).toBeVisible();
  await expect(page.getByText("最近审计日志")).toBeVisible();
  await expect(page.getByText("备份与恢复", { exact: true })).toBeVisible();
  await expect(page.getByText("AI Key 安全配置")).toBeVisible();
  const aiKeyPanel = page.locator("section", { hasText: "AI Key 安全配置" });
  await page.route("**/api/v1/admin/ai-providers/openai/test", async (route) => {
    expect(route.request().method()).toBe("POST");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        result: "live_ready",
        mode: "live",
        modelCount: 2,
        discoveredModelCount: 2,
        modelCatalogUpdated: true,
        selectedModel: "gpt-4o",
        provider: {
          id: "openai",
          provider: "OpenAI",
          envVar: "OPENAI_API_KEY",
          configured: true,
          source: "encrypted_store",
          storage: "local_aes_gcm",
          active: true,
          selectedModel: "gpt-4o",
          defaultModel: "gpt-4o-mini",
          models: ["gpt-4o-mini", "gpt-4o"],
        },
        message: "OpenAI model catalog check succeeded.",
      }),
    });
  });
  await expect(aiKeyPanel.getByRole("button", { name: /Gemini/ })).toBeVisible();
  await expect(aiKeyPanel.getByRole("button", { name: /^OpenAI\b/ })).toBeVisible();
  await expect(aiKeyPanel.getByRole("button", { name: /OpenRouter/ })).toBeVisible();
  await expect(aiKeyPanel.getByRole("button", { name: /本地模型|Local Model/ })).toBeVisible();
  await aiKeyPanel.getByRole("button", { name: /^OpenAI\b/ }).click();
  await aiKeyPanel.getByLabel("OpenAI 模型").fill("gpt-4o");
  await aiKeyPanel.getByRole("button", { name: "保存模型" }).click();
  await expect(aiKeyPanel.getByText("OpenAI 模型已保存：gpt-4o")).toBeVisible();
  await aiKeyPanel.getByPlaceholder("输入 API Key").fill("sk-playwright-openai-secret-value");
  await aiKeyPanel.getByRole("button", { name: "保存", exact: true }).click();
  await expect(aiKeyPanel.getByText("OpenAI 配置已安全保存。")).toBeVisible();
  await aiKeyPanel.getByRole("button", { name: "测试" }).click();
  await expect(aiKeyPanel.getByText(/OpenAI 配置检查通过|OpenAI configuration check passed/)).toBeVisible();
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("OpenAI");
    await dialog.accept();
  });
  await aiKeyPanel.getByRole("button", { name: "删除" }).click();
  await expect(aiKeyPanel.getByText("OpenAI 配置已删除。")).toBeVisible();
  await page.unroute("**/api/v1/admin/ai-providers/openai/test");
  await aiKeyPanel.getByRole("button", { name: /Gemini/ }).click();
  await aiKeyPanel.getByPlaceholder("输入 API Key").fill("AIzaSy-playwright-secret-value-should-not-leak");
  await aiKeyPanel.getByRole("button", { name: "保存", exact: true }).click();
  await expect(aiKeyPanel.getByText("Google Gemini 配置已安全保存。")).toBeVisible();
  await expect(aiKeyPanel.getByText("本地加密存储").or(aiKeyPanel.getByText("系统安全存储")).first()).toBeVisible();
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("删除");
    await dialog.accept();
  });
  await aiKeyPanel.getByRole("button", { name: "删除" }).click();
  await expect(aiKeyPanel.getByText("Google Gemini 配置已删除。")).toBeVisible();

  await expect(page.getByRole("link", { name: "下载最新" })).toBeVisible();
  const backupPanel = page.locator("section", { hasText: "备份与恢复" });
  await expect(backupPanel.getByRole("link", { name: "导出数据" })).toBeVisible();
  await expect(backupPanel.getByText("数据导出范围")).toBeVisible();
  await backupPanel.getByRole("checkbox", { name: "审计" }).uncheck();
  await expect(backupPanel.getByRole("link", { name: "导出数据" })).toHaveAttribute("href", /scope=chat%2Cmemories%2Cdevices/);
  await backupPanel.getByRole("button", { name: "全选" }).click();
  await expect(backupPanel.getByRole("link", { name: "导出数据" })).toHaveAttribute("href", "/api/v1/data/export");
  await expect(backupPanel.locator("#backup-schedule").getByText("自动备份计划", { exact: true })).toBeVisible();
  await backupPanel.getByLabel("开启自动备份").check();
  await backupPanel.getByLabel("间隔").fill("12");
  await backupPanel.getByRole("button", { name: "保存计划" }).click();
  await expect(backupPanel.getByText("自动备份已开启：每 12 小时执行一次。")).toBeVisible();
  await backupPanel.getByRole("button", { name: "创建备份" }).click();
  await expect(backupPanel.getByText(/已创建备份：lifeos-.*\.db/)).toBeVisible();
  await expect(backupPanel.getByText("加密备份导出")).toBeVisible();
  await expect(backupPanel.getByText("加密备份导入")).toBeVisible();
  await backupPanel.getByPlaceholder("加密口令，至少 12 个字符").fill("Playwright encrypted backup 2026!");
  await backupPanel.getByPlaceholder("再次输入加密口令").fill("Playwright encrypted backup 2026!");
  const exportLatestButton = backupPanel.getByRole("button", { name: "导出最新" });
  await expect(exportLatestButton).toBeEnabled();
  const encryptedDownloadPromise = page.waitForEvent("download");
  await exportLatestButton.click();
  const encryptedDownload = await encryptedDownloadPromise;
  expect(encryptedDownload.suggestedFilename()).toMatch(/\.lifeos-backup\.json$/);
  await expect(backupPanel.getByText(/已生成加密备份/)).toBeVisible();
  const encryptedBackupPath = await encryptedDownload.path();
  expect(encryptedBackupPath).toBeTruthy();
  await backupPanel.getByPlaceholder("导入口令").fill("Playwright encrypted backup 2026!");
  await backupPanel.locator('input[type="file"]').setInputFiles(encryptedBackupPath!);
  await expect(backupPanel.getByText(/已导入加密备份/)).toBeVisible();
  await backupPanel.getByRole("button", { name: "预览" }).first().click();
  await expect(backupPanel.getByText(/^备份预览：lifeos-.*\.db$/)).toBeVisible();
  await expect(backupPanel.getByText(/大小：\d+\.\d KB · 创建时间：/)).toBeVisible();
  await expect(backupPanel.getByText(/\d+ 个 migration/)).toBeVisible();
  await expect(backupPanel.getByText("messages")).toBeVisible();
  await expect(backupPanel.getByText("恢复风险说明")).toBeVisible();
  await expect(backupPanel.getByText("清理策略")).toBeVisible();
  await expect(backupPanel.getByText("备份至少保留 1 份；审计和聊天天数设置为 0 表示不清理。执行前会再次确认。")).toBeVisible();
  await backupPanel.getByRole("spinbutton", { name: /保留备份/ }).fill("3");
  await backupPanel.getByRole("spinbutton", { name: /审计早于/ }).fill("0");
  await backupPanel.getByRole("spinbutton", { name: /聊天早于/ }).fill("30");
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toMatch(/保留最新 3 份备份|latest 3 backup/);
    expect(dialog.message()).toMatch(/不清理审计日志|do not clean audit logs/);
    expect(dialog.message()).toMatch(/30 天前聊天会话|older than 30 day/);
    await dialog.accept();
  });
  await backupPanel.getByRole("button", { name: "按策略清理" }).click();
  await expect(backupPanel.getByText(/清理完成|Cleanup complete/)).toBeVisible();
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toMatch(/安排恢复备份|Schedule restore for backup/);
    await dialog.accept();
  });
  const restoreButton = backupPanel.getByRole("button", { name: "恢复" }).first();
  await expect(restoreButton).toBeEnabled();
  await restoreButton.click();
  await expect(backupPanel.getByText(/恢复任务等待重启|Restore Waiting for Restart/)).toBeVisible();
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toMatch(/取消等待重启|Cancel the restore task waiting for restart/);
    await dialog.accept();
  });
  await backupPanel.getByRole("button", { name: "取消恢复任务" }).click();
  await expect(backupPanel.getByText(/已取消等待重启的恢复任务|Pending restore task cancelled/)).toBeVisible();
  await page.goto("/admin/dashboard");

  await page.getByRole("button", { name: /撤销/ }).click();
  await expect(page.getByText("Playwright Phone")).toHaveCount(0);
  await phoneContext.close();
});
