const { contextBridge, ipcRenderer } = require('electron');

// Theo dõi tiêu đề trang (Messenger đổi title kiểu "(3) Messenger" khi có tin chưa đọc)
// để lấy số tin nhắn chưa đọc và báo về main process hiện badge icon.
function watchUnreadCount() {
  const parseCount = (title) => {
    const match = title.match(/^\((\d+)\)/);
    return match ? parseInt(match[1], 10) : 0;
  };

  let lastCount = -1;
  const check = () => {
    const count = parseCount(document.title);
    if (count !== lastCount) {
      lastCount = count;
      ipcRenderer.send('unread-count', count);
    }
  };

  // Quan sát thay đổi của thẻ <title>
  const titleEl = document.querySelector('title');
  if (titleEl) {
    const observer = new MutationObserver(check);
    observer.observe(titleEl, { childList: true });
  }
  // Kiểm tra định kỳ dự phòng (mỗi 5s) vì SPA đôi khi đổi title không qua DOM mutation chuẩn
  setInterval(check, 5000);
  check();
}

function injectPipButton() {
  const btn = document.createElement('div');
  btn.id = 'pigchat-pip-btn';
  btn.style.position = 'fixed';
  btn.style.bottom = '24px';
  btn.style.left = '24px';
  btn.style.width = '36px';
  btn.style.height = '36px';
  btn.style.backgroundColor = 'rgba(0, 0, 0, 0.6)';
  btn.style.backdropFilter = 'blur(4px)';
  btn.style.color = 'white';
  btn.style.borderRadius = '10px';
  btn.style.display = 'flex';
  btn.style.alignItems = 'center';
  btn.style.justifyContent = 'center';
  btn.style.cursor = 'pointer';
  btn.style.zIndex = '999999';
  btn.style.transition = 'all 0.2s ease';
  btn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
  
  btn.addEventListener('mouseenter', () => btn.style.backgroundColor = 'rgba(0, 0, 0, 0.9)');
  btn.addEventListener('mouseleave', () => btn.style.backgroundColor = 'rgba(0, 0, 0, 0.6)');

  const iconEnter = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h7"/><rect x="14" y="14" width="8" height="6" rx="1"/></svg>`;
  const iconExit = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

  btn.innerHTML = iconEnter;

  btn.addEventListener('click', () => {
    ipcRenderer.send('toggle-pip');
  });

  ipcRenderer.on('pip-state-changed', (event, isPip) => {
    btn.innerHTML = isPip ? iconExit : iconEnter;
    if (isPip) {
      // Khi thu nhỏ, có thể dời nút lên góc phải trên cho dễ tắt
      btn.style.bottom = 'auto';
      btn.style.left = 'auto';
      btn.style.top = '12px';
      btn.style.right = '12px';
    } else {
      // Khi bự ra, trả về góc dưới trái
      btn.style.top = 'auto';
      btn.style.right = 'auto';
      btn.style.bottom = '24px';
      btn.style.left = '24px';
    }
  });

  document.body.appendChild(btn);
}

window.addEventListener('DOMContentLoaded', () => {
  watchUnreadCount();
  injectPipButton();
  
  // Yêu cầu quyền thông báo ngay khi tải trang để Facebook biết đã được cấp quyền (qua setPermissionRequestHandler)
  if ('Notification' in window && Notification.permission !== 'granted') {
    Notification.requestPermission();
  }
});

contextBridge.exposeInMainWorld('messengerLite', {
  version: '1.0.0'
});
