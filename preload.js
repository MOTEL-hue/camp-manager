'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadDb: () => ipcRenderer.invoke('db:load'),
  saveDb: (data) => ipcRenderer.invoke('db:save', data),
  info: () => ipcRenderer.invoke('app:info'),
  openDataDir: () => ipcRenderer.invoke('app:openDataDir'),
  openFile: (opts) => ipcRenderer.invoke('file:open', opts),
  saveFile: (opts) => ipcRenderer.invoke('file:save', opts),
  printToPdf: (opts) => ipcRenderer.invoke('print:pdf', opts),
  print: () => ipcRenderer.invoke('print:print'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  updateStatus: () => ipcRenderer.invoke('update:status'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  secretsStatus: () => ipcRenderer.invoke('secrets:status'),
  setSecrets: (v) => ipcRenderer.invoke('secrets:set', v),
  sendMail: (msg) => ipcRenderer.invoke('mail:send', msg),
  yemot: (command, params) => ipcRenderer.invoke('yemot:call', command, params),
  pdfBuffer: () => ipcRenderer.invoke('print:pdfBuffer'),
  cloud: (method, path, body) => ipcRenderer.invoke('cloud:request', method, path, body),
  cloudLogin: (opts) => ipcRenderer.invoke('cloud:login', opts),
  cloudGoogle: (opts) => ipcRenderer.invoke('cloud:google', opts),
  cloudLogout: () => ipcRenderer.invoke('cloud:logout'),
  onUpdate: (cb) => ipcRenderer.on('update:status', (_e, s) => cb(s)),
});
