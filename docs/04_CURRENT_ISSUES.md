# 04 — Ghi nhận lỗi và cải thiện từ sử dụng thực tế

Ngày ghi nhận: **30/10/2026**. Nguồn: sáu phản ánh của chủ dự án, ảnh viewport
đính kèm trong cuộc trò chuyện và đọc source/JAR local. Bổ sung BUG-07 từ ảnh
Open saved có nhiều Untitled component, không có thao tác xóa. Bản ghi nhận ban đầu chưa
sửa hoặc tái hiện. Cập nhật cùng ngày: đã xử lý phần chọn ô, chain/lantern và rò
pixel mép animation; trạng thái và giới hạn mới ở bảng dưới. Không coi các mục
còn lại là đã sửa.

Đây là phụ lục triage để phiên sau nhớ đúng vấn đề, không thay mục tiêu/thiết kế
hoặc tạo roadmap cạnh tranh. Đọc cùng [thiết kế kỹ thuật](02_TECHNICAL_DESIGN.md)
và [task catalogue](03_STATUS_AND_ROADMAP.md). Các lỗi có thể cùng lộ ra một thiếu
sót nền tảng, nhưng chưa được gom thành một nguyên nhân khi chưa kiểm chứng.

## Tóm tắt và thứ tự kiểm tra đề xuất

| ID | Hiện tượng / yêu cầu | Phân loại hiện tại | Ưu tiên triage | Task liên quan |
| --- | --- | --- | --- | --- |
| BUG-01 | Lantern/campfire và bản soul hiển thị bất thường | **PARTIAL:** sửa frame bleed và z-fighting của opposing planar faces; chưa tái hiện full-strip ảnh gốc với vanilla nhập mới | Cao: cần đối chiếu pack lưu của người dùng | R01/R02, R06, Q01 |
| BUG-02 | Banner/conduit báo model thiếu elements | **PARTIAL:** đã có static base-color banner standing/wall và inactive conduit; thiếu patterns/cloth/active effects/payload | Các case ban đầu đã hiện model; coverage mở rộng chưa hoàn tất | K02/G01, R01/R02, N02/N03 |
| BUG-03 | Chọn nhiều block cùng loại không sửa state hàng loạt được | **RESOLVED trong scope đã công bố:** same-ID fields, finite cross-ID semantics, Mixed, atomic batch; group/component không flatten | Đã có domain/browser regression; không neighbor simulation | K03, B06/B09 (không đồng nghĩa các task lớn này đã hoàn tất) |
| BUG-04 | Fence/wall phải chỉnh connection state bằng tay | **RESOLVED trong static scene scope:** opt-in fence/wall/gate auto connections, cùng preview/commit và Undo; dynamic shapes có reason giữ state | 521 actual-world fixtures; không full simulation/auto-pane | G02c/G02e, G04a/G04c, G07; pane khi mở rộng |
| BUG-05 | Đặt đèn treo vào chain khó/sai vị trí hoặc bị đè | **PARTIAL / bounded fix:** mặt ô chain + Context hanging dọc + cảnh báo support hữu hạn; còn side fallback/fluid/support khác | Đã kiểm tra vanilla 26.2; Fabric chưa kiểm chứng | K05/K03, G01/G05/G07, V02 |
| BUG-06 | Block mảnh/nhỏ khó click để chọn | **RESOLVED trong editor hiện hành:** click theo occupied cell gần nhất, không phụ thuộc mesh mảnh | Theo dõi scene lớn; chưa có GPU/performance claim | K05, V01/V02/V06, P02/P04 |
| BUG-07 | Open saved tích tụ Untitled component/bản làm dở, không có nút xóa | **RESOLVED cho quản lý v2 hiện tại:** Documents mở/rename/delete, discard; draft riêng/Recovery và chống ghi lại sau xóa đã có | Tiếp tục portable/storage health, không coi recovery là backup ngoài origin | K04, D01–D04, D07 |
| BUG-08 | Chuyển Select/Place/Move rườm rà, G bị bỏ qua trong Place, thiếu Ctrl+A/kéo chọn trực tiếp; ghost chỉ wireframe | **Đã sửa trong interaction subset:** Q/E, Alt-click trong Place, G chuyển Move, Ctrl/Meta+A, kéo chọn trực tiếp; Ctrl+kéo plane và ghost texture | Xem bằng chứng và giới hạn cập nhật trong tài liệu 03 | G03, B09, V02/Q04 |

BUG-05 đã có oracle lantern/chain riêng; fixture block khác không chứng minh luật
treo đèn. Không tự gán mọi renderer hoặc block chức năng là lỗi. Nội dung “đã đọc
source” và giả thuyết phía dưới giữ lại bối cảnh ban đầu; cập nhật triển khai sau
đây là nguồn trạng thái mới.

## Kết quả đợt sửa 30/10/2026

- **BUG-06:** `CellPicker` index chunk 16³, ray chọn cell không-air gần nhất;
  group chọn theo cell con, không lấy cả bounding box rỗng. Clip/local lọc trước
  indexing. Không đổi kích thước model hoặc giả định game collision full cube.
  Native-browser đã thử chain ở vùng trống model, vật phía trước/sau, Shift,
  ray rỗng, zoom và hai projection; selection/camera không đổi document/history.
- **BUG-05:** riêng 9 chain IDs dùng cell-face khi đặt, có kiểm mesh chắn phía
  trước; các block khác giữ mặt mesh (regression slab/stair vẫn chạy). Context
  derive axis của chain và hanging theo mặt trên/dưới cho 10 lantern IDs; Design
  giữ state. Side click giữ palette với note, không giả lập alternate support.
  Hai lantern vanilla/soul khô có diagnostics cho stone và 9 chain khô: chỉ
  chain axis=y đỡ được đèn ở trên/dưới; x/z báo invalid, absent cell báo thiếu
  support nhưng world đích chưa biết, state/fluid/support chưa xác minh báo unknown.
  Warning không chặn Design/export; copper-lantern support chưa có adapter.
- **Oracle mới:** `artifacts/placement-world-SXa2tK/placement-oracle.json`, client
  SHA-1 `2dc72797acbc1b63fc16a11c4ac393605f453754`: 200 placement contexts,
  102 survival fixtures và **336 BlockItem lantern placements** (40 thành công,
  296 từ chối). Đọc state sau đặt/sau 20 tick, giữ chain nguyên, xóa support rồi
  kiểm đèn biến mất. Chạy vanilla GameTestServer cô lập; chưa chạy Fabric của người dùng.
- **BUG-01:** vanilla nhập mới crop đúng một frame, chưa tái hiện các dải lặp
  trong ảnh gốc. Đã tái hiện vệt pixel mảnh trên campfire do UV chạm ranh giới
  sprite lấy pixel frame liền kề; inset 0.01 texel giữ nearest sample bên trong
  frame. Tách parser/timing vào `texture-animation.ts`, validate bounded grid,
  frame sequence/duration, áp ngay frame đầu được khai báo. Giữ cache/idle lifecycle.
  Test kiểm pixel sampling float32 ở mép frame cho strip 16×48 và 16×128.
  Legacy pack thiếu `.mcmeta` vẫn chỉ là giả thuyết: restore dùng bytes đã lưu,
  không tự đọc lại JAR; duplicate fingerprint bị chặn. Khi cần thử nhập lại phải
  giữ file nguồn, gỡ đúng pack rồi nhập lại; thao tác này không tự được thực hiện.
- **BUG-01, nguyên nhân thứ hai đã xác nhận:** campfire khai báo hai mặt đối
  nhau trên cùng mặt phẳng không có độ dày. Render cả hai với `DoubleSide` tạo
  checker/moiré do z-fighting; ảnh trước/sau cùng frame xác nhận được. Chỉ các
  face có opposing face cùng plane zero-thickness được đánh dấu single-sided;
  không đổi material của entity, cube thường hoặc custom plane chỉ có một face.
  Không đồng nhất z-fighting này với giả thuyết mất metadata của ảnh gốc.

Các ảnh QA mới nằm ở `artifacts/editor-thin-cell-selection.png`,
`editor-chain-lantern-hanging.png`, `editor-chain-soul_lantern-hanging.png` và
`editor-animated-blocks-frame-{0,3}.png`. Ảnh/playback xác nhận phạm vi fixture,
không phải pixel parity toàn game. Ở cuối đợt 1 BUG-02/04 còn OPEN; xem cập nhật
đợt 2/3 phía dưới để biết trạng thái mới.

Gate mới: **241/241 tests (21 files)**, typecheck/lint/build; native Chrome smoke
production với pack/profile thật đạt, gồm pixel edge/culling, animation idle,
placement/history và các regression resource/editor/export cũ. Production không
chứa JAR/texture/profile game. Browser smoke dùng SwiftShader, chưa đo GPU thật;
Edge local không mở DevTools endpoint nên chọn Chrome có sẵn. Không thêm dependency,
không migrate dữ liệu dự án và chưa commit/push.

## Đợt 2 — Chỉnh state hàng loạt, 30/10/2026

Đã bỏ single-selection gate. `sharedStateFields` tính fields chung từ toàn bộ
cells của các block/multi-block được chọn; khác giá trị hiện Mixed, checkbox
indeterminate có hình ảnh riêng và aria-checked mixed. Cùng ID chỉnh các fields
hợp lệ, ngoại trừ structural part/half. Khác ID vanilla hiện có 6 semantics rõ:
axis, facing, rotation16, waterlogged, half top/bottom, slab-type; chỉ lấy legal
values giao nhau. Field khác chưa có adapter cross-ID bị ẩn, vẫn chỉnh được khi
cùng ID. Không suy ngữ nghĩa chỉ từ label/family/tag; không đổi kiểu block.

Chọn group/component cùng block không tự sửa một phần selection hoặc children:
form nêu scope và không hiện controls. `updateObjectsState` rewrite toàn tập trên
document gốc, validate occupancy cuối cùng, commit atomic qua history hiện có.
Đổi facing của nhiều beds giữ foot làm neo, tạo lại head; young pitcher age có thể
đổi 1↔2 cells qua adapter cũ. Bất kỳ collision/illegal value nào chặn toàn command.
Undo/Redo khôi phục toàn tập; no-op không thêm history hoặc làm mất redo. Các field
khác, ID, pivot và selection giữ nguyên. Chưa mô phỏng neighbor/fluid/physics.

Gate code mới **252/252 test, 22 files**, typecheck/lint/build. Domain regression:
logs/stairs, giao domains, unknown semantics, structural fields, group scope,
hai beds dùng cell vừa giải phóng hoặc va chạm lẫn nhau/vật ngoài, pitcher growth,
giữ data, một Undo/Redo và no-op. **Native Chrome production smoke đạt** với
JAR/profile thật (SwiftShader, không phải GPU FPS benchmark). Browser regression ở
`scripts/state-edit-browser-scenarios.mjs`: actual Shift-select trong outliner,
Mixed/indeterminate, focus không kích G, giữ field khác, collision rollback của
beds, một Undo/Redo, explicit Save/reload. Ảnh `artifacts/editor-batch-states*.png`.
Không thay schema/storage, không thêm dependency; không có game-exact neighbor
claim mới. BUG-02/04 để đợt sau.

## Đợt 3 — Neighbor connections và special models, 30/10/2026

**Cách dùng:** chạy `fnm exec --using 24.19.0 pnpm.cmd prepare:game`, nhập lại
`public/generated/26.2.profile.json` qua Resources → Import game profile. Không
cần xóa project/pack. Profile cũ vẫn đọc được, nhưng cần metadata mới để bật
Auto connections và tint banner. Trong Inspector bật **Auto connections** để
fence/wall/gate tự nối ở các edit tiếp theo; mặc định OFF, không tự rewrite scene
khi bật, không persist lựa chọn sau reload. Tắt để thiết kế state tay.

**BUG-04:** added planner dùng game-extracted per-state sturdy/coverage predicates,
class/tag connection rules và nguồn version/hash có sẵn. Fence nối theo hướng,
khác wood/nether và gate; wall low/tall/up theo cover/post; gate in_wall. Chỉ affected
neighbors, có queue lan xuống wall dưới và work bound; source index cache + sparse
overlay cho hover. Move/rotate/group/component/state edits đều qua cùng commit gate;
ghost và atomic Undo chứa neighbors. Unknown/dynamic geometry giữ explicit state
với reason, không giả full cube; empty document cells là air trong scene, không
cam kết destination world. Chưa có auto-pane/fluid/redstone/support simulation.

**BUG-02:** banner màu nền ở pose tĩnh lấy standing/wall main/flag layers và màu
DyeColor từ game; đúng origin/scale/yaw, tách gỗ/vải. Conduit lấy inactive shell và
texture thật. Ghost cũng dùng special geometry. UI báo Static partial model với
giới hạn; thiếu layer/màu/texture yêu cầu bổ sung đúng dữ liệu, không báo nhầm mọi
model không elements là asset hỏng. Chưa có hoa văn, cloth animation, active conduit
hoặc block-entity payload/export; đây là capability riêng, không đánh accurate toàn bộ.

**Xác thực:** `pnpm check` đạt **262/262 tests, 25 files**, gồm regression cũ và
neighbor/special tests mới. Actual vanilla GameTest world: **521 neighbor fixtures**
trong `artifacts/placement-world-YfDS9L/placement-oracle.json`, expected lấy từ actual
neighbor updates và đọc lại sau 20 tick, so từng state bằng test độc lập với planner.
Gồm all registered fence/wall/gate family defaults, 16 patterns, solid/glass/leaves,
fence khác vật liệu, gate hướng khác nhau, slab/stairs và cover phía trên. Cùng run
giữ 200 placement contexts, 102 survival và 336 lantern cases. Không phải Fabric proof.

Native Chrome production smoke với JAR/profile mới đạt: actual pointer place → ghost
bao gồm hàng xóm → commit, move/delete/group, Undo/Redo; wall tall↔low, policy on/off
không mutate. Banner rotation đổi geometry, banner/wall-banner/conduit không fallback;
đã xem screenshots `artifacts/editor-auto-{fences,walls}.png` và
`resource-special-{black_banner,black_wall_banner,conduit}.png`. SwiftShader xác nhận
chức năng, không GPU FPS/pixel parity Minecraft. Synthetic neighbor CPU preview:
10k cold ~7.4ms/warm p95 ~5.6ms; 100k ~81ms/~28ms, 20 warm samples; chưa phải input
latency và chưa đạt realtime guarantee ở mọi cảnh. Build không game assets; no new deps.

**Chưa thể đóng toàn bộ current issues:** 03/04/06 đã xử lý trong scope; 01/02/05
vẫn PARTIAL theo bảng. Full-strip ảnh gốc cần effective pack/storage/state cụ thể
để tái hiện; không kết luận legacy `.mcmeta` là nguyên nhân. Banner patterns/active
conduit và attachment/fluid ngoài subset cần scope/fixtures riêng. Instance Fabric
của người dùng chưa được xác nhận. Không tự xóa/reimport dữ liệu để che lỗi.

**Thứ tự sau đợt này:** (1) đối chiếu đúng scene/pack gặp full-strip và kiểm tra
những case đã sửa trên Fabric 26.2 của người dùng; (2) recovery/autosave và portable
backup để bảo vệ công trình; (3) duplicate/repeat/dựng vùng và thay vật liệu hợp lệ;
(4) ẩn mái/cắt tầng và thao tác nội thất. Patterns/payload và thêm special renderers
đi theo capability có nhu cầu; không kéo dài đợt bugfix thành mô phỏng toàn Minecraft.

## BUG-07 — Bản làm dở trong Open saved không có cách xóa

**Tiến độ 31/10/2026 — RESOLVED cho workflow document v2 hiện tại:** Documents
thay dropdown Open saved, có search/open/rename/delete theo workspace, metadata
phân biệt cùng tên; Discard changes giữ Saved checkpoint hoặc bỏ bản chưa Save.
New pristine không tạo thêm Saved; Save rỗng chủ động được giữ. Xóa active có
xác nhận gồm unsaved changes, xóa matching preference và reset history; Undo
editing không phục hồi document đã xóa. Xóa không cascade sang component asset.
ID bản làm việc của component mới độc lập với asset, binding thư viện giữ qua
reload để xóa rồi mở lại/sửa component vẫn được. Không migrate records cũ ngầm.

**Đã kiểm:** code gate 262/262 test, typecheck/lint/build; production browser mở/
rename active/inactive, hai bản trùng tên khác ID, cancel, lỗi delete giả lập giữ
row/storage, discard có/không Saved, Untitled có nội dung khi chuyển, Undo/reload,
xóa rồi sửa lại component và publish sau reload. Hai app pages cùng origin kiểm
stale delete bị chặn, peer Save không resurrect ID và giữ local edits. Ảnh
`artifacts/editor-documents.png`, `artifacts/editor-documents-compact.png` (620px).
Native repository còn thử late write/delete và activate đến muộn không phục hồi
preference. Lỗi quota là fault injection, không tuyên bố đã làm đầy disk thật.

**Bổ sung D02/D03:** đã có autosave draft riêng và Documents → Recovery:
Restore/Recover copy/download/discard. New/Open bảo vệ draft, không tự tạo Saved;
Save retire own stream, Delete document retire mọi recovery stream atomic. Các
callback đến muộn không khôi phục bản đã xóa. Recovery có invalidation notification
giữa tab khi hỗ trợ, Saved list dùng Refresh; không có merge tự động.
**Còn ngoài scope:** portable bundle/storage health và D07 acceptance đầy đủ;
recovery thuộc origin, không bảo đảm chống mọi crash/eviction. Tài liệu 03 giữ
thứ tự tiếp theo và giới hạn bằng chứng.

**Người dùng thấy:** dropdown có hai mục Untitled component cùng mục Column;
không tìm thấy nút xóa những bản chưa đưa vào thư viện component/công trình.
Các mục tồn tại gây rối danh sách. Ảnh xác nhận tên trùng và thiếu thao tác quản lý;
không chứng minh các document đó rỗng hoặc không còn giá trị.

**Nguyên nhân ở mốc tiếp nhận (trước sửa):** Open saved liệt kê `session.documents`, lọc workspace; đây là
editor documents đã persist trong store `editorDocuments`, không phải danh sách
`componentAssets`. `New`, `Open`, import JSON và Edit component gọi save-before-
switch; `save` hiện ghi snapshot dù document còn tên mặc định hoặc chưa có nội dung.
Cơ chế này có thể tạo nhiều bản làm dở/placeholder trong Open saved. Khi tiếp nhận
chưa có API/UI xóa document; Remove component chỉ xóa asset thư viện.
Chưa có store autosave/recovery riêng. Không gọi mọi mục Untitled là autosave draft,
và không kết luận tất cả bản trong ảnh được tạo cùng một đường thao tác.

**Đưa vào milestone D — Quản lý dữ liệu và vòng đời bản nháp, trước khi bật autosave:**

1. Phân biệt bản nháp đang làm/recovery, document đã Save thuộc Architecture hoặc
   Component Editor, và component asset đã xuất bản vào thư viện. “Chưa lưu thành
   component” không đồng nghĩa không có document đã persist.
2. Có nơi quản lý gọn bên cạnh Open saved: xem/đổi tên/xóa theo ID, nhận diện các
   bản cùng tên bằng workspace, trạng thái, thời điểm sửa và lượng nội dung. Draft
   không trộn vào danh sách bản Save chính; không cần thêm màn hình mô tả dài.
3. Tách **Bỏ bản nháp** khỏi **Xóa document đã lưu** và **Xóa component thư viện**.
   Bỏ draft có base Saved thì giữ checkpoint đó; xóa document không tự xóa asset
   thư viện, instance đã đặt, document workspace khác hoặc pack/profile.
4. New trên placeholder rỗng chưa sửa không tạo thêm một mục Saved. Draft có thay
   đổi vẫn phải được bảo vệ khi chuyển document; Save chủ động của người dùng phải
   được tôn trọng kể cả document rỗng. Không bỏ bản có nội dung chỉ vì chưa đặt tên.
5. Xóa chỉ cập nhật UI sau transaction thành công; lỗi storage giữ mục và báo gọn.
   Xóa bản đang mở phải xử lý phần sửa chưa lưu, active preference và document kế
   tiếp rõ ràng; không âm thầm lưu lại bản vừa xóa qua save-before-switch.
6. Invalidate generation/epoch của Save/autosave đang chờ, đồng bộ tab khác; delete
   không bị undo edit hoặc recovery làm sống lại. Không tự dọn record cũ theo tên
   Untitled/đếm cell và không đụng dữ liệu hiện có trong phiên ghi nhận này.

**Task và nghiệm thu:** K04 chốt saved/draft/delete identity; D01 cung cấp delete
transaction + stale-write protection; D02/D03 quản lý draft/discard/recovery; D04
làm catalogue và thao tác xóa; D07 kiểm các race. Thử hai bản cùng tên khác ID,
New nhiều lần trên document rỗng, bản Untitled có nội dung, discard giữ bản Saved,
xóa active/inactive document, thư viện component độc lập, reload, Save/autosave
đến muộn, hai tab và storage failure. Mục đã xóa không tự xuất hiện lại.

**Cách xác thực lại:** chạy production `test:browser` với JAR/profile local như
tài liệu 02; suite `documents-browser-scenarios.mjs` dùng profile browser riêng.
Chỉ các records/asset fixtures trong profile cô lập bị sửa/xóa, không dùng storage
hoặc world cá nhân. Giới hạn recovery/portable được giữ rõ ở trên.

## Ghi nhận ban đầu (giữ làm bối cảnh; trạng thái mới nằm ở các đợt sửa phía trên)

## BUG-01 — Lantern và campfire: appearance/animation không đúng

**Người dùng thấy:** lantern và lửa trại hiển thị lạ, nghi animation không hiển thị
hoặc chạy sai. Ảnh cho thấy campfire/soul campfire có nhiều vệt/lớp texture lửa
lặp; lantern/soul lantern có các dải hình lặp bất thường. Ảnh là bằng chứng về
appearance ở một thời điểm, không chứng minh được thời gian/frame animation.

**Đã đối chiếu local:** trong client `public/26.2.jar`:

- `textures/block/campfire_fire.png.mcmeta` và `soul_campfire_fire.png.mcmeta`
  có `animation.frametime = 2`.
- `textures/block/lantern.png.mcmeta` và `soul_lantern.png.mcmeta` có
  `animation.frametime = 8`.
- `Viewport.tsx` hiện có đọc `.png.mcmeta`, tính frame dimensions, `repeat/offset`
  và cập nhật sprite. Vì vậy không kết luận đơn giản là “chưa có animation”.

**Giả thuyết cần phân biệt:** crop frame/sprite grid sai, UV/model sai, texture
transform chưa khớp image-load lifecycle, metadata bị pack override/mất index,
frame đầu hoặc frame loop sai, alpha/depth/z-fighting. Chưa chốt giả thuyết nào.
Không chữa bằng cách tắt animation hoặc sửa texture/model game để che lỗi.

**Tái hiện phiên sau:** vanilla pack duy nhất trước, rồi pack người dùng đang bật;
ghi ID/state và pack/profile hashes. Đặt hai loại lantern và hai campfire, thử
lit/unlit, hanging/standing khi state cho phép; chụp cận nhiều góc và ghi video
ngắn hoặc snapshots có timestamp qua nhiều frame. So Assets preview với editor.
Inspect image dimensions, effective `.mcmeta`, UV và crop frame thực trên GPU.

**Nghiệm thu:** một sprite frame hợp lệ tại mỗi thời điểm, nhịp/thứ tự theo
metadata; không lặp toàn strip hoặc biến dạng model. Lit/unlit đúng, đổi pack/
reload/state không để animation cũ tác động texture mới; static scene ngừng render
khi không còn animation đang dùng. Có regression cho sprite dimensions/timing
và browser appearance, không chỉ assert rằng callback đã chạy.

**Source cần đọc:** `src/viewport/Viewport.tsx` (`texture`, `render`, materials),
`src/render/texture-image.ts`, `models.ts`, `block-mesh.ts`, import index `.mcmeta`.

## BUG-02 — Banner/conduit: thiếu renderer, thông báo chưa đúng ngữ cảnh

**Thông báo người dùng cung cấp, cần giữ làm fixture:**

```text
Appearance details · 2
minecraft:black_banner: Model không có elements: minecraft:block/banner
minecraft:conduit: Model không có elements: minecraft:block/conduit
```

**Đã đối chiếu local:** `models/block/banner.json` và `conduit.json` trong JAR
26.2 chỉ chứa particle texture, không có `elements`. `bakeBlock` hiện ném lỗi
cho model không có elements khi không có đường xử lý riêng. Đây phù hợp với
việc công cụ thiếu đường render đặc thù; chưa phải bằng chứng file tài nguyên hỏng.
Phải xác nhận renderer thực và state/payload cần thiết bằng runtime 26.2 trước sửa.

**Phạm vi cần chia:**

- Banner: model/texture cơ bản, standing/wall, orientation; patterns/payload và
  animation vải là capability riêng, không mặc định có đủ chỉ vì hiện nền vải.
- Conduit: hình dạng/trạng thái render theo điều kiện game; đừng giả active/inactive
  chỉ từ một texture hoặc một state chưa có dữ liệu world.
- “Block chức năng khác” là phạm vi audit, chưa phải danh sách đã phát hiện lỗi.
  Duyệt palette được dùng, ghi ID/renderer missing thay vì tuyên bố mọi loại đều hỏng.

**Nghiệm thu:** loại có adapter hiện đúng phạm vi đã công bố; loại chưa hỗ trợ có
fallback chọn được và reason dạng “chưa hỗ trợ renderer …”, không quy lỗi chung
“model hỏng”. Không thêm cube giả rồi đánh dấu accurate. Render capability tách
payload editing và export capability; export vẫn chặn data chưa hỗ trợ.

**Source:** `src/render/models.ts`, `block-mesh.ts`, `entities.ts` và special-binding
routing trong `Viewport.tsx`. Không ép banner/conduit vào static living-entity
renderer chỉ vì cả hai cùng không dùng block elements thông thường.

## BUG-03 — Multi-selection cần chỉnh blockstate chung

**Người dùng mong muốn:** chọn nhiều block cùng loại để đổi state một lần; khi
chọn khác loại, Inspector chỉ hiện các điều chỉnh thực sự áp dụng chung, tránh loạn.

**Đối chiếu source ban đầu, trước đợt 2:** UI Block state từng bị giới hạn bởi
`slot.selection.length === 1`; chưa có batch state command. Đây là thiếu workflow
hiện tại, không phải các block được chọn không có state hợp lệ.

**Ngữ nghĩa đề xuất cần chốt:**

1. Cùng loại: hiển thị properties chung; cùng giá trị thì hiện giá trị đó, khác
   giá trị thì hiện **Mixed**, không lấy giá trị active object làm toàn bộ selection.
2. Khác loại: lấy giao properties, giao legal values **và khả năng chỉnh tương
   thích qua adapter**, không chỉ cùng tên `facing/half`. Nếu không có lựa chọn
   chung, thông báo gọn; không áp đổi kiểu block ngoài ý muốn.
3. Chọn giá trị mới chỉ sửa property đó trên toàn tập eligible đã công bố. Không
   đổi các field khác, không âm thầm bỏ các object không sửa được.
4. Multi-block sửa qua logical adapter, giữ pair; `part`/`upper-lower` không mở
   như property độc lập. `half` trên stairs khác `half` của door/tall plant.
5. Group/component trong selection cần scope rõ: mặc định không flatten để sửa
   child ngầm. Chưa có scope adapter thì báo không áp dụng; batch theo children
   hoặc linked sources là quyết định riêng.
6. Lập preview/validation cả batch; đổi facing của bed có thể thay footprint,
   nên kiểm collision toàn document. Một failure chặn cả batch mặc định, một Undo
   khôi phục mọi object; không commit từng object và để trạng thái dở dang.

**Nghiệm thu:** nhiều log đổi axis; nhiều stairs đổi facing/half; cùng loại khác
giá trị hiện Mixed; selection khác loại không có property chung; mixed checkbox
có indeterminate; hai beds đổi facing có kiểm collision/pair. Cancel/failure/Undo
không làm mất field khác. Có pointer/keyboard/focus/browser regression.

**Source:** `EditorWorkbench.tsx` (`StateFields`, selection Inspector),
`src/editor/operations.ts`, `placement.ts`, `history.ts`, `useEditorSession.ts`.

## BUG-04 — Fence/wall cần tự tính liên kết hàng xóm

**Hiện tại:** người dùng phải sửa các field liên kết theo hướng bằng tay; mong
muốn công cụ tự liên kết như khi xây trong game. Đây là thiếu bounded neighbor
updates trong editor, không phải chỉ thiếu một nút Inspector.

**Phân tích phạm vi:** fence connection, wall low/tall/up và pane không phải một
quy tắc chung “có block kế bên thì nối”. Adapter phải đối chiếu family/state,
hướng, block neighbor và điều kiện liên quan của đúng 26.2. Destination không có
trong document là unknown/scene boundary theo policy, không tự là world air.

**Đề xuất:** chế độ auto-neighbor rõ ràng cho workflow dựng thông thường; Design
vẫn cho giữ explicit state để thiết kế đặc biệt. Chốt default/opt-in trong phiên
triển khai, không âm thầm overwrite state cũ. Recompute sau đặt/xóa/move/rotate/
batch state/material change, trên affected neighborhood có giới hạn. Ghost và
commit dùng cùng patch set; Undo gồm cả neighbors bị thay state.

**Nghiệm thu:** thêm rồi xóa hàng xóm, góc/chữ T/giao bốn hướng, khác vật liệu,
block đặc/mảnh/cổng, neighbor phía trên nếu rule yêu cầu, rotate/group/component
và Undo/Redo. Có oracle world dương/âm/biên và policy rõ; không viết mô phỏng
fluid/redstone/tick toàn game để giải quyết kết nối kiến trúc.

## BUG-05 — Chain và lantern: chọn đúng mặt/ô/state khi đặt

**Người dùng báo:** chain đặt được nhưng không đặt đèn treo vào vị trí mong muốn;
có cảm giác đèn chồng/đè lên chain. Cần ghi đúng ID chain và lantern trong Inspector,
không đoán ID từ tên gọi/texture; các block mảnh tương tự chỉ là phạm vi mở rộng.

**Đã đọc source:** `Viewport.hit()` raycast vào render meshes, lấy normal triangle,
quy về trục trội rồi tính `adjacent = clickedCell + face`. Context adapters hiện
chưa có nhánh lantern hanging chuyên biệt. Cả hai là **điểm cần kiểm tra**, chưa
chứng minh riêng một điểm là nguyên nhân lỗi này.

**Cần phân biệt:**

- Click vùng trống của chain có thể đi xuyên đến grid/block phía sau.
- Mặt của model mảnh/chéo không luôn thể hiện mặt đặt của cell theo ý người dùng.
- Preview có thể đúng cell nhưng `hanging` vẫn là giá trị palette; cần xác định
  trường hợp này trước khi quy thành lỗi tọa độ/va chạm.
- Render bị chồng, cell collision thật và state treo sai là ba loại lỗi khác nhau.
  Đèn ở cell bên dưới chain không có nghĩa hai model phải chạm nhau ở mọi state.

**Tái hiện:** chain các axis được registry cho phép, lantern/soul lantern đứng/
treo, view trực giao và phối cảnh, click từ dưới/bên/trên và các khoảng zoom.
Ghi clicked owner/cell, ray point/normal, target cell, resolved state, occupied
cells, ghost và committed cells. Đối chiếu cùng thao tác trong vanilla 26.2 bằng
BlockPlaceContext/support fixtures; chưa có oracle thì không cam kết chain luôn
là support hợp lệ cho mọi trạng thái đèn.

**Nghiệm thu:** đúng target cell và hanging state cho case game xác nhận; preview
khớp commit, không overwrite occupied cell, không click nhầm grid âm thầm. Trường
hợp không hỗ trợ có lý do, không chỉ “không đặt được”. Thử đặt/xóa chain/đèn và
Undo/Redo; kết quả model,state,footprint và world readback được kiểm riêng.

## BUG-06 — Selection cho block mảnh/nhỏ phải dễ và nhất quán

**Hiện tượng:** phải click trúng model/texture rất nhỏ mới chọn được; trải nghiệm
khó hơn mong đợi. Render mesh raycast đang dùng làm nền cho cả chọn và placement.

**Không đồng nhất bốn loại hình/vùng:**

| Khái niệm | Vai trò |
| --- | --- |
| Occupied cell | Lưới integer, ownership/collision của document. |
| Render mesh và alpha texture | Hình nhìn thấy; có thể mảnh/chéo/trong suốt. |
| Selection/outline shape | Vùng tương tác để hover/chọn, cần policy thân thiện và có thể khác render mesh. |
| Game collision/support shape | Quy tắc vật lý/đỡ/placement của game; không suy từ render hoặc tự gán full cube. |

**Hướng cải thiện để thử, chưa chốt thuật toán:** selection proxy/outline theo
capability hoặc tolerance screen-space giới hạn; fallback occupied cell cho loại
thiếu shape, có nhãn rõ. Luôn ưu tiên ứng viên gần/nhìn thấy theo policy, không
để proxy full-cell nuốt block phía sau ngoài dự kiến. Nếu overlap cần deterministic
priority/cycle lựa chọn hoặc outliner fallback. Alpha-aware picking là lựa chọn
riêng, không mặc định cứ trong suốt thì click xuyên hay cứ full cell thì chọn.

Selection dễ click **không** được sửa placement target bằng một tolerance tùy ý:
chọn object và xác định mặt đặt có thể cần hai chính sách. Cùng một service hit
query có thể trả cả semantic target và visual hit, nhưng contract phải rõ.

**Nghiệm thu:** chain/lantern, fence/pane, plant/banner mảnh và cube đặc, nhìn gần/
xa, orthographic/perspective, model fallback. Hover đúng owner trước click, Shift
multi-select ổn định; không chọn hidden/locked/occluded trái policy, không vô tình
đặt đè object vì selection proxy. Đo picking ở scene lớn trước chọn DDA/GPU picking;
không sửa bằng cách tăng kích thước model thật.

## Cách mở phiên sửa lỗi tiếp theo

1. Tạo reproduction scene nhỏ từ phản ánh, ghi version/profile/pack-order/hash,
   state, camera và bước click. Ảnh hiện tại nằm trong cuộc trò chuyện; **chưa có
   file ảnh nguồn được lưu vào repo**. Khi test, ghi ảnh/video mới vào `artifacts/`.
2. Triage BUG-01 riêng với BUG-02; xem BUG-05 và BUG-06 cùng semantic-hit contract
   nhưng tách selection policy khỏi placement. BUG-03 domain batch và UI Mixed
   có thể làm riêng; BUG-04 family oracle trước adapter.
3. Ưu tiên phục hồi thao tác cơ bản và appearance sai rõ: 01 + 05/06; 03 song
   song ở domain/UI riêng; 02 và 04 chia theo capability/family sau fixtures.
   Đây là đề xuất theo ảnh hưởng, không ghi rằng mọi bug đều “nhỏ” hoặc cùng chi phí.
4. Một owner giữ `Viewport.tsx` cho BUG-01/05/06 integration; một owner giữ
   Workbench/session cho BUG-03; renderer đặc thù/oracle/planner có module/tests
   riêng. Không giao ba agent cùng sửa picking/texture/controller một lúc.
5. Trước sửa chốt acceptance ở từng mục. Sau sửa ghi root cause thực, files/tests,
   browser/game evidence, trạng thái RESOLVED hoặc PARTIAL, phần chưa hỗ trợ.
   Cập nhật capability/roadmap tương ứng; không đánh done chỉ vì cảnh báo biến mất.

Không tăng số task đã hoàn thành, không thay bằng chứng cũ hoặc tự triển khai
toàn bộ backlog chỉ từ tài liệu này. User observations là đầu vào cần giữ; giả
thuyết chỉ được nâng thành root cause sau reproduction và đối chiếu phù hợp.
