const { contextBridge, ipcRenderer } = require("electron");

const desktopBridge = {
  openLogsFolder: () => ipcRenderer.invoke("lifeos:open-logs-folder"),
  openIcloudFolder: () => ipcRenderer.invoke("lifeos:open-icloud-folder"),
  openIcloudSettings: () => ipcRenderer.invoke("lifeos:open-icloud-settings"),
  exportDiagnostics: () => ipcRenderer.invoke("lifeos:export-desktop-diagnostics"),
  retryStartup: () => ipcRenderer.invoke("lifeos:retry-startup"),
  copyLogsPath: () => ipcRenderer.invoke("lifeos:copy-logs-path"),
  openLocalConsole: () => ipcRenderer.invoke("lifeos:open-local-console"),
  copyLocalAddress: () => ipcRenderer.invoke("lifeos:copy-local-address"),
};

contextBridge.exposeInMainWorld("lifeosDesktop", desktopBridge);
contextBridge.exposeInMainWorld("lifeosDesktopFailure", desktopBridge);
