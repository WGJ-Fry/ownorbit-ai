export const MOBILE_INSTALL_HINT_DISMISSED_KEY = "lifeos_mobile_install_hint_dismissed";

export function loadMobileInstallHintDismissed(storage: Pick<Storage, "getItem"> = localStorage) {
  try {
    return storage.getItem(MOBILE_INSTALL_HINT_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveMobileInstallHintDismissed(storage: Pick<Storage, "setItem"> = localStorage) {
  try {
    storage.setItem(MOBILE_INSTALL_HINT_DISMISSED_KEY, "1");
    return true;
  } catch {
    return false;
  }
}
