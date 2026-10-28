function resolveDesktopLoginItemPolicy({
  platform = process.platform,
  isPackaged = false,
  environment = process.env,
} = {}) {
  const supported = platform === "darwin" && Boolean(isPackaged);
  const enabled = supported && environment.LIFEOS_DESKTOP_OPEN_AT_LOGIN !== "0";
  return {
    supported,
    enabled,
    openAtLogin: enabled,
    openAsHidden: enabled,
  };
}

function shouldShowDesktopWindowOnStartup({
  wasOpenedAtLogin = false,
  adminConfigured = false,
  environment = process.env,
} = {}) {
  if (environment.LIFEOS_DESKTOP_SHOW_ON_LOGIN === "1") return true;
  if (!wasOpenedAtLogin) return true;
  return !adminConfigured;
}

module.exports = {
  resolveDesktopLoginItemPolicy,
  shouldShowDesktopWindowOnStartup,
};
