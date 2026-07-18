import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('datacon', {
  version: '0.1.0',
})
