import { app, BrowserWindow, ipcMain, screen, shell } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SingleInstanceGuard } from '../app/singleInstance.js';
import { loadConfig } from '../config/config.js';
import { OrbDataSource } from './dataSource.js';

const here = dirname(fileURLToPath(import.meta.url));
const rendererHtml = join(here, 'preload', 'orb.html');

/** Size of the collapsed orb, in logical pixels. */
const ORB_SIZE = 56;
/** Size of the expanded panel, in logical pixels. */
const PANEL_SIZE = { width: 380, height: 520 };
/** Corner gap from the screen edge, in logical pixels. */
const EDGE_MARGIN = 24;

interface OrbPosition {
  x: number;
  y: number;
}

let mainWindow: BrowserWindow | undefined;
let dataSource: OrbDataSource | undefined;
let guard: SingleInstanceGuard | undefined;
let expanded = false;

/**
 * Restores the orb's last position.
 *
 * Saved coordinates are clamped to the current display bounds so an orb dragged
 * onto a monitor that has since been unplugged is still reachable.
 */
function loadPosition(): OrbPosition | undefined {
  try {
    const path = join(app.getPath('userData'), 'orb-position.json');
    if (!existsSync(path)) return undefined;
    const saved = JSON.parse(readFileSync(path, 'utf8')) as OrbPosition;
    if (typeof saved?.x !== 'number' || typeof saved?.y !== 'number') return undefined;
    const display = screen.getDisplayMatching({ x: saved.x, y: saved.y, width: 1, height: 1 }).workArea;
    return {
      x: Math.min(Math.max(display.x, saved.x), display.x + display.width - ORB_SIZE),
      y: Math.min(Math.max(display.y, saved.y), display.y + display.height - ORB_SIZE),
    };
  } catch {
    // A corrupt or unreadable position file must not stop the orb appearing.
    return undefined;
  }
}

function savePosition(): void {
  if (!mainWindow) return;
  try {
    const position = mainWindow.getPosition() ?? [0, 0];
    writeFileSync(
      join(app.getPath('userData'), 'orb-position.json'),
      JSON.stringify({ x: position[0] ?? 0, y: position[1] ?? 0 }),
      { mode: 0o600 },
    );
  } catch {
    // Losing the position is harmless; never fail the app over it.
  }
}

function defaultPosition(): OrbPosition {
  const display = screen.getPrimaryDisplay().workArea;
  return {
    x: display.x + display.width - ORB_SIZE - EDGE_MARGIN,
    y: display.y + display.height - ORB_SIZE - EDGE_MARGIN,
  };
}

/** Creates the frameless, transparent, always-on-top orb window. */
function createWindow(): void {
  const start = loadPosition() ?? defaultPosition();

  mainWindow = new BrowserWindow({
    ...start,
    width: ORB_SIZE,
    height: ORB_SIZE,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    hasShadow: false,
    acceptFirstMouse: true,
    webPreferences: {
      preload: join(here, 'preload', 'preload.cjs'),
      // The renderer shows read-only data and cannot reach Node or the database.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  void mainWindow.loadFile(rendererHtml);
  mainWindow.on('moved', savePosition);
  mainWindow.on('closed', () => { mainWindow = undefined; });
}

/** Toggles between the collapsed orb and the expanded panel. */
function setExpanded(next: boolean): void {
  if (!mainWindow) return;
  expanded = next;
  const position = mainWindow.getPosition() ?? [0, 0];
  const x = position[0] ?? 0;
  const y = position[1] ?? 0;
  if (next) {
    // Grow around the orb's centre so it does not appear to jump.
    mainWindow.setBounds({
      x: Math.round(x - (PANEL_SIZE.width - ORB_SIZE) / 2),
      y: Math.round(y - (PANEL_SIZE.height - ORB_SIZE) / 2),
      ...PANEL_SIZE,
    });
  } else {
    mainWindow.setBounds({ x, y, width: ORB_SIZE, height: ORB_SIZE });
  }
  mainWindow.webContents.send('taskflow:expanded', next);
}

/** Brings the orb to the front, expanding it if it was collapsed. */
function reveal(): void {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (!expanded) setExpanded(true);
}

function closeApplication(): void {
  guard?.release();
  dataSource?.close();
}

void app.whenReady().then(() => {
  const config = loadConfig();
  // The orb reads the same SQLite file through Node's built-in driver, so it
  // never loads the native addon that Node and Electron cannot share.
  dataSource = new OrbDataSource(config.databasePath);

  // Only one orb may run at a time; a second `taskflow` reveals this one.
  guard = new SingleInstanceGuard(join(app.getPath('home'), '.taskflow'), reveal);
  if (guard.acquire()) {
    app.quit();
    return;
  }

  createWindow();

  // Renderer requests are narrow and read-only: the UI cannot mutate data or run
  // commands, so every write still goes through the terminal's confirmation flow.
  ipcMain.handle('taskflow:state', () => {
    const snapshot = dataSource?.read();
    return {
      todayCount: snapshot?.dueToday ?? 0,
      overdueCount: snapshot?.overdue ?? 0,
      openTotal: snapshot?.openTotal ?? 0,
      nextTitle: snapshot?.nextTitle ?? null,
      nextReason: snapshot?.nextReason ?? null,
      // The orb does not load the AI layer, so it reports no backend rather than
      // guessing one.
      aiConnected: false,
      aiModel: '',
      expanded,
    };
  });

  ipcMain.handle('taskflow:collapse', () => {
    setExpanded(false);
    return true;
  });

  ipcMain.on('taskflow:quit', () => {
    closeApplication();
    app.quit();
  });

  // External links open in the user's browser, never inside the app shell.
  mainWindow?.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  app.on('activate', () => {
    if (!mainWindow) createWindow();
  });
});

app.on('window-all-closed', () => {
  closeApplication();
  app.quit();
});

app.on('before-quit', closeApplication);