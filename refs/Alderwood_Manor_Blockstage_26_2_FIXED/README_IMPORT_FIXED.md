# Alderwood Manor — NBT đã sửa theo Minecraft Java 26.2 / DataVersion 4903

## File cần nạp

- `Alderwood_Manor_Blockstage_26_2_FULL_PREVIEW.nbt` — toàn bộ trang viên (40.541 block).
- `Alderwood_Manor_Blockstage_26_2_LIGHT_NO_GROUND.nbt` — mô hình không có lớp nền cỏ (25.693 block).
- `buildings/` — 9 tòa nhà riêng, dùng để kiểm tra từng phần.
- `tiles_32x32/` — 16 tile; offsets được ghi trong `KIEM_TRA_NBT_FIXED.json`, giữ nguyên theo gói trước.

## Nguyên nhân lỗi và bản sửa

Thông báo `minecraft:loom: facing không hợp lệ` xuất hiện vì một state của `minecraft:loom` không có thuộc tính `Properties.facing`.

Theo registry Minecraft Java 26.2, loom yêu cầu `facing` với một trong `north`, `south`, `east`, `west`.
Bản này gán **`north`** (default vanilla) tại tọa độ global `(67,2,19)` và các bản sao tương ứng trong `buildings/01_Nha_chinh.nbt` cùng `tiles_32x32/alderwood_z00_x02.nbt`.
Dữ liệu gốc không có hướng loom để phục hồi. Chỉ thuộc tính blockstate này thay đổi; toàn bộ tọa độ và block ID được giữ nguyên.

## Kiểm tra

- Tất cả 27 NBT được parse và đọc ngược; kiểm DataVersion 4903, root fields, palette, vị trí, không trùng block, entity rỗng, không có payload của block entity, giới hạn kích thước của importer.
- Tất cả 90 trạng thái palette ở bản tổng thể được đối chiếu tên thuộc tính và miền giá trị với dữ liệu block 26.2 công khai; chỉ phát hiện thiếu facing trên loom.
- File FULL và 16 tiles đã được ghép và so blockstate từng ô, đạt.
- Đã loại file NBT 1.20.1 khỏi ZIP để tránh chọn nhầm. Giữ file thay thế 86 vị trí block-entity ở gói trước; các block đại diện vẫn không có chức năng thật.
- **Chưa kiểm tra import trực tiếp bằng phiên Blockstage Studio trên máy người dùng**, chưa kiểm game runtime và chưa có profile JSON của máy để đối chiếu fingerprint. Vì vậy kết quả này là structural/registry audit, không phải cam kết import thực tế.

## Cách sử dụng

Blockstage Studio → Resources: đảm bảo nạp game profile **26.2/4903** → Import NBT → chọn file FULL PREVIEW → kiểm report → Import as new.
Nếu máy chậm, dùng LIGHT_NO_GROUND. Nếu vẫn bị từ chối, gửi **nguyên văn** lý do mới để đối chiếu với implementation source của importer.
