const { app, BrowserWindow, Tray, Menu, nativeImage, shell, Notification, ipcMain, powerMonitor } = require('electron');
const path = require('path');

// ---------- TỐI ƯU RAM / CPU ----------
// Tắt các tính năng Chromium không cần thiết cho 1 trang web đơn (Messenger)
app.commandLine.appendSwitch('disable-http-cache', 'false');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,TranslateUI,MediaRouter');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256'); // giới hạn heap V8 ~256MB
app.disableHardwareAcceleration_flag = false; // giữ lại GPU vì cần cho video call mượt

const MESSENGER_URL = 'https://www.messenger.com/';

let mainWindow;
let tray;
let isQuitting = false;

// Chỉ cho phép 1 instance chạy cùng lúc (đỡ tốn RAM khi mở nhầm nhiều lần)
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 480,
    minHeight: 400,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#0b0b12',
    autoHideMenuBar: true, // ẩn menu bar mặc định (File/Edit/...) cho gọn
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // để nhận cuộc gọi/tin nhắn ngay cả khi minimize
      partition: 'persist:messenger', // lưu session đăng nhập lâu dài
      spellcheck: false // tắt spellcheck để nhẹ RAM hơn (tuỳ chọn, bật lại nếu cần)
    }
  });

  mainWindow.loadURL(MESSENGER_URL);

  // Xin quyền camera/mic/notification tự động cho domain Facebook/Messenger
  const ses = mainWindow.webContents.session;
  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ['media', 'notifications', 'fullscreen', 'display-capture'];
    callback(allowed.includes(permission));
  });

  // Mở link ngoài (vd: link bài viết Facebook chia sẻ) bằng trình duyệt mặc định,
  // giữ app chỉ tập trung cho chat/gọi, không phình to như browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.includes('messenger.com') || url.includes('facebook.com')) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Đóng cửa sổ = thu vào khay hệ thống (tray), không tắt hẳn app,
  // để vẫn nhận tin nhắn/thông báo/cuộc gọi nền
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('minimize', () => {
    // trên Windows/Linux có thể chọn ẩn luôn xuống tray khi minimize
    // (bỏ comment dòng dưới nếu muốn hành vi này)
    // mainWindow.hide();
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Mở Messenger',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      }
    },
    {
      label: 'Tải lại trang',
      click: () => mainWindow.webContents.reload()
    },
    { type: 'separator' },
    {
      label: 'Thoát hẳn',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
  tray.setToolTip('Messenger Lite');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
}

// Nhận badge số tin nhắn chưa đọc từ trang web (qua preload -> ipc) để hiện lên icon dock/taskbar
ipcMain.on('unread-count', (event, count) => {
  if (process.platform === 'darwin') {
    app.dock.setBadge(count > 0 ? String(count) : '');
  } else if (mainWindow) {
    if (count > 0) {
      // Windows: overlay icon nhỏ trên taskbar
      const overlay = nativeImage.createFromPath(path.join(__dirname, 'assets', 'badge.png'));
      mainWindow.setOverlayIcon(overlay, `${count} tin nhắn chưa đọc`);
    } else {
      mainWindow.setOverlayIcon(null, '');
    }
  }
});

app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow.show();
  });
});

app.on('window-all-closed', () => {
  // Không quit trên bất kỳ platform nào — app sống trong tray để nhận thông báo nền
  if (process.platform !== 'darwin') {
    // no-op, giữ app chạy nền qua tray
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});
