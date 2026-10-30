# 01 — Mục tiêu sản phẩm Blockstage Studio

Blockstage Studio là công cụ CAD kiến trúc **local-first, block-native dành cho
Minecraft Java**: từ tài nguyên game, người dùng tạo thành phần dùng lại, lắp thành
công trình, phát triển các biến thể và xuất sang game với dữ liệu có thể kiểm chứng.
Giá trị cốt lõi là giảm công việc lặp lại mà vẫn giữ đúng ô block, hướng và state.

Tài liệu này mô tả **đích sản phẩm dài hạn**, không công bố toàn bộ chức năng đã có.
Trạng thái triển khai, giới hạn và thứ tự các giai đoạn nằm trong
[03 — Trạng thái và lộ trình](03_STATUS_AND_ROADMAP.md).
Hợp đồng dữ liệu, tương tác và kiểm chứng nằm trong
[02 — Thiết kế kỹ thuật](02_TECHNICAL_DESIGN.md); cách chạy nằm ở
[README](../README.md).

## Các mốc hoàn thiện hữu hạn

Mục tiêu G01–G08 là đích dài hạn, được chia thành các release để có thể hoàn tất
và sử dụng trước khi hỗ trợ mọi khả năng của Minecraft. Phạm vi chi tiết, task IDs,
dependencies và gates nằm trong tài liệu 03; bảng này là lời hứa sản phẩm.

| Release | Kết quả người dùng | Phạm vi chính |
| --- | --- | --- |
| **R1 — Architectural Editor 1.0** | Dựng/sửa nhà hai tầng nhiều phòng, reuse mẫu, đổi vật liệu hợp lệ, sửa nội thất, phục hồi/chuyển máy và xuất vào runtime đã xác minh. | Recovery/portable, duplicate/clipboard/repeat/dựng vùng, visibility, material replace/counts, component copies, palette appearance/state/payload/entity và format subset có công bố. G01/G03/G06/G07/G08 trong scope; phần nền G02/G04/G05. |
| **R2 — Modular Architecture 1.0** | Tạo thư viện module và ba biến thể kiến trúc; update nguồn/overrides, material kits, lắp sockets và generators có quy tắc. | Hoàn thiện G02/G04/G05 cho tập module công bố, duy trì chất lượng/gates R1; không kéo giãn voxel tùy ý. |
| **Extensions** | Mở rộng formats, game versions, payload/renderers/mod integration hoặc desktop theo nhu cầu. | Mỗi adapter/runtime có gate; không phải điều kiện vô hạn để đóng R1/R2. |

Không đồng nhất **registry có ID**, **render được**, **chỉnh/transform được**,
**nhập/xuất được** và **đã kiểm world**. Release phải công bố capability matrix
theo palette/action/version/runtime, fallback/lý do và phạm vi chưa xác minh.
Số test đã chạy hoặc một fixture mẫu không thay thế hành trình builder hoàn chỉnh.

## Người dùng và công việc chính

- Builder thiết kế nhà, lâu đài hoặc đô thị cần lặp cột, tường, cửa, mái và sửa
  nhiều phần cùng lúc mà không phải dựng lại từng block.
- Người làm schematic hoặc hướng dẫn cần tạo biến thể vật liệu, quản lý mẫu,
  quan sát công trình rõ ràng và xuất dữ liệu dùng được trong công cụ/game đích.
- Builder chuẩn bị xây trong survival/server cần blueprint, số lượng vật liệu
  và cảnh báo rõ về support, payload hoặc hành vi chưa được kiểm chứng.

Sản phẩm phục vụ cả ngoại thất lẫn nội thất: chọn đồ trong phòng hẹp, quan sát
nhiều tầng, ẩn mái hoặc cắt lớp phải dễ hiểu và không làm mất dữ liệu công trình.
Chất lượng phải được chứng minh bằng một tác vụ kiến trúc hoàn chỉnh, bao gồm
sửa lại thiết kế và đưa kết quả sang game; ảnh demo đẹp riêng lẻ chưa đủ.

## Hành trình sản phẩm

1. **Tài nguyên:** chọn phiên bản game, nạp tài nguyên hợp lệ, duyệt block/entity,
   kiểm tra state và hiểu phần nào chỉ có registry, phần nào render được.
2. **Thành phần:** tạo cột, tường, cửa sổ, mái hoặc đồ nội thất trong Component
   Editor; đặt tên, anchor/pivot, hướng, vai trò vật liệu và quy tắc lắp ghép.
3. **Kiến trúc:** lắp các thành phần trong Architecture Editor bằng thao tác 3D,
   chọn/nhóm/biến đổi chính xác, nhân mẫu, sửa nội thất và tạo biến thể.
4. **Kiểm tra:** dùng 3D Preview để đánh giá không gian; xem chỗ xung đột,
   thiếu tài nguyên, không tương thích hoặc có nguy cơ khác kết quả trong game.
5. **Xuất và đối chiếu:** kiểm tra trước xuất, tạo file đúng định dạng/phiên bản,
   đặt vào world thử rồi đọc ngược dữ liệu để xác nhận phạm vi tương thích.

Các workspace có vai trò riêng nhưng dùng chung hợp đồng dữ liệu. Xem một asset,
đổi resource pack hoặc di chuyển camera không được sửa công trình.

## G01 — Tài nguyên đúng phiên bản, phân loại hữu ích

Người dùng cần duyệt bằng ID/tên, namespace, creative tab và tag; đồng thời thấy
state hợp lệ, hình xem trước và lý do khi thiếu model/texture/renderer.
Nguồn tài nguyên do người dùng cung cấp; bản phân phối không kèm game JAR hay
asset Mojang. Thứ tự pack phải rõ và có kết quả ghi đè xác định.

Game profile là nguồn của ID và miền property; resource pack chỉ thay diện mạo.
Đích dài hạn là hỗ trợ nhiều phiên bản Java qua profile/adapter có kiểm chứng.
**Java 26.2 / DataVersion 4903 là baseline đầu tiên**, không phải bằng chứng rằng
các phiên bản khác hoặc mọi mod Fabric đã tương thích.

**Gate G01:** nhập profile và pack, tìm một block, đổi state, đổi precedence rồi
mở lại workspace; state công trình giữ nguyên, lỗi/thiếu tài nguyên có thông báo
và người dùng phân biệt được khả năng duyệt, render, chỉnh sửa và xuất.

## G02 — Mô hình block và thành phần có quyền sở hữu rõ

Một **Block** là state tại một ô nguyên. Một **MultiBlock** là vật thể logic có
nhiều ô phụ thuộc nhau, như door hoặc bed; đặt/chọn/xóa/biến đổi phải toàn vẹn.
Một **Group** gom các object để tổ chức và thao tác, không làm mất cấu trúc con.
Một **reusable component** là mẫu có nội dung local, kích thước, pivot và hướng
để lưu thư viện, chỉnh sửa và đặt nhiều lần.

Đích sản phẩm gồm cả bản sao độc lập lẫn linked instance. Khi sửa mẫu dùng chung,
phải rõ phạm vi ảnh hưởng, overrides và lựa chọn tạo bản riêng; không âm thầm đổi
mọi bản đã đặt. Nested components cần ngăn vòng tham chiếu và giữ quyền sở hữu.
Mô hình liên kết nào đã có hiện nay phải tra tài liệu trạng thái, không suy từ mục tiêu này.

**Gate G02:** tạo cửa sổ từ nhiều block, lưu mẫu, đặt nhiều bản, nhóm với cột,
sửa một bản và sửa nguồn theo hai phạm vi rõ ràng; undo khôi phục nguyên dữ liệu,
không có nửa MultiBlock bị bỏ lại hoặc instance khác đổi ngoài dự kiến.

## G03 — Biên tập trực tiếp, chính xác và có thể hoàn tác

Viewport là nơi làm việc chính. Chuột/gizmo và phím modal/nhập số phải là hai
đường thao tác tương đương; Inspector hỗ trợ các chi tiết khó diễn đạt trực quan.
Selection cần rõ hover, tập chọn, item chủ và phạm vi object/component/block.
Box selection, chọn xuyên/chỉ phần nhìn thấy, hide/lock/isolate và hierarchy phải
có ngữ nghĩa rõ, đặc biệt khi sửa nội thất giữa nhiều tầng.

Điều khiển lấy cảm hứng từ Blender: orbit/pan/zoom, view trực giao, frame,
fly, `G` move, `R` rotate, khóa trục/mặt phẳng và nhập số. Luôn dùng hệ Minecraft
**+Y lên, +X đông, +Z nam**, một đơn vị bằng một block.
`S` hướng tới resize/repeat theo quy tắc, không kéo giãn voxel bằng số thực.

Mỗi thao tác có preview tách biệt, xác nhận hoặc hủy rõ ràng, một bước undo/redo.
Va chạm mặc định bị từ chối; mọi chế độ ghi đè phải có preview và phạm vi cụ thể.
Phím đi theo focus/tool/modal; nhập văn bản không kích hoạt lệnh viewport.

**Gate G03:** chọn nhóm có stairs/log, kéo gizmo và dùng `G X 10 Enter`, xoay
quanh pivot hợp lệ, thử va chạm, hủy và undo/redo; cell/state phải khớp preview,
không trôi nửa ô, không lưu thay đổi sau hủy và không phát sinh lệnh khi gõ tên.

## G04 — Lắp ghép kiến trúc và nội thất bằng quy tắc

Thành phần cần có anchor, định hướng và điều kiện ghép rõ ràng. Đích dài hạn gồm
typed sockets, snap theo mặt/hướng, repeat/array, mirror qua adapter và tham số
cho tường, cột, mái, cầu thang, sàn hoặc các mô-đun nội thất.
Resize phải sinh lại các ô theo quy tắc có ý nghĩa, giữ cửa/lỗ mở/đầu mút theo
hợp đồng của mẫu; mẫu cố định không có quy tắc phải báo không hỗ trợ.

Ô chiếm thực quyết định xung đột: lỗ rỗng giữa cổng không phải khối đặc chỉ vì
nằm trong bounds. Quy tắc lắp ghép khác điều kiện support trong world Minecraft.

**Gate G04:** lắp nhà hai tầng từ cột/tường/cửa sổ/mái và đồ nội thất, nối đúng
socket, tăng nhịp tường, nhân một tầng; không ghi đè lỗ mở hoặc đồ ngoài selection,
preview chỉ rõ xung đột và undo hoàn tác cả phép sinh/lắp ghép.

## G05 — Biến thể vật liệu giữ hình thái và ý định

Phân loại cần ba lớp: facets từ registry để duyệt; family hình học/hành vi do
adapter xác định; vai trò kiến trúc như tường, dầm, mái, sàn, kính và trang trí.
Material kit ánh xạ vai trò sang block tương thích, không chỉ đổi tên texture.
Tag/creative tab không phải bằng chứng thay vật liệu an toàn.

Đổi oak log sang spruce log phải giữ axis khi hợp lệ; log sang stairs cần bị
chặn hoặc có quy tắc chuyển đổi riêng. Facing/half/shape/waterlogged và payload
không được mất âm thầm. Kit thiếu slot phải báo coverage, giữ nguồn hoặc yêu cầu
lựa chọn rõ; tôn trọng material lock và override từng instance.

**Gate G05:** tạo ba biến thể vật liệu của cùng một căn nhà bằng batch preview;
kiểm tra mái/dầm/cửa/kính, danh sách missing/incompatible và property thay đổi;
commit/undo nguyên thao tác, không phải sửa hướng từng block sau thay kit.

## G06 — Đúng state, rõ ranh giới hành vi game

Tọa độ ô, tên block namespace và string properties hợp lệ là dữ liệu chuẩn.
Phép xoay/gương phải biến đổi cả vị trí lẫn state/payload qua adapter phù hợp,
không chỉ quay mesh; không suy hướng từ texture hoặc áp cùng một luật cho mọi loại.

Design placement giữ ý định state; đặt theo context/player-like suy từ cú click;
neighbor/world updates là phạm vi khác. Support diagnostics có giới hạn và không
đồng nghĩa mô phỏng gravity, fluids, redstone hay tick. Unknown state/NBT phải
được giữ hoặc từ chối với lý do, không âm thầm thay thế hay bỏ dữ liệu.

Fabric là hướng kiểm chứng và tích hợp instance về sau. Mọi tuyên bố game-exact
cần fixture đúng version/mod fingerprint và world readback; có JAR, registry hoặc
đọc NBT bằng game classes chưa đủ để cam kết kết quả đặt trong world.

**Gate G06:** đối chiếu các family đã công bố hỗ trợ bằng fixtures trong game,
bao gồm xoay nhiều lần, MultiBlock, placement theo mặt click và neighbor/support;
phân biệt sai adapter, sai renderer và thay đổi do tick, ghi rõ phần chưa xác minh.

## G07 — Lưu an toàn và xuất dùng được

Local-first: bắt đầu không cần tài khoản; dữ liệu công trình thuộc người dùng.
Project cần version, tham chiếu/fingerprint tài nguyên, lưu/mở, recovery và migration
có kiểm soát. Thiếu pack vẫn phải đọc được dữ liệu; không tự ghi đè dự án cũ.

Vanilla Structure NBT/datapack là đường xuất đầu tiên. `.schem` và `.litematic`
là các adapter định dạng riêng trong đích dài hạn; không suy hỗ trợ từ đuôi file.
Preflight phải chỉ rõ state/payload/phiên bản không hỗ trợ, giới hạn kích thước,
origin, ô trống so với `air` và phần runtime có thể đổi sau đặt. Hướng tới BOM,
layer/build instructions và views phục vụ hướng dẫn khi workflow cốt lõi ổn định.

**Gate G07:** lưu/mở lại công trình, thử thiếu pack và lỗi lưu/import, xuất mẫu
có orientation/MultiBlock/payload được hỗ trợ rồi đặt vào world thử, đọc ngược
so sánh state và tọa độ; không mất dữ liệu, không báo thành công giả khi bị chặn.

## G08 — Chất lượng sử dụng, hình ảnh và hiệu suất có bằng chứng

Giao diện cần sạch, chuyên nghiệp và có cảm giác thẩm mỹ: viewport lớn, dark
surfaces tiết chế, typography rõ, icon nhất quán, ít màu nhấn, bố cục có chủ đích.
Đẹp phải giúp đọc hình khối, khoảng trống và selection; không che lỗi bằng preview giả.
Điều khiển có accessible name, focus rõ, tương phản đủ, hỗ trợ laptop thiếu numpad
hoặc MMB, panel co giãn và trạng thái loading/empty/error dễ hiểu.

Mục tiêu là tương tác mượt ở công trình kiến trúc lớn, tài nguyên/memory có giới hạn
và không render liên tục khi đứng yên. Scene 100k block là bài benchmark mục tiêu;
1M block là hướng nghiên cứu. Không cam kết FPS từ CPU flatten hoặc browser smoke.
Mọi số đo cần cấu hình máy/GPU, scene, độ phân giải, p95 thao tác và peak memory.

**Gate G08:** quan sát builder hoàn thành hành trình tạo mẫu → lắp nhà → đổi vật
liệu → xuất, bằng chuột và bàn phím, kể cả nội thất; ghi task success, thời gian,
lỗi, undo và các điểm khó hiểu. So sánh baseline trước khi tuyên bố nhanh hơn;
đo GPU và độ trễ thực trên scene đại diện trước khi công bố năng lực hiệu suất.

## Ranh giới và cách dùng các mục tiêu

AI, marketplace, cloud collaboration, terrain tools, desktop packaging và mô phỏng
game đầy đủ chỉ được cân nhắc khi có nhu cầu đã chứng minh; không thay thế việc
hoàn thiện quy trình CAD kiến trúc. Không lấy doanh thu, quy mô thị trường hay ưu thế
so với công cụ khác làm sự thật khi chưa có nghiên cứu người dùng phù hợp.

G01–G08 là mã mục tiêu ổn định để nối thiết kế và kiểm thử với giá trị người dùng.
Mỗi milestone chỉ nhận phạm vi cụ thể và gate tương ứng trong tài liệu trạng thái;
việc một phần của gate đã đạt không có nghĩa toàn bộ mục tiêu dài hạn đã hoàn thành.
