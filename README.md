# Messenger Lite

App Electron nhẹ, chỉ chạy Messenger — dùng để nhắn tin, gọi voice/video, nhận thông báo mà không cần mở cả Chrome/Firefox.

## Vì sao nhẹ hơn dùng browser thường?

- Chỉ load đúng 1 trang (messenger.com), không tab thừa, không extension.
- Giới hạn heap V8 ở ~256MB (`--max-old-space-size=256`).
- Tắt các tính năng Chromium không cần (spellcheck, media router, translate UI...).
- Single-instance lock: mở nhầm 2 lần không tốn thêm RAM.
- Đóng cửa sổ = thu vào tray (không tắt hẳn process) để vẫn nhận tin nhắn/cuộc gọi nền, nhưng bạn vẫn có thể "Thoát hẳn" từ tray khi không cần chạy nền nữa.

Lưu ý thật: vì vẫn là Chromium (qua Electron) nên **không thể nhẹ hơn Chrome về bản chất engine**, chỉ nhẹ hơn về mặt "không ôm thêm việc khác" như Chrome đa tab/đa extension.

## Cài đặt & chạy thử (development)

Cần cài Node.js trước (khuyến nghị bản LTS).

```bash
cd messenger-app
npm install
npm start
```

## Build ra app cài đặt (installer)

### Windows (.exe)
```bash
npm run build:win
```
File cài đặt sẽ nằm trong thư mục `dist/`. Icon `.ico` đã có sẵn trong `assets/`.

### macOS (.dmg)
```bash
npm run build:mac
```
⚠️ macOS yêu cầu icon định dạng `.icns`, không dùng `.png` trực tiếp được. Trên máy Mac, tạo file này bằng:

```bash
mkdir icon.iconset
sips -z 16 16     assets/icon.png --out icon.iconset/icon_16x16.png
sips -z 32 32     assets/icon.png --out icon.iconset/icon_16x16@2x.png
sips -z 32 32     assets/icon.png --out icon.iconset/icon_32x32.png
sips -z 64 64     assets/icon.png --out icon.iconset/icon_32x32@2x.png
sips -z 128 128   assets/icon.png --out icon.iconset/icon_128x128.png
sips -z 256 256   assets/icon.png --out icon.iconset/icon_128x128@2x.png
sips -z 256 256   assets/icon.png --out icon.iconset/icon_256x256.png
sips -z 512 512   assets/icon.png --out icon.iconset/icon_256x256@2x.png
sips -z 512 512   assets/icon.png --out icon.iconset/icon_512x512.png
cp assets/icon.png icon.iconset/icon_512x512@2x.png
iconutil -c icns icon.iconset -o assets/icon.icns
```

### Linux (.AppImage, .deb)
```bash
npm run build:linux
```

## Tự động Build bằng GitHub Actions (CI/CD)

Dự án đã được cấu hình tự động build thông qua GitHub Actions (`.github/workflows/build.yml`):

1. **Tự động build khi Push/PR**: Khi push code lên nhánh `main` (hoặc `master`) hoặc tạo Pull Request, GitHub Actions sẽ tự động khởi chạy 3 máy chủ (macOS, Windows, Ubuntu) để build ra các file:
   - **macOS**: `.dmg`
   - **Windows**: `.exe`
   - **Linux**: `.AppImage`, `.deb`
   - File build thành phẩm có thể tải về trực tiếp từ tab **Actions** -> Chọn workflow build -> **Artifacts**.

2. **Tự động tạo Release khi đánh Tag phiên bản**:
   Khi push a git tag (ví dụ: `v1.0.0`):
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
   GitHub Actions sẽ tự động build và đính kèm tất cả file cài đặt (`.dmg`, `.exe`, `.AppImage`, `.deb`) vào trang **Releases** trên GitHub để người dùng tải về.


## Tính năng

- Đăng nhập Facebook/Messenger, phiên đăng nhập được lưu lại (không cần login lại mỗi lần mở).
- Gọi voice/video: đã tự động cấp quyền camera/mic cho messenger.com/facebook.com.
- Thông báo desktop native khi có tin nhắn mới.
- Icon số tin nhắn chưa đọc hiện trên taskbar (Windows) / dock (macOS).
- Thu nhỏ xuống khay hệ thống (system tray) khi bấm nút đóng — bấm chuột phải vào icon tray để mở lại hoặc thoát hẳn.
- Link ngoài (bài viết được share...) tự mở bằng trình duyệt mặc định, không phình app.

## Tuỳ chỉnh

- Muốn dùng Facebook thường thay vì Messenger riêng: đổi `MESSENGER_URL` trong `main.js` thành `'https://www.facebook.com/'`.
- Muốn ẩn app xuống tray ngay khi bấm minimize (không chỉ khi đóng): bỏ comment dòng `mainWindow.hide()` trong sự kiện `minimize` ở `main.js`.
