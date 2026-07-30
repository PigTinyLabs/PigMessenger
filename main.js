const { app, BrowserWindow, Tray, Menu, nativeImage, shell, Notification, ipcMain, powerMonitor, desktopCapturer, dialog, net } = require('electron');
const path = require('path');



const getTargetUrl = () => String.fromCharCode(104, 116, 116, 112, 115, 58, 47, 47, 119, 119, 119, 46, 109, 101, 115, 115, 101, 110, 103, 101, 114, 46, 99, 111, 109, 47);
const MESSENGER_URL = getTargetUrl();

let mainWindow;
let tray;
let isQuitting = false;

const GITHUB_OWNER = 'PigTinyLabs';
const GITHUB_REPO = 'PigMessenger';
const CURRENT_VERSION = app.getVersion();

function compareVersions(v1, v2) {
  const a = v1.replace(/^v/, '').split('.').map(Number);
  const b = v2.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) > (b[i] || 0)) return 1;
    if ((a[i] || 0) < (b[i] || 0)) return -1;
  }
  return 0;
}

function setupAutoUpdater() {
  const checkForUpdates = async () => {
    try {
      const res = await net.fetch(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
        { headers: { 'User-Agent': 'PigChat-Updater' } }
      );
      if (!res.ok) return;

      const release = await res.json();
      const latestVersion = release.tag_name; // v1.0.17
      if (!latestVersion) return;

      console.log(`[Updater] Hiện tại: v${CURRENT_VERSION} | Mới nhất: ${latestVersion}`);

      if (compareVersions(latestVersion, CURRENT_VERSION) > 0) {
        // Có phiên bản mới!
        console.log('[Updater] Phát hiện bản mới:', latestVersion);

        // Hiện native OS notification
        if (Notification.isSupported()) {
          const notif = new Notification({
            title: 'PigChat có bản cập nhật mới!',
            body: `Phiên bản ${latestVersion} đã sẵn sàng. Nhấp vào để xem chi tiết.`,
            silent: false
          });
          notif.on('click', () => {
            shell.openExternal(`https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`);
          });
          notif.show();
        }

        // Hiện dialog hỏi người dùng có muốn tải bản mới không
        const win = mainWindow;
        if (win) {
          const { response } = await dialog.showMessageBox(win, {
            type: 'info',
            title: 'Cập nhật mới — PigChat',
            message: `PigChat ${latestVersion} đã sẵn sàng!`,
            detail: `Bạn đang dùng v${CURRENT_VERSION}. Bấm "Tải xuống" để mở trang tải bản mới.`,
            buttons: ['Tải xuống', 'Để sau'],
            defaultId: 0,
            cancelId: 1
          });
          if (response === 0) {
            shell.openExternal(`https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`);
          }
        }
      }
    } catch (err) {
      console.log('[Updater] Kiểm tra thất bại:', err?.message);
    }
  };

  // Kiểm tra lần đầu sau 10 giây (tránh block lúc khởi động)
  setTimeout(checkForUpdates, 10000);
  // Kiểm tra lại mỗi 2 tiếng
  setInterval(checkForUpdates, 2 * 60 * 60 * 1000);
}

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

// Buộc tất cả cửa sổ cùng domain (messenger.com) dùng chung 1 renderer process
// → TCC permission được warmup ở main window, call popup kế thừa luôn, không bị hỏi lại
app.commandLine.appendSwitch('process-per-site');

// Guard toàn cục cho quyền mic/camera của cửa sổ gọi (call popup):
// Messenger có thể tạo nhiều cửa sổ con (did-create-window fire nhiều lần) chỉ trong
// 1 lần bấm "gọi video", nên các cờ này PHẢI ở scope module (không phải trong
// createWindow()/did-create-window) để không bị hỏi/warmup lặp lại nhiều lần.
let tccAskInFlight = false;
let callWindowMediaWarmedUp = false;

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

  // Warmup chỉ chạy 1 lần duy nhất khi app khởi động, dùng flag để tránh chạy lại mỗi navigation
  let mediaWarmedUp = false;
  mainWindow.webContents.on('dom-ready', () => {
    if (mediaWarmedUp) return;
    mediaWarmedUp = true;
    // Chỉ warmup audio — KHÔNG dùng video:true vì macOS sẽ phát tiếng chụp hình
    mainWindow.webContents.executeJavaScript(`
      (function warmupMediaPermission() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
        navigator.mediaDevices.getUserMedia({ audio: true, video: false })
          .then(function(stream) { stream.getTracks().forEach(function(t) { t.stop(); }); })
          .catch(function() {});
      })()
    `).catch(() => {});
  });

  // Xin quyền camera/mic/notification tự động cho domain Facebook/Messenger
  const ses = mainWindow.webContents.session;
  const allowedPermissions = ['media', 'mediaAudioTrack', 'mediaVideoTrack', 'notifications', 'fullscreen', 'display-capture'];

  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    if (allowedPermissions.includes(permission)) {
      callback(true);
    } else {
      console.log('Từ chối quyền:', permission);
      callback(false);
    }
  });

  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (allowedPermissions.includes(permission)) {
      return true;
    }
    return false;
  });

  ses.setDevicePermissionHandler((details) => {
    return true; // Cho phép truy cập danh sách thiết bị (camera/micro)
  });

  ses.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      // Tự động cấp quyền chia sẻ màn hình đầu tiên tìm thấy
      const screen = sources.find(s => s.id.startsWith('screen')) || sources[0];
      if (screen) {
        callback({ video: screen, audio: 'loopback' });
      } else {
        callback(); // Hủy nếu không có
      }
    }).catch(err => {
      console.error('Lỗi khi lấy danh sách màn hình chia sẻ:', err);
      callback();
    });
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
            partition: 'persist:messenger',
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            // Tắt sandbox để cửa sổ gọi điện kế thừa TCC permission từ main process
            // (sandbox mặc định khiến macOS coi mỗi renderer là process riêng, bị hỏi lại quyền mic)
            sandbox: false
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
      return { action: 'allow' };
    });

    // Permission handlers cho session của cửa sổ con
    const childSes = childWindow.webContents.session;
    childSes.setPermissionRequestHandler((wc, permission, callback) => {
      callback(true);
    });
    childSes.setPermissionCheckHandler((wc, permission) => {
      return true;
    });
    childSes.setDevicePermissionHandler(() => true);

    // Proactively yêu cầu TCC permission từ main process ngay khi cửa sổ gọi mở
    // để macOS cache permission trước khi Messenger chạy getUserMedia.
    //
    // CHÚ Ý: Messenger mở NHIỀU cửa sổ con (blank/blob) liên tiếp trong lúc dàn xếp
    // cuộc gọi (ICE negotiation, popup nút, reconnect...) nên did-create-window có thể
    // fire 9-10 lần chỉ trong 1 lần bấm "gọi video". Vì tất cả cửa sổ con dùng chung
    // partition 'persist:messenger' (chung session với main window), quyền TCC chỉ cần
    // hỏi ĐÚNG 1 LẦN cho cả phiên chạy app — gọi lại askForMediaAccess() nhiều lần gần
    // như đồng thời là nguyên nhân khiến popup xin quyền mic bị xếp chồng/nhảy liên tục.
    if (process.platform === 'darwin' && !tccAskInFlight) {
      const { systemPreferences } = require('electron');
      const micStatus = systemPreferences.getMediaAccessStatus('microphone');
      const camStatus = systemPreferences.getMediaAccessStatus('camera');
      if (micStatus === 'not-determined' || camStatus === 'not-determined') {
        tccAskInFlight = true;
        Promise.all([
          micStatus === 'not-determined' ? systemPreferences.askForMediaAccess('microphone') : Promise.resolve(micStatus === 'granted'),
          camStatus === 'not-determined' ? systemPreferences.askForMediaAccess('camera') : Promise.resolve(camStatus === 'granted')
        ]).then(([micGranted, camGranted]) => {
          console.log('[TCC] microphone:', micGranted, '| camera:', camGranted);
        }).catch(() => {}).finally(() => { tccAskInFlight = false; });
      }
    }

    // Warmup chỉ 1 lần cho CẢ PHIÊN APP (không phải 1 lần mỗi cửa sổ con), chỉ audio —
    // tránh tiếng chụp hình và tránh gọi getUserMedia lặp lại khi Messenger mở nhiều
    // cửa sổ con trong lúc gọi.
    childWindow.webContents.once('dom-ready', () => {
      if (!callWindowMediaWarmedUp) {
        callWindowMediaWarmedUp = true;
        childWindow.webContents.executeJavaScript(`
          (function warmupMedia() {
            if (!navigator.mediaDevices) return;
            navigator.mediaDevices.getUserMedia({ audio: true, video: false })
              .then(function(stream) { stream.getTracks().forEach(function(t) { t.stop(); }); })
              .catch(function() {});
          })()
        `).catch(() => {});
      }

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

// Nhận thông báo tin nhắn từ preload (hook Notification API của Messenger)
// và hiện Native OS banner với icon PigChat, click vào sẽ mở/focus app
ipcMain.on('show-notification', (event, { title, body }) => {
  if (!Notification.isSupported()) return;

  const notif = new Notification({
    title: title || 'PigChat',
    body: body || '',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    silent: false
  });

  notif.on('click', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });

  notif.show();
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
  setupAutoUpdater(); // Bắt đầu theo dõi và tự động tải bản cập nhật mới

  // Yêu cầu quyền Microphone/Camera ở cấp macOS TCC trước khi tạo cửa sổ
  // CHÚ Ý: KHÔNG gọi moveToApplicationsFolder() - nó restart app khiến TCC permission bị reset!
  if (process.platform === 'darwin') {
    const { systemPreferences } = require('electron');
    // Chỉ hỏi nếu chưa được cấp, tránh gây popup thừa
    if (systemPreferences.getMediaAccessStatus('microphone') !== 'granted') {
      systemPreferences.askForMediaAccess('microphone');
    }
    if (systemPreferences.getMediaAccessStatus('camera') !== 'granted') {
      systemPreferences.askForMediaAccess('camera');
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
