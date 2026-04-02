const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const log = require('electron-log');

// Configure logging
log.transports.file.level = 'info';
log.transports.file.maxSize = 5 * 1024 * 1024; // 5MB

// Global exception handlers
process.on('uncaughtException', (error) => {
  log.error('Uncaught Exception:', error);
  dialog.showErrorBox('Error', `Uncaught Exception: ${error.message}`);
  app.exit(1);
});

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled Rejection:', reason);
});

let mainWindow = null;
let tray = null;

// Backend URL - change for production
const BACKEND_URL = 'https://voice-chat-production-a794.up.railway.app';

// VoiceSpace theme colors
const THEME = {
  primary: '#1a1a2e',      // Dark background
  secondary: '#2d2d4a',    // Secondary background
  accent: '#F472B6',        // Pastel pink accent
  accentHover: '#e85da8',  // Hover state
  text: '#ffffff',          // White text
  textSecondary: '#a0a0b0', // Muted text
};

function createWindow() {
  log.info('Creating main window...');

  // Create custom frameless window with title bar
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: THEME.primary,
    frame: true, // Use native frame for stability
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
    show: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    // Title bar configuration
    titleBarStyle: 'default',
    title: 'VoiceSpace',
  });

  // Load the app - use local frontend files
  const frontendPath = path.join(__dirname, '../../frontend/index.html');
  console.log('Loading frontend from:', frontendPath);
  mainWindow.loadFile(frontendPath);

  // Show when ready
  mainWindow.once('ready-to-show', () => {
    log.info('Window ready to show');
    mainWindow.show();
  });

  // Handle window close - minimize to tray instead
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      log.info('Window hidden to tray');
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Log renderer errors
  mainWindow.webContents.on('crashed', () => {
    log.error('Renderer process crashed');
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    log.error('Failed to load:', errorCode, errorDescription);
  });

  // Window state events
  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window-maximize-change', true);
  });

  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window-maximize-change', false);
  });

  log.info('Main window created successfully');
}

function createTray() {
  log.info('Creating system tray...');

  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  
  try {
    let trayIcon = nativeImage.createEmpty();
    
    try {
      trayIcon = nativeImage.createFromPath(iconPath);
      if (trayIcon.isEmpty()) {
        throw new Error('Icon is empty');
      }
    } catch (e) {
      // Create a simple colored icon as fallback (16x16 pink square)
      trayIcon = nativeImage.createFromBuffer(
        Buffer.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
          0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x10,
          0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0xf3, 0xff, 0x61, 0x00, 0x00, 0x00,
          0x01, 0x73, 0x52, 0x47, 0x42, 0x00, 0xae, 0xce, 0x1c, 0xe9, 0x00, 0x00,
          0x00, 0x33, 0x49, 0x44, 0x41, 0x54, 0x38, 0x8d, 0x63, 0x64, 0x60, 0x60,
          0xf8, 0xcf, 0xc0, 0xc0, 0xc0, 0xc0, 0x00, 0x00, 0x0c, 0x18, 0x04, 0x30,
          0x00, 0x01, 0x4c, 0x06, 0x06, 0x06, 0x86, 0xff, 0x0c, 0x0c, 0x0c, 0x18,
          0x18, 0x18, 0x00, 0x00, 0x1a, 0x40, 0x03, 0x51, 0x5c, 0xfc, 0x3e, 0x00,
          0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
        ])
      );
    }
    
    tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));
    
    const contextMenu = Menu.buildFromTemplate([
      {
        label: '🎤 Abrir VoiceSpace',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      },
      {
        label: '🔄 Actualizar',
        click: () => {
          if (mainWindow) {
            mainWindow.reload();
          }
        }
      },
      { type: 'separator' },
      {
        label: '❌ Salir',
        click: () => {
          app.isQuitting = true;
          app.quit();
        }
      }
    ]);
    
    tray.setToolTip('VoiceSpace - Voice Chat');
    tray.setContextMenu(contextMenu);
    
    // Double click to show window
    tray.on('double-click', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
    
    log.info('System tray created');
  } catch (error) {
    log.error('Failed to create tray:', error);
  }
}

// IPC handlers for window controls
ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('window-is-maximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

// App ready
app.whenReady().then(() => {
  log.info('App ready, creating window...');
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  log.info('App quitting...');
});

log.info('VoiceSpace Electron app starting...');
