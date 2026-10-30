# Blockstage Studio

Công cụ thiết kế kiến trúc local-first cho Minecraft Java: nạp tài nguyên game,
tạo thành phần dùng lại, lắp công trình và xuất sang game. Baseline hiện tại là
**Java 26.2 / DataVersion 4903**; chạy trong trình duyệt, không cần tài khoản.

## Bộ tài liệu chính

Đọc theo thứ tự khi bắt đầu hoặc tiếp tục phát triển:

1. [Mục tiêu sản phẩm](docs/01_PRODUCT_GOALS.md): mô tả công cụ, tính năng đích,
   nguyên tắc sản phẩm và tiêu chí cần đạt.
2. [Thiết kế kỹ thuật](docs/02_TECHNICAL_DESIGN.md): stack, module, schema,
   interaction, renderer, persistence, export và lệnh kiểm chứng.
3. [Hiện trạng và lộ trình](docs/03_STATUS_AND_ROADMAP.md): đã có/một phần/chưa có/
   chưa kiểm chứng; ưu tiên, phụ thuộc và nghiệm thu từng bước.

[AGENTS.md](AGENTS.md) chứa quy chuẩn làm việc cho agent. Các tài liệu nghiên cứu,
audit và báo cáo theo mốc trước đây đã được hợp nhất vào ba tài liệu trên.
Để phân việc song song, xem **§4 Task catalogue** và **§5 Waves/mẫu giao task**
trong tài liệu 03; ưu tiên theo dependency và file ownership, không chạy mọi task cùng lúc.

[Ghi nhận lỗi thực tế](docs/04_CURRENT_ISSUES.md) là phụ lục triage cho các vấn đề
appearance, batch state edit, neighbor connections và chọn/đặt block mảnh; có
trạng thái sửa/giới hạn và bằng chứng của từng mục, không thay roadmap.

## Chạy local

Giữ Node **24.19.0** qua fnm và pnpm **11.20.0**, dùng lockfile hiện có:

```powershell
fnm exec --using 24.19.0 pnpm.cmd install --frozen-lockfile
fnm exec --using 24.19.0 pnpm.cmd dev --host 127.0.0.1
```

Mở URL Vite in ra, thường `http://127.0.0.1:5173/`.

## Bắt đầu sử dụng

1. Trong **Resources**, nhập client vanilla `26.2.jar` hoặc resource pack ZIP
   format 88.0. Fabric Loader JAR không chứa tài nguyên thay thế client.
2. Để có registry/model layers đầy đủ, đặt client ở `public/26.2.jar`, dùng Java
   25 JDK hiện có rồi chạy:

   ```powershell
   fnm exec --using 24.19.0 pnpm.cmd prepare:game
   ```

   Nhập `public/generated/26.2.profile.json` qua **Import game profile**. Dev có
   thể đọc profile generated khi chưa có bản lưu; production cần nhập riêng.
   Cấu hình JDK/đường dẫn khác được ghi trong tài liệu kỹ thuật.
3. **Assets** xem tài nguyên; **Component Editor** thiết kế mẫu;
   **Architecture** dựng công trình; **3D Preview** xem chỉ đọc.
4. Chọn block/component rồi đặt. **Design** giữ palette state; **Context** derive
   một số axis/half/facing theo mặt click và camera. `R`/`Shift+R` xoay ghost 90°,
   `Esc` hủy. Support notes có giới hạn, không phải mô phỏng game đầy đủ.
5. Select/Shift-click chọn ô block gần nhất (kể cả model mảnh), hoặc `B` chọn vùng;
   `G`/`R` transform, nhập số, `Enter`
   commit và `Esc` hủy. `Ctrl+G`/`Ctrl+Alt+G` Group/Ungroup;
   `Ctrl+Z`/`Ctrl+Shift+Z` Undo/Redo. **Save / Ctrl+S** lưu document.
   Inspector cho sửa state chung của nhiều block; giá trị khác nhau hiện **Mixed**.
6. Muốn fence/wall/cổng tự nối: chạy lại `prepare:game`, nhập lại JSON profile
   trong Resources, rồi bật **Auto connections** trong Inspector. Tùy chọn chỉ
   tác động các lần sửa tiếp theo, mặc định tắt sau reload; tắt để giữ state tay.
   Profile mới cũng cung cấp màu chuẩn cho banner. Banner hiện hỗ trợ màu nền/
   tư thế tĩnh; conduit hiện preview chưa kích hoạt, chưa có hoa văn/hiệu ứng động.

MMB orbit, Shift+MMB pan, wheel/Ctrl+MMB zoom; Home frame all, F/Numpad . frame
selection. Widget XYZ hoặc Numpad 1/3/7 chuyển view trực giao; Numpad 5 đổi
projection. Một đơn vị bằng một block, **+Y lên, +X đông, +Z nam**.
Mở **Controls** để xem phím và dùng nút viewport nếu không có numpad.

## Xuất sang Minecraft

Trong Architecture/Component Editor, chọn **Export Minecraft → Datapack**.
Chép ZIP vào `<world>/datapacks`, bật commands, chạy `/reload`, rồi:

```mcfunction
/place template blockstage:build ~ ~ ~
```

Thử ở Creative world riêng. Mỗi ZIP dùng cùng ID `blockstage:build`; chỉ bật một
pack để tránh override. NBT riêng trên 26.2 đặt ở
`<world>/generated/blockstage/structure/build.nbt` (`structure` số ít).

Hiện giới hạn 48 block mỗi chiều; payload block entity và entity ngoài adapter bị
chặn rõ. Khoảng trống giữ nguyên ô đích; explicit air xóa ô đích. JSON backup giữ
cấu trúc editor; NBT flatten thành dữ liệu game. Phạm vi world/Fabric đã kiểm thử
được ghi riêng trong tài liệu hiện trạng.

## Lưu dữ liệu và kiểm tra

Document, component, pack/profile lưu trong IndexedDB theo origin. Đổi IP/cổng,
trình duyệt hoặc xóa storage có thể làm mất quyền truy cập dữ liệu cũ. **Chưa có
autosave/crash recovery**; lưu thường xuyên và xuất JSON backup. JSON không nhúng
resource pack/profile; giữ file nguồn để nhập lại khi chuyển máy.

```powershell
fnm exec --using 24.19.0 pnpm.cmd check
```

Code gate, production browser smoke và game oracle có hướng dẫn tập trung trong
[tài liệu kỹ thuật](docs/02_TECHNICAL_DESIGN.md). Kết quả đã ghi nhận và những phần
chưa kiểm chứng nằm trong [hiện trạng](docs/03_STATUS_AND_ROADMAP.md).

Không đóng gói game JAR, extracted textures/profile, secrets, cache, world thử
hoặc browser storage vào Git/build. Git chưa có commit/remote/push ở mốc tổng hợp.
