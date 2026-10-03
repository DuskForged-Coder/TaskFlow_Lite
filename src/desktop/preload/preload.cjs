// Preload bridge. The renderer runs sandboxed with context isolation, so this is
// the only surface it can reach: three explicit, read-only calls. No Node, no
// filesystem, no database, and no way to mutate task data from the orb.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('taskflow', {
  /** Read-only snapshot of counts and the current recommendation. */
  state: () => ipcRenderer.invoke('taskflow:state'),
  /** Collapse the panel back to the orb. */
  collapse: () => ipcRenderer.invoke('taskflow:collapse'),
  /** Fully quit TaskFlow. */
  quit: () => ipcRenderer.send('taskflow:quit'),
  /** Notifies the renderer when the orb expands or collapses. */
  onExpanded: (callback) => {
    const listener = (_event, value) => callback(Boolean(value));
    ipcRenderer.on('taskflow:expanded', listener);
    return () => ipcRenderer.removeListener('taskflow:expanded', listener);
  },
});
