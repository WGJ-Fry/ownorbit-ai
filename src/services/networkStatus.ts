export type NetworkStatus = {
  online: boolean;
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
  quality: "offline" | "poor" | "ok" | "unknown";
  labelKey: "network.offline" | "network.weak" | "network.available" | "network.unknown";
  label: string;
};

type NavigatorLike = {
  onLine?: boolean;
  connection?: {
    effectiveType?: string;
    downlink?: number;
    rtt?: number;
    saveData?: boolean;
  };
};

export function getNetworkStatus(nav: NavigatorLike = typeof navigator === "undefined" ? {} : navigator as NavigatorLike): NetworkStatus {
  const online = nav.onLine !== false;
  const connection = nav.connection;
  const effectiveType = connection?.effectiveType;
  const downlink = connection?.downlink;
  const rtt = connection?.rtt;
  const saveData = connection?.saveData;

  if (!online) {
    return { online, effectiveType, downlink, rtt, saveData, quality: "offline", labelKey: "network.offline", label: "You are offline. Your draft stays here; send it again after reconnecting." };
  }

  const slowEffectiveType = effectiveType === "slow-2g" || effectiveType === "2g";
  const slowDownlink = Number.isFinite(downlink) && Number(downlink) > 0 && Number(downlink) < 0.6;
  const slowRtt = Number.isFinite(rtt) && Number(rtt) > 900;
  if (saveData || slowEffectiveType || slowDownlink || slowRtt) {
    return { online, effectiveType, downlink, rtt, saveData, quality: "poor", labelKey: "network.weak", label: "The network is weak, so sending may fail. If it does, your draft stays in the input box so you can send it again later." };
  }

  if (effectiveType || Number.isFinite(downlink) || Number.isFinite(rtt)) {
    return { online, effectiveType, downlink, rtt, saveData, quality: "ok", labelKey: "network.available", label: "Network is available." };
  }

  return { online, effectiveType, downlink, rtt, saveData, quality: "unknown", labelKey: "network.unknown", label: "Network status is unknown." };
}
