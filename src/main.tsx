import {StrictMode, Suspense, lazy} from 'react';
import {createRoot} from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
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
      <BrowserRouter basename={lifeosBasePath || undefined}>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<Navigate to={window.innerWidth < 700 ? "/mobile/chat" : "/admin/login"} replace />} />
            <Route path="/chat" element={<App />} />
            <Route path="/mobile/actions" element={<MobileActionsPage />} />
            <Route path="/mobile/chat" element={<MobileChatPage />} />
            <Route path="/mobile/device" element={<MobileDevicePage />} />
            <Route path="/mobile/install/:token" element={<MobilePairPage />} />
            <Route path="/mobile/pair" element={<MobilePairPage />} />
            <Route path="/mobile/tools" element={<MobileToolsPage />} />
            <Route path="/admin/login" element={<AdminLoginPage />} />
            <Route path="/admin/onboarding" element={<AdminOnboardingPage />} />
            <Route path="/admin/chat" element={<AdminChatPage />} />
            <Route path="/admin/dashboard" element={<AdminDashboardPage />} />
            <Route path="/admin/memory" element={<AdminMemoryPage />} />
            <Route path="/admin/settings" element={<AdminSettingsPage />} />
            <Route path="/admin/devices/pair" element={<DevicePairPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
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
