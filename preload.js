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

window.addEventListener('DOMContentLoaded', () => {
  watchUnreadCount();
});

contextBridge.exposeInMainWorld('messengerLite', {
  version: '1.0.0'
});
