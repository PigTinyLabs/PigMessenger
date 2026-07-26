const { app, BrowserWindow, Tray, Menu, nativeImage, shell, Notification, ipcMain, powerMonitor } = require('electron');
const path = require('path');

// Giả mạo trình duyệt chuẩn để Facebook không chặn/khoá chức năng (tránh lỗi skeleton screen và mất login)
app.userAgentFallback = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const getTargetUrl = () => String.fromCharCode(104, 116, 116, 112, 115, 58, 47, 47, 119, 119, 119, 46, 109, 101, 115, 115, 101, 110, 103, 101, 114, 46, 99, 111, 109, 47);
const MESSENGER_URL = getTargetUrl();

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
    const mDomain = String.fromCharCode(109, 101, 115, 115, 101, 110, 103, 101, 114, 46, 99, 111, 109);
    const fDomain = String.fromCharCode(102, 97, 99, 101, 98, 111, 111, 107, 46, 99, 111, 109);
    if (url.includes(mDomain) || url.includes(fDomain)) {
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
      label: 'Mở PigChat',
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
  tray.setToolTip('PigChat');
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
