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

**Dừng dev server trên Windows:** trong terminal đang chạy Vite, gõ `q` rồi
`Enter` để đóng server và watcher trước khi trở về prompt. Nếu `Ctrl+C` làm
terminal VS Code chậm/treo, chạy trực tiếp Node để tránh các lớp batch của pnpm:

```powershell
fnm exec --using 24.19.0 node node_modules/vite/bin/vite.js --host 127.0.0.1
```

Đây là đường chạy tương đương cho dev, vẫn dùng dependency của dự án. Lỗi
Ctrl+C tương tự đã được [báo cáo trên Windows](https://github.com/pnpm/pnpm/issues/8022);
chưa xác nhận cùng nguyên nhân với máy này. Không cần đổi PowerShell profile,
cài runtime khác hoặc tắt toàn bộ tiến trình Node.

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
   **Documents** mở danh sách theo workspace để tìm, mở, đổi tên và xóa bản đã lưu.
   **Discard changes** bỏ phần chưa lưu, giữ checkpoint Saved nếu có. Xóa document
   không xóa component trong thư viện; thao tác xóa/bỏ không được hoàn tác bằng Undo.
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

**Nhân bản:** mở menu **Copy** trên toolbar để Duplicate, Copy, Paste hoặc Repeat.
Khi focus viewport: `Shift+D` Duplicate, `Ctrl+C` Copy, `Ctrl+V` Paste,
`Ctrl+Shift+D` Repeat. Nhập số trong panel hoặc trỏ/click vào grid để đặt preview;
**Enter / Confirm** mới ghi vào công trình, **Esc / Cancel** hủy. Một Undo/Redo
áp dụng cho toàn bộ action, kể cả hàng rào/tường lân cận nếu bật Auto connections.
Các công cụ này dùng **World**; Repeat nhập số bản sao **mới** và spacing block
khác 0 (cho phép âm). Chồng block hoặc vượt giới hạn sẽ chặn toàn action.
Clipboard giữ whole groups/components/multi-block trong phiên app, dùng qua các
workspace, không chứa entity rời và không phải clipboard hệ điều hành; reload sẽ
xóa clipboard. Copy/preview không đổi document, Save và draft chỉ ghi data đã commit.

**Dựng vùng:** chọn block và state trong palette, rồi mở **Build → Line / Plane /
Solid box / Hollow box**. Nhập hai endpoint nguyên **Start/End** (tính cả hai đầu),
trỏ/click để chỉnh End; **Enter / Confirm** dựng, **Esc / Cancel** hủy.
Các vùng theo trục World và dùng state **Design**, độc lập tùy chọn Context.
Hollow box đặt lớp vỏ, giữ nguyên nội dung bên trong. Multi-block tạo đủ các phần;
footprint chồng nhau hoặc vượt giới hạn sẽ chặn toàn thao tác. Một lần Undo hoàn tác
cả vùng và các kết nối lân cận. Đổi block/tài nguyên/workspace sẽ hủy preview đang mở.

**Vật liệu:** mở **Materials** trên toolbar để đếm ô theo Document hoặc Selected
roots, bật States để tách từng state và tải CSV/JSON. Explicit air được đếm riêng;
đây là số ô đã đặt, chưa phải số item Survival cần thu thập.
Chọn object/group/component, chọn Source và Target tương thích rồi **Preview
replacement → Confirm** để thay vật liệu; Cancel hủy, một Undo khôi phục cả lần thay.
Giữ nguyên hướng/state và đủ các phần giường/cửa, chỉ tác động các roots được chọn.
Phạm vi hiện có: các ID được khai báo thuộc pillar/log, planks, slab, stairs, door,
bed và masonry; không tự đổi mọi block chỉ vì cùng tag. 3D Preview chỉ xem/xuất counts.

Để tạo biến thể riêng: chọn **Select**, focus viewport và nhấn `A` chọn toàn bộ,
**Copy → Copy**, **New**, **Copy → Paste**, Confirm; sau đó thay vật liệu trong
Materials, đặt tên và Save. Mỗi biến thể là document độc lập trong Documents.
Workflow phòng nhỏ từ rỗng → oak/spruce/birch → lưu/mở lại → JSON/NBT đã có
browser scenario `house`; cách chạy và giới hạn nghiệm thu ở tài liệu kỹ thuật.

**Quan sát và bảo vệ object:** menu **View** có Hide selected, Show all, Lock
selected, Unlock all, Isolate selected, Exit isolate và Reset view. Outliner có
nút ẩn/khóa từng root; group/component/multi-block được xử lý nguyên object.
Khóa vẫn hiển thị nhưng không cho chọn sửa; ẩn hoặc ngoài isolate không được chọn.
Object mới tạo khi isolate sẽ tham gia vùng đang xem. Reset view khôi phục toàn bộ.
Các flags chỉ giữ trong phiên workspace, reset khi mở document khác hoặc reload;
không đổi Save, draft, Undo hay export. Ô bị ẩn vẫn chiếm chỗ khi đặt block.
Undo/Redo nội dung vẫn hoạt động; Auto connections đụng object được bảo vệ sẽ bị chặn.
**Cắt lớp theo Y:** trong View nhập **Show Y · Min/Max**, bấm **Apply**;
hai đầu đều được tính theo tọa độ ô block. **Focus selected Y** lấy khoảng Y
của toàn vùng chọn; **Clear** bỏ giới hạn Y, **Reset view** bỏ mọi filter/lock.
Object hiện một phần được bảo vệ khỏi chọn/sửa; muốn chỉnh cả group/cửa hãy mở
rộng khoảng hoặc Clear. Đặt/di chuyển object ra ngoài khoảng bị chặn.
Đây là lọc theo ô, không cắt tam giác mesh hoặc tự nhận diện tầng/mái. Entity rời
chưa thuộc policy này và vẫn hiển thị.

Workflow nội thất mẫu hai tầng đã có browser slice `interior`: chọn giường qua
Y-range, di chuyển/hủy/thử va chạm, Undo/Redo, lưu/reload và đối chiếu full JSON/NBT.
Cách chạy và giới hạn fixture được ghi trong tài liệu kỹ thuật; đây chưa thay
thế thử nghiệm builder hoặc đối chiếu đặt công trình trong Minecraft.

## Nhập Structure NBT

Trong Architecture hoặc Component Editor, bấm **Import NBT → Choose .nbt**.
Công cụ đọc Java Structure NBT gzip hoặc raw, kiểm tra **DataVersion 4903 / 26.2**,
palette/state và multi-block, rồi hiển thị báo cáo. Chọn xác nhận và **Import as new**
để tạo document Saved mới; công việc hiện tại được bảo vệ ở Recovery trước khi chuyển.
Cancel hoặc lỗi không thay công trình đang mở. Nạp game profile trước để nhận đủ block.

Phạm vi đầu tiên: blocks và legal states, bed/door/tall plant hoàn chỉnh; giữ explicit
air và các khoảng trống sparse. **Chưa nhập entity hoặc block-entity payload** như
rương/sign/banner NBT; file có dữ liệu đó bị từ chối, không bỏ ngầm. Không nhận world,
`.schem`, `.litematic`, multiple palettes hoặc tự chuyển game version. Giới hạn file
16 MiB, giải nén 32 MiB, 100.000 block entries, mỗi dimension tối đa 2048; export
vẫn có policy 48. Empty border trong size không được giữ thành bounds editor.

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
trình duyệt hoặc xóa storage có thể làm mất quyền truy cập dữ liệu cũ. **Draft
protected** là bản nháp đã ghi thành công; **Saved** là checkpoint do bạn bấm Save.
Autosave draft sau khoảng 750ms ngừng sửa, tối đa 5s khi sửa liên tục (tab nền có
thể chậm hơn). Trong lúc còn Protecting draft hoặc báo lỗi, phần mới chưa được bảo vệ.
Sau reload, mở **Documents → Recovery → Restore**; công cụ không tự áp bản nháp.
Nếu Saved đã đổi, dùng **Recover copy** hoặc nút tải JSON. Lưu thường xuyên và
xuất JSON backup ngoài trình duyệt; recovery vẫn thuộc origin, không chống mọi
crash/mất điện hoặc browser eviction. JSON không nhúng pack/profile, giữ file nguồn.
Save có kiểm tra phiên bản lưu để tránh ghi đè từ phiên khác. Nếu gặp conflict,
xuất JSON giữ chỉnh sửa local trước khi reload/mở lại bản đã lưu. New trên bản
rỗng chưa sửa không tạo thêm Saved/draft; bản có sửa được bảo vệ ở Recovery trước khi chuyển.
Save chủ động vẫn lưu bản rỗng. Documents có Refresh để đọc thay đổi từ tab khác;
recovery có thông báo thay đổi giữa tab khi browser hỗ trợ. Saved list không tự
merge hoặc ghi đè local edits. Lỗi bảo vệ hiện nút Retry; giới hạn 32 recovery
copies / 64 MiB payload, mỗi snapshot tối đa 32 MiB. Không tự xóa bản cũ để dọn chỗ.

**Documents → Storage** hiển thị dung lượng/quota ước tính của origin và trạng
thái persistent storage. Chỉ khi bấm **Request persistent storage** công cụ mới
gửi yêu cầu; trình duyệt có thể từ chối. Refresh đọc lại thông tin, không dọn/xóa
dữ liệu. Persistence không thay backup JSON ngoài trình duyệt.

**Documents → Backup → Download backup** tạo file `.blockstage-backup.json`:
một document hiện tại, tùy chọn kèm toàn bộ component library và manifest hash/
thứ tự tài nguyên. File không chứa game assets/profile geometry, lịch sử Undo
hoặc các bản recovery. Giữ riêng JAR/ZIP/profile để nhập lại khi chuyển máy.
**Open backup** chỉ đọc và báo tương thích; nếu thiếu tài nguyên cần xác nhận
giữ nguyên dữ liệu trước khi **Restore as new**. Restore tạo document/component
với ID mới, không ghi đè dữ liệu cũ. Chuyển đúng Architecture/Component workspace
trước khi mở backup. Giới hạn 32 MiB JSON, 256 component definitions và 100.000
cells/objects tổng; bỏ chọn library khi quá lớn. JSON document cũ vẫn dùng Open JSON.

```powershell
fnm exec --using 24.19.0 pnpm.cmd check
```

Code gate, production browser smoke và game oracle có hướng dẫn tập trung trong
[tài liệu kỹ thuật](docs/02_TECHNICAL_DESIGN.md). Kết quả đã ghi nhận và những phần
chưa kiểm chứng nằm trong [hiện trạng](docs/03_STATUS_AND_ROADMAP.md).

Không đóng gói game JAR, extracted textures/profile, secrets, cache, world thử
hoặc browser storage vào Git/build. Không tự commit/push khi chưa được yêu cầu.
