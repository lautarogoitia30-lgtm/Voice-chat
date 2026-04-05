# VoiceSpace Desktop App

Desktop application for VoiceSpace - A Discord-like voice chat application.

## Features

- Voice chat powered by LiveKit
- Real-time text chat via WebSocket
- System tray support for running in background
- Native window controls (minimize, maximize, close)
- Dark theme with pastel pink accents

## Requirements

- Node.js 18+
- npm or yarn

## Installation

```bash
# Install dependencies
cd electron
npm install

# Run in development
npm run dev

# Build for production
npm run build
```

## Build Commands

```bash
# Build for Windows
npm run build:win

# Build for Mac
npm run build:mac

# Build for Linux
npm run build:linux
```

## Configuration

The app connects to the backend at:
```
https://voice-chat-production-a794.up.railway.app
```

To change the backend URL, edit `src/main.js` and modify the `BACKEND_URL` constant.

## Project Structure

```
electron/
├── package.json
├── src/
│   ├── main.js        # Electron main process
│   ├── preload.js     # Preload script for IPC
│   └── assets/
│       ├── icon.svg   # App icon
│       └── icon.png   # Tray icon (fallback)
└── dist/              # Built executables
```

## Notes

- The app uses Electron 28+
- It loads the web app from the deployed backend
- System tray allows the app to run in the background
- Window state is preserved between sessions
