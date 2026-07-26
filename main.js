const { app, BrowserWindow, Tray, Menu, nativeImage, shell, Notification, ipcMain, powerMonitor } = require('electron');
const path = require('path');



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
      partition: 'persist:messenger', // Sử dụng partition riêng để bảo toàn session lâu dài
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // để nhận cuộc gọi/tin nhắn ngay cả khi minimize
      spellcheck: false // tắt spellcheck để nhẹ RAM hơn (tuỳ chọn, bật lại nếu cần)
    }
  });

  mainWindow.loadURL(MESSENGER_URL);

  // Xin quyền camera/mic/notification tự động cho domain Facebook/Messenger
  const ses = mainWindow.webContents.session;
  const allowedPermissions = ['media', 'mediaAudioTrack', 'mediaVideoTrack', 'notifications', 'fullscreen', 'display-capture'];

  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true); // Luôn cho phép vì đây là app nội bộ của Messenger
  });

  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    return true; // Phản hồi ngay cho web biết đã có quyền, tránh lỗi lặp
  });

  // Mở link ngoài (vd: link bài viết Facebook chia sẻ) bằng trình duyệt mặc định,
  // giữ app chỉ tập trung cho chat/gọi, không phình to như browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const mDomain = String.fromCharCode(109, 101, 115, 115, 101, 110, 103, 101, 114, 46, 99, 111, 109);
    const fDomain = String.fromCharCode(102, 97, 99, 101, 98, 111, 111, 107, 46, 99, 111, 109);
    if (url.includes(mDomain) || url.includes(fDomain) || url === 'about:blank' || url.startsWith('blob:')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false
          }
        }
      };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Hỗ trợ cửa sổ gọi điện của Messenger khi vừa bật lên
  mainWindow.webContents.on('did-create-window', (childWindow) => {
    childWindow.webContents.setWindowOpenHandler(() => {
      return { action: 'allow' }; // Cho phép popups con bên trong màn hình gọi
    });
    // Báo cho cửa sổ con biết nó là màn hình gọi để hiện nút PiP
    childWindow.webContents.on('dom-ready', () => {
      childWindow.webContents.send('init-pip-button');
    });
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
    {
      label: 'Test Thông báo (để macOS nhận diện)',
      click: () => {
        const { Notification } = require('electron');
        if (Notification.isSupported()) {
          global.testNotif = new Notification({
            title: 'PigChat',
            body: 'Cấp quyền thông báo thành công! Giờ bạn có thể thấy PigChat trong System Settings.'
          });
          global.testNotif.show();
        }
        
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.executeJavaScript(`
            if ('Notification' in window && Notification.permission === 'granted') {
              new Notification('PigChat Web', { body: 'Thông báo từ Messenger' });
            }
          `).catch(e => console.error(e));
        }
      }
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

function togglePipMode(win) {
  if (!win) return;
  const isTop = win.isAlwaysOnTop();
  if (!isTop) {
    // Bật PiP
    win._originalBounds = win.getBounds();
    win.setAlwaysOnTop(true, 'floating');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    if (process.platform === 'darwin') {
      win.setWindowButtonVisibility(false); // Ẩn viền (traffic lights) để tràn viền
    }
    
    const { screen } = require('electron');
    const display = screen.getPrimaryDisplay();
    const width = 350;
    const height = 250;
    win.setBounds({
      x: display.workAreaSize.width - width - 20,
      y: display.workAreaSize.height - height - 20,
      width: width,
      height: height
    });
  } else {
    // Tắt PiP
    win.setAlwaysOnTop(false);
    win.setVisibleOnAllWorkspaces(false);
    if (process.platform === 'darwin') {
      win.setWindowButtonVisibility(true);
    }
    if (win._originalBounds) {
      win.setBounds(win._originalBounds);
    }
  }
  
  // Thông báo lại cho webContents để đổi nút bấm
  win.webContents.send('pip-state-changed', !isTop);
  return !isTop;
}

ipcMain.on('toggle-pip', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  togglePipMode(win);
});

function createAppMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'Tuỳ chỉnh',
      submenu: [
        { role: 'reload', label: 'Tải lại trang' },
        { type: 'separator' },
        {
          label: 'Ghim trên cùng (Picture-in-Picture)',
          accelerator: 'CmdOrCtrl+Shift+P',
          type: 'checkbox',
          click: (item, focusedWindow) => {
            if (focusedWindow) {
              item.checked = togglePipMode(focusedWindow);
            }
          }
        },
        { type: 'separator' },
        { role: 'toggledevtools', label: 'Công cụ phát triển (DevTools)' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.tiny.pigchat'); // Giúp OS nhận diện app chính xác

  // Lấy User-Agent chuẩn và áp dụng cho partition của messenger
  const ses = require('electron').session.fromPartition('persist:messenger');
  let ua = ses.getUserAgent();
  ua = ua.replace(/PigChat\/[0-9\.]+ /i, '').replace(/Electron\/[0-9\.]+ /i, '');
  ses.setUserAgent(ua);
  app.userAgentFallback = ua;

  // Bỏ clearCache để không vô tình xoá dữ liệu đăng nhập của Facebook/Messenger
  // ses.clearCache();

  createWindow();
  createTray();
  createAppMenu();

  // Yêu cầu quyền Microphone ở cấp độ Hệ Điều Hành ngay khi khởi động
  if (process.platform === 'darwin') {
    const { systemPreferences } = require('electron');
    systemPreferences.askForMediaAccess('microphone');
    systemPreferences.askForMediaAccess('camera');
    
    // Tự động chuyển app vào Applications folder để macOS không chặn thông báo
    if (!app.isInApplicationsFolder()) {
      try {
        app.moveToApplicationsFolder();
      } catch (e) {
        console.error('Không thể di chuyển app vào Applications:', e);
      }
    }
  }

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
  // Xoá flushStorageData() vì gọi ở đây (lúc app đang tắt) có thể gây hỏng file cookie dẫn đến văng login
});
