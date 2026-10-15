# Danh sách file / thư mục có thể xóa

Ngày rà soát: 12/10/2026. Kết quả dựa trên **working tree hiện tại** (kể cả các thay đổi chưa commit).
**Chưa xóa gì cả.** File này chỉ để bạn quyết định.

## Cách kiểm tra

- **Code trong `src/`:** dựng sơ đồ import bắt đầu từ `src/main.ts`, `src/polyfills.ts`, `src/test.ts` và `src/fg-label-app/main.ts`. Sơ đồ theo cả `import`, `loadChildren`, `templateUrl` và `styleUrls`. File nào không nằm trong sơ đồ được coi là "không ai dùng". Sau đó grep lại tên class và tên file để chắc chắn.
- **Asset:** grep tên file trong toàn bộ `.ts/.html/.scss/.css/.json` của `src`, `angular.json`, `functions/src` và `scripts`. Có kiểm tra thêm kiểu ghép đường dẫn động (`'assets/img/' + ...`, `${...}`) và không thấy chỗ nào.
- **File ở thư mục gốc:** grep tên file trong `src`, `scripts`, `functions/src`, `angular.json`, `package.json`, `firebase.json`, `.github`.

Mức độ an toàn:
- ✅ **Chắc chắn**: không có tham chiếu nào, xóa không ảnh hưởng build hay deploy.
- ⚠️ **Nên kiểm tra thêm**: không thấy tham chiếu trong code, nhưng có thể bạn vẫn dùng thủ công, hoặc phải sửa kèm một file cấu hình khác.

---

## 1. Thư mục lớn: tiết kiệm nhiều dung lượng nhất

| Đường dẫn | Dung lượng | Lý do | Bằng chứng | An toàn |
|---|---|---|---|---|
| `.netlify/` | **221 MB** (25.420 file đang bị commit vào git) | Không còn deploy Netlify nữa (từ 08/10/2026, chỉ deploy Firebase) | Đã có trong `.gitignore` nhưng vẫn bị track. Không script nào trong `package.json` dùng tới | ✅ |
| `netlify.toml` | 1 KB | Cấu hình Netlify, không còn dùng | Như trên | ✅ |
| `dist-truck-schedule/` | 31 MB | Bản build của site truck-schedule, site này đã xóa ngày 30/09/2026 | `firebase.json` không còn target nào trỏ tới | ✅ |
| `dist-fg-label/` | 31 MB | Bản build FG Label, đã ngừng deploy từ 07/10/2026 | Vẫn có trong `firebase.json` (target `fg-label`). Chỉ xóa nếu không deploy FG Label nữa. Có thể build lại bằng `npm run build:fg-label` | ⚠️ |
| `out-tsc/` | 10 MB | Output biên dịch tạm của TypeScript | Có trong `.gitignore`, không gì dùng tới | ✅ |
| ~~`.angular/`~~ **ĐÃ XÓA 13/10/2026** | **🔥 151 GB** | Cache build của Angular CLI, tích tụ qua hàng trăm lần build mà không bao giờ tự dọn. **Đây là mục chiếm dung lượng ổ cứng nhiều nhất** | Có trong `.gitignore`. Tự tạo lại khi build. Build lần đầu sau khi xóa sẽ chậm hơn một chút | ✅ |
| `react/` | 0 | Thư mục rỗng | Không có file nào | ✅ |
| `warehouse-ai/` | nhỏ | Cloud Function `chatAI` (Gemini) cũ, đã bỏ dở | Không có trong `firebase.json`. Frontend không gọi `chatAI`. Commit cuối 08/04/2026 | ✅ |
| `genezio.yaml` | 1 KB | Cấu hình deploy Genezio, không dùng | Không script hay tài liệu nào nhắc tới | ✅ |

## 2. Code của site đã bỏ: truck-schedule-app

| Đường dẫn | Lý do | Bằng chứng | An toàn |
|---|---|---|---|
| `src/truck-schedule-app/` (7 file) | Site riêng truck-schedule đã xóa ngày 30/09/2026 | Không có trong `firebase.json`, không có script build trong `package.json`. **Không** đụng tới `src/app/pages/truck-schedule/` (app chính vẫn dùng) | ⚠️ Phải xóa kèm khối `"truck-schedule-app"` trong `angular.json` |

`src/fg-label-app/` thì **để lại** nếu còn muốn build FG Label. Script `build:fg-label` và target trong `firebase.json` vẫn đang tham chiếu tới nó.

## 3. Code Angular không ai import (`src/app`)

| Đường dẫn | Dung lượng | Lý do / bằng chứng | An toàn |
|---|---|---|---|
| `src/app/pages/layout-warehouse/` (trừ `layout-warehouse-location.util.ts`) | ~163 KB | Module, component và rack-3d không được route hay import ở đâu. Riêng file `layout-warehouse-location.util.ts` **phải giữ**, vì `inventory-overview`, `materials` và `stock-check` đang import nó | ⚠️ (nhớ giữ file util) |
| `src/app/pages/layout-warehouse-asm3/` | ~111 KB | Không được route hay import ở đâu | ✅ |
| `src/app/services/layout-warehouse-guidance.service.ts` | | Chỉ 2 page layout-warehouse ở trên dùng | ✅ (xóa cùng với mục trên) |
| `src/app/services/layout-warehouse-settings.service.ts` | | Như trên | ✅ (xóa cùng với mục trên) |
| `src/app/services/access-control.service.ts` | 2,8 KB | Không có file nào import `AccessControlService` | ✅ |
| `src/app/services/catalog-cache.service.ts` | 9,5 KB | Không có file nào import `CatalogCacheService`. Chữ "catalog-cache" xuất hiện ở chỗ khác chỉ là tên key trong localStorage | ✅ |
| `src/app/services/find-rm1-data.service.ts` | 2,1 KB | Không có file nào import `FindRM1DataService` | ✅ |
| `src/app/services/firebase.service.ts` | 3,9 KB | Không ai import (equipment đang dùng `debug-firebase.service`, là file khác) | ✅ |
| `src/app/services/label-schedule.service.ts` | 13,7 KB | Không có file nào import `LabelScheduleService` | ✅ |
| `src/app/models/label-schedule.model.ts` | 1,3 KB | Chỉ service ở trên dùng | ✅ |
| `src/app/services/pxk-build.service.ts` | 17,9 KB | Không có file nào import `PxkBuildService` | ✅ |
| `src/app/services/ui-state.service.ts` | 0,4 KB | Không có file nào import `UiStateService` | ✅ |
| `src/app/core/notification.service.ts` | 1 KB | Bản cũ. App đang dùng `src/app/services/notification.service.ts` | ✅ |
| `src/app/pages/report/report-dmtp.service.ts` | 4,7 KB | Không có file nào import `ReportDmtpService` | ✅ |
| `src/app/pages/report/vietcombank-rate.service.ts` | 0,3 KB | Không có file nào import | ✅ |
| `src/app/pages/report/report-data.ts` | ~27 KB | Chỉ `report-dmtp.service.ts` ở trên import | ✅ (xóa cùng với mục trên) |
| `src/app/pages/shipment/shipment.component.scss` | 77 KB | Component đang dùng `shipment.component.css`, file `.scss` này bị bỏ quên | ✅ |
| `src/app/dashboard/menu-grid-styles.css` | 1,9 KB | Không có trong `styleUrls`, `angular.json` hay `@import` nào | ✅ |
| `src/app/pages/*/index.ts` (chart, fg-check, fg-in, fg-inventory, fg-location, fg-out, location, pallet-id) | < 1 KB | File barrel `export *` nhưng không ai import qua đó | ✅ (xóa thì lợi rất ít) |
| `temp_location.ts` (thư mục gốc) | 40 KB | Bản copy tạm của component location, nằm ngoài `src`, không được build | ✅ |

## 4. Asset không được tham chiếu (`src/assets`)

Hiện mọi file trong `src/assets` đều bị copy vào `dist` mỗi lần deploy. Xóa những file này sẽ làm bản deploy nhẹ hơn khoảng **5 MB**.

| Đường dẫn | Dung lượng | An toàn |
|---|---|---|
| `src/assets/img/instruction_step_1.png` | 760 KB | ✅ |
| `src/assets/img/cover.jpeg`, `preview.png`, `manage.png`, `security.png`, `print.png`, `find.png`, `utilization.png`, `loading.png`, `safetystock.png` | ~290–340 KB mỗi file | ✅ |
| `src/assets/img/D1 Safety Layout.jpg` | 180 KB | ✅ |
| `src/assets/img/sidebar-1.jpg` … `sidebar-4.jpg` | 364 KB | ✅ (ảnh mẫu của template Creative Tim) |
| `src/assets/img/faces/marc.jpg`, `tim_80x80.png`, `gears.gif`, `angular2-logo.png`, `angular2-logo-red.png`, `angular.png`, `html.png`, `mask.png`, `apple-icon.png`, `favicon.png`, `new_logo.png` | ~170 KB | ✅ (ảnh mẫu của template) |
| `src/assets/img/LayoutD_Correct_Example.svg` | 4 KB | ✅ |
| `src/assets/fonts/roboto/*.ttf` (3 file) | 864 KB | ⚠️ Không có `@font-face` hay `url()` nào trỏ tới |
| `src/assets/fonts/material-icons/MaterialIcons-Regular.ttf` | 128 KB | ⚠️ Như trên. Icon đang tải từ nguồn khác |
| `src/assets/fonts/helvetiker_regular.typeface.json` | 64 KB | ⚠️ Font cho three.js, không ai load |
| `src/assets/a5-calibration-template.html` | 8 KB | ⚠️ Có thể bạn mở trực tiếp bằng URL để căn lề máy in |
| `src/assets/documentation/` | 4 KB | ✅ Tài liệu của template |

> Lưu ý: tên ảnh có thể đang lưu trong dữ liệu Firestore, dù mình không thấy dấu hiệu nào. Nếu xóa xong mà thấy ảnh bị vỡ ở đâu, khôi phục từ git rất dễ.

## 5. Script debug / migrate chạy một lần (thư mục gốc)

Không file nào bên dưới được `package.json`, `src` hay `functions` tham chiếu. Đây đều là script Node chạy tay cho các lần sửa dữ liệu đã xong (ngày 13/04/2026).

| File | An toàn |
|---|---|
| `debug-account-display.js`, `debug-angular14.js`, `debug-delete-asp2101.js`, `debug-excel-export.js`, `debug-firebase-direct.js`, `debug-firebase-users-loading.js`, `debug-rm1-inventory.js`, `debug-simple.js`, `debug-training-report.js` | ✅ |
| `test-training-report.js`, `demo-barcode-scanner.js`, `demo-import-excel.js` | ✅ |
| `compare-and-cleanup-employees.js`, `employee-cleanup-script.js`, `migrate-local-users.js`, `fix-rm1-inventory-matching.js`, `delete-asm2-inventory.js` | ⚠️ Script sửa dữ liệu. Giữ lại nếu muốn tham khảo, còn chạy xong rồi thì xóa được |

## 6. File rác do gõ nhầm lệnh

| File | Lý do | An toàn |
|---|---|---|
| `$env`, `cd`, `firebase`, `nslookup` | File 0 byte, sinh ra ngày 13/05/2026 do gõ nhầm lệnh trong shell (redirect `>`) | ✅ |
| `how --name-only 73296a5` | Output `git log` bị lưu nhầm thành file (do gõ nhầm `git show`) | ✅ |
| `build-out.txt` | 36 KB, log build cũ ngày 11/08/2026 | ✅ |

## 7. Tài liệu `.md` cũ ở thư mục gốc

Toàn bộ được tạo cùng lúc ngày 13/04/2026, nói về các lần sửa lỗi hoặc hướng dẫn import cũ. Không có code nào tham chiếu.

| File | An toàn |
|---|---|
| `DATE_FORMAT_TEST.md`, `DEBUG_STEPS.md`, `DELETE_ASP2101_ACCOUNT_GUIDE.md`, `FIX_LOCAL_USERS_DATA.md`, `SAFETY_TAB_FIX_README.md`, `SETTINGS_USERS_FIX_GUIDE.md`, `TRAINING_REPORT_FIX_GUIDE.md`, `TRAINING_REPORT_TROUBLESHOOTING.md`, `TABS_ANALYSIS.md`, `QR_CODE_FORMAT_UPDATE.md`, `ACCOUNT_DISPLAY_UPDATE_GUIDE.md` | ✅ Ghi chú sửa lỗi đã xong |
| `ACCESS_CONTROL_README.md`, `EMAIL_SETUP_GUIDE.md`, `EXCEL_IMPORT_GUIDE.md`, `FIREBASE_SECURITY_GUIDE.md`, `FIREBASE_SETUP.md`, `IMPORT_INSTRUCTIONS.md`, `IMPORT_USAGE_GUIDE.md`, `QUICK_START_UNITWEIGHT.md`, `UNITWEIGHT_IMPORT_GUIDE.md`, `UTILIZATION_IMPORT_GUIDE.md`, `SAFETY_TAB_PALLET_FEATURES_README.md`, `firestore-rules.md` | ⚠️ Hướng dẫn sử dụng. Đọc lướt trước khi xóa |
| `CHANGELOG.md`, `ISSUE_TEMPLATE.md`, `.github/workflows/main.yml` | ✅ Của template Creative Tim gốc (workflow tự đóng issue theo mẫu Creative Tim) |
| `catalog_import_template.csv/.json/.xlsx`, `catalog_unitweight_template.csv/.json` | ⚠️ File mẫu để import. Code không dùng, nhưng có thể bạn đang gửi cho người khác điền |

## 8. Test / lint cũ (không dùng)

| Đường dẫn | Lý do | An toàn |
|---|---|---|
| `e2e/`, `protractor.conf.js` | Protractor đã ngừng hỗ trợ. Không có test e2e thật | ⚠️ Phải xóa kèm khối `"material-dashboard-angular-e2e"` trong `angular.json` |
| `tslint.json` | TSLint đã ngừng hỗ trợ. `ng lint` thực tế không chạy được | ⚠️ Phải xóa kèm các khối `"lint"` trong `angular.json` |
| `src/**/*.spec.ts` (10 file), `karma.conf.js`, `src/test.ts` | Unit test mặc định của template, không dùng | ⚠️ Phải xóa kèm khối `"test"` trong `angular.json`. Lợi rất ít, nên cứ để |

---

## ❌ KHÔNG được xóa (dễ nhầm)

- `functions/lib/`: đây là code đã biên dịch mà Firebase deploy (`"main": "lib/index.js"`).
- `functions/node_modules`, `functions-work-order-kitting/node_modules`, `zalo/node_modules`: cần để build và deploy functions từ máy này. Tuy vậy, chúng **đang bị commit vào git** (khoảng 14.500 file, mỗi thư mục ~100–115 MB). Nên bỏ track bằng `git rm -r --cached ...` rồi thêm vào `.gitignore`, file trên ổ vẫn giữ nguyên.
- `functions-stockcheck-monthly/`, `functions-work-order-kitting/`, `zalo/`, `scripts/`: đang được `firebase.json` / `package.json` dùng.
- `src/fg-label-app/`, `dist-fg-label/`: giữ nếu sau này còn deploy FG Label.
- `src/app/pages/layout-warehouse/layout-warehouse-location.util.ts`: đang được 3 page import.
- `src/index.html`, `src/styles.css`, `src/environments/environment.prod.ts`, `src/typings.d.ts`: tuy không ai `import` nhưng `angular.json` dùng trực tiếp.
- `.firebase/`, `.firebaserc`, `firebase.json`, `firestore.rules`, `firestore.indexes.json`, `storage.rules`: cấu hình deploy.

## Gợi ý thứ tự làm

1. **Xóa `.angular/` trước (giải phóng ~151 GB).** Sau đó xóa phần còn lại của mục 1 (`.netlify`, `dist-truck-schedule`, `out-tsc`, `.angular`) và mục 6. Lợi nhiều nhất, không có rủi ro.
2. Xóa code không dùng ở mục 3, chạy `npm run build` để chắc chắn vẫn build được, rồi deploy.
3. Xóa asset ở mục 4, mở thử vài trang xem có ảnh nào bị vỡ không.
4. Các mục ⚠️ thì xem từng cái.
