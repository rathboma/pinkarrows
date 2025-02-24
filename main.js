const { app, BrowserWindow, Tray, Menu, ipcMain, clipboard, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

let tray = null;
const watchedDir = '/home/rathboma/Pictures/Screenshots';


// Read image content from the clipboard and create a file window.
function getImageFromClipboard() {
  const image = clipboard.readImage();
  if (image.isEmpty()) {
    console.error("Clipboard does not contain an image.");
    return;
  }
  // Convert the image to a Data URL (e.g. "data:image/png;base64,...")
  const dataURL = image.toDataURL();
  const matches = dataURL.match(/^data:(.+);base64,(.+)$/);
  if (!matches) {
    console.error("Invalid image data URL.");
    return;
  }
  const mimeType = matches[1];
  const base64Data = matches[2];
  const fileData = {
    filePath: 'app:clipboard',
    mimeType,
    content: base64Data
  };
  return fileData
}

function triggerFromClipboard() {
  createFileWindow('app:clipboard')
}

async function triggerFromDialog() {
  try {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg'] }
      ]
    })
    if (!result.canceled && result.filePaths.length > 0) {
      const filePath = result.filePaths[0];
      createFileWindow(filePath)
    } else {
      console.error("No file")
    }

  } catch(ex) {
    console.error("ERROR WITH DIALOG", ex)
  }
}


// Create a new window that loads index.html with a query parameter for the file path.
function createFileWindow(filePath) {
  let win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      // Use a preload script to expose IPC safely in the renderer.
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Load index.html with a query parameter containing the file path.
  win.loadURL(`file://${__dirname}/index.html?file=${encodeURIComponent(filePath)}`);

  win.on('closed', () => {
    win = null;
  });
}

// Create a system tray icon with a context menu.
function createTray() {
  tray = new Tray(path.join(__dirname, 'tray-icon.png')); // Ensure this file exists.
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Choose file', click: () => { triggerFromDialog() }},
    { label: 'Paste from clipboard', click: () => { triggerFromClipboard() }},
    { label: 'Quit', click: () => { app.quit(); } },
  ]);
  tray.setToolTip('File Watcher App');
  tray.setContextMenu(contextMenu);
}

app.whenReady().then(() => {
  // Create the tray icon.
  createTray();

  // Ensure the directory to watch exists.
  if (!fs.existsSync(watchedDir)) {
    fs.mkdirSync(watchedDir);
  }

  // Watch the directory for new files.
  fs.watch(watchedDir, (eventType, filename) => {
    if (eventType === 'rename' && filename) {
      const filePath = path.join(watchedDir, filename);
      // 'rename' is triggered on both file addition and removal.
      // Check if the file now exists (i.e. it was added).
      if (fs.existsSync(filePath)) {
        console.log(`New file detected: ${filePath}`);
        // Open a new window with the file path as a query argument.
        createFileWindow(filePath);
      }
    }
  });

  // Listen for IPC requests for file content.
  ipcMain.handle('get-file-content', async (event, filePath) => {
    try {
      console.log("fetching ", filePath)
      // read from clipboard
      if (filePath === 'app:clipboard') {
        const payload = getImageFromClipboard()
        if (payload) {
          console.log("responding with clipboard data", payload.filePath, payload.mimeType)
          return { success: true, ...payload }
        } else {
          console.error("No image in clipboard")
        }
      } else { // read a file
        const content = await fs.promises.readFile(filePath, { encoding: 'base64' });
        const ext = path.extname(filePath).slice(1); // remove the dot
        const mimeType = getMimeType(ext);
        const payload = {
          filePath,
          mimeType,
          content
        }
        console.log("responding with", filePath, mimeType)
        return { success: true, ...payload };

      }
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error);
      return { success: false, error: error.message };
    }
  });
});

app.on('window-all-closed', () => {
  // On non-macOS platforms, quit when all windows are closed.
  // if (process.platform !== 'darwin') {
  //   app.quit();
  // }
});


function getMimeType(ext) {
  ext = ext.toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}