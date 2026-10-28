import {StrictMode, Suspense, lazy} from 'react';
import {createRoot} from 'react-dom/client';
import { clearSensitiveLocalStorageResidue } from './services/sensitiveLocalStorage';
import { I18nProvider, useI18n } from './i18n/I18nProvider';
import { getLifeOSBasePath } from './services/lifeosApi';
import './index.css';

clearSensitiveLocalStorageResidue();

const lifeosBasePath = getLifeOSBasePath();

const App = lazy(() => import('./App.tsx'));
const AdminChatPage = lazy(() => import('./pages/admin/AdminChatPage.tsx'));
const AdminDashboardPage = lazy(() => import('./pages/admin/AdminDashboardPage.tsx'));
const AdminLoginPage = lazy(() => import('./pages/admin/AdminLoginPage.tsx'));
const AdminMemoryPage = lazy(() => import('./pages/admin/AdminMemoryPage.tsx'));
const AdminOnboardingPage = lazy(() => import('./pages/admin/AdminOnboardingPage.tsx'));
const AdminSettingsPage = lazy(() => import('./pages/admin/AdminSettingsPage.tsx'));
const DevicePairPage = lazy(() => import('./pages/admin/DevicePairPage.tsx'));
const MobileActionsPage = lazy(() => import('./pages/mobile/MobileActionsPage.tsx'));
const MobileChatPage = lazy(() => import('./pages/mobile/MobileChatPage.tsx'));
const MobileDevicePage = lazy(() => import('./pages/mobile/MobileDevicePage.tsx'));
const MobilePairPage = lazy(() => import('./pages/mobile/MobilePairPage.tsx'));
const MobileToolsPage = lazy(() => import('./pages/mobile/MobileToolsPage.tsx'));

function currentLifeOSPath() {
  const basePath = lifeosBasePath.endsWith("/")
    ? lifeosBasePath.slice(0, -1)
    : lifeosBasePath;
  const pathname = window.location.pathname;
  const routePath = basePath && pathname.startsWith(`${basePath}/`)
    ? pathname.slice(basePath.length)
    : pathname === basePath
      ? "/"
      : pathname;
  return routePath || "/";
}

function replaceLifeOSPath(routePath: string) {
  const basePath = lifeosBasePath.endsWith("/")
    ? lifeosBasePath.slice(0, -1)
    : lifeosBasePath;
  window.history.replaceState(
    null,
    "",
    `${basePath}${routePath}${window.location.search}${window.location.hash}`,
  );
}

function LifeOSRouter() {
  let routePath = currentLifeOSPath();
  if (routePath === "/") {
    routePath = window.innerWidth < 700 ? "/mobile/chat" : "/admin/login";
    replaceLifeOSPath(routePath);
  }

  switch (routePath) {
    case "/chat":
      return <App />;
    case "/mobile/actions":
      return <MobileActionsPage />;
    case "/mobile/chat":
      return <MobileChatPage />;
    case "/mobile/device":
      return <MobileDevicePage />;
    case "/mobile/pair":
      return <MobilePairPage />;
    case "/mobile/tools":
      return <MobileToolsPage />;
    case "/admin/login":
      return <AdminLoginPage />;
    case "/admin/onboarding":
      return <AdminOnboardingPage />;
    case "/admin/chat":
      return <AdminChatPage />;
    case "/admin/dashboard":
      return <AdminDashboardPage />;
    case "/admin/memory":
      return <AdminMemoryPage />;
    case "/admin/settings":
      return <AdminSettingsPage />;
    case "/admin/devices/pair":
      return <DevicePairPage />;
    default:
      if (/^\/mobile\/install\/[^/]+$/.test(routePath)) {
        return <MobilePairPage />;
      }
      routePath = window.innerWidth < 700 ? "/mobile/chat" : "/admin/login";
      replaceLifeOSPath(routePath);
      return routePath === "/mobile/chat" ? <MobileChatPage /> : <AdminLoginPage />;
  }
}

function RouteFallback() {
  const { t } = useI18n();
  return (
    <div className="min-h-screen bg-[#060a10] text-zinc-100 flex items-center justify-center">
      <div className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-5 py-4 text-sm font-bold text-zinc-300">
        <div className="w-2 h-2 rounded-full bg-cyan-300 animate-pulse" />
        {t("common.loadingLifeos")}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <Suspense fallback={<RouteFallback />}>
        <LifeOSRouter />
      </Suspense>
    </I18nProvider>
  </StrictMode>,
);

if ("serviceWorker" in navigator && (import.meta as any).env?.PROD) {
  let reloadedForServiceWorkerUpdate = false;
  const notifyServiceWorkerUpdate = () => {
    window.dispatchEvent(new CustomEvent("lifeos-service-worker-update"));
  };
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    notifyServiceWorkerUpdate();
    if (reloadedForServiceWorkerUpdate) return;
    reloadedForServiceWorkerUpdate = true;
    window.location.reload();
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${lifeosBasePath}/sw.js`, { scope: `${lifeosBasePath || "/"}` })
      .then((registration) => {
        registration.waiting?.postMessage({ type: "LIFEOS_SKIP_WAITING" });
        if (registration.waiting) notifyServiceWorkerUpdate();
        registration.addEventListener("updatefound", () => {
          notifyServiceWorkerUpdate();
          registration.installing?.addEventListener("statechange", () => {
            notifyServiceWorkerUpdate();
            if (registration.waiting) {
              registration.waiting.postMessage({ type: "LIFEOS_SKIP_WAITING" });
            }
          });
        });
        return registration.update();
      })
      .catch((error) => {
        console.warn("OwnOrbit service worker registration failed", error);
      });
  });
}
