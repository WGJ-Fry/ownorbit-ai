const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lifeosDesktopFailure", {
  openLogsFolder: () => ipcRenderer.invoke("lifeos:open-logs-folder"),
  exportDiagnostics: () => ipcRenderer.invoke("lifeos:export-desktop-diagnostics"),
  retryStartup: () => ipcRenderer.invoke("lifeos:retry-startup"),
  copyLogsPath: () => ipcRenderer.invoke("lifeos:copy-logs-path"),
  openLocalConsole: () => ipcRenderer.invoke("lifeos:open-local-console"),
  copyLocalAddress: () => ipcRenderer.invoke("lifeos:copy-local-address"),
});
