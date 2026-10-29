# Kiểm toán upstream: cezar → Onni Work

- **Ngày:** 2026-10-29
- **Phạm vi:** toàn bộ repo `D:\Multi Agent` (bỏ qua `node_modules`, `target`, `dist`)
- **Trạng thái:** Phase 1 (kiểm kê) đã xong; **Phase 2 đã thực thi** — xem §10 để biết nhật ký,
  cờ cấu hình, kết quả kiểm chứng và danh sách link còn lại (Deferred)
- **Mục tiêu:** (A) tuân thủ MIT và ghi công đúng; (B) cắt mọi đường dẫn tới hạ tầng cezar để app không tự cập nhật về bản gốc, không gửi dữ liệu tới họ, không vô tình publish dưới tên package của họ.

> Ràng buộc đang giữ nguyên: **chưa đổi tên nội bộ** (`cez`, `.ai/cezar`, `~/.cezar`, `CEZ_*`, scope `@open-mercato/*`). Việc rename là bước sau, nên báo cáo này **không** tính các import `@open-mercato/*` là link cần cắt ở Phase 2.

---

## 0. Kết luận nhanh

| # | Nhóm | Phát hiện | Mức độ |
|---|------|-----------|--------|
| 1 | UPDATE | Desktop shell tự tải và cài `@open-mercato/cezar` từ npm khi khởi động/khôi phục, **độc lập** với Tauri updater | **Cao** |
| 2 | UPDATE | Tauri updater trỏ thẳng vào release feed `github.com/open-mercato/cezar`, kèm pubkey của upstream | **Cao** |
| 3 | UPDATE | CLI `cezar install/update/versions/use` cài `@open-mercato/cezar` từ `registry.npmjs.org` | **Cao** |
| 4 | PUBLISH | `packages/cezar` bật `publishConfig.access = public`; 6 workflow phát hành/publish còn nguyên | **Cao** |
| 5 | PUBLISH | Hai package alias `cezar-cli`, `cezar-run` (unscoped, public) phụ thuộc package upstream | Trung bình |
| 6 | TELEMETRY | Endpoint upstream `https://stats.openmercato.cloud` trong server và desktop (hiện **opt-in**, mặc định không gửi) | Trung bình |
| 7 | NETWORK-OTHER | Star-count gọi `api.github.com/repos/open-mercato/cezar` **mặc định bật** | Trung bình |
| 8 | NETWORK-OTHER | Team skills mặc định `open-mercato/skills`, tự cập nhật **mặc định bật** | Trung bình |
| 9 | DOC-BRANDING | README zh, CHANGELOG (95 link PR upstream), docs site, branding "cezar/Cezar" | Thấp |

Không có `NOTICE`/`THIRD-PARTY` nào trong repo. Giấy phép MIT gốc vẫn còn nguyên và **phải giữ**.

---

## 1. Giấy phép & ghi công

### 1.1 Hiện trạng

| Tệp | Nội dung | Ghi chú |
|-----|----------|---------|
| `LICENSE:3` | `Copyright (c) 2026 Patryk Lewczuk` | MIT đầy đủ, không sửa |
| `packages/cezar/LICENSE` | Bản sao y hệt, cùng dòng copyright | Đi kèm package publishable |
| `NOTICE`, `THIRD-PARTY`, `COPYING` | **Không tồn tại** | — |

Không có tệp license riêng cho font/icon; các asset thương hiệu nằm trong `packages/web/public/` và `packages/desktop/src-tauri/icons/` không kèm giấy phép riêng.

### 1.2 Nghĩa vụ của MIT

MIT bắt buộc giữ **copyright notice + permission notice** trong mọi bản copy hoặc phần lớn của phần mềm. Vì vậy:

- **Bắt buộc:** giữ nguyên `LICENSE` (kể cả dòng của Patryk Lewczuk) trong repo và trong mọi bản phân phối (tarball npm, installer desktop, source).
- **Được phép:** thêm một dòng copyright của chủ sở hữu mới **bên dưới** dòng gốc, không xoá/sửa dòng gốc. Đây là cách cộng gộp copyright thông thường cho tác phẩm phái sinh.
- **Nên làm:** thêm `NOTICE` (hoặc mục "Credits" trong README) ghi rõ: dự án dựa trên cezar của Patryk Lewczuk, giấy phép MIT, kèm URL upstream. MIT không bắt buộc, nhưng đây là cách ghi công rõ ràng và giảm rủi ro hiểu nhầm.
- **Không bắt buộc:** hiển thị attribution trong UI. Tuy nhiên nếu muốn minh bạch, có thể thêm dòng "Based on cezar" ở About/Settings.

### 1.3 Câu hỏi chặn Phase 2

Cần **tên đầy đủ** để ghi dòng `Copyright (c) 2026 <TÊN>` (theo đúng brief). Chưa có tên này thì không nên tự đoán.

---

## 2. Manifest & metadata

### 2.1 Bảng tổng hợp

| Manifest | `name` / version | `license` | `private` | `publishConfig` | `repository` | Ghi chú |
|----------|------------------|-----------|-----------|-----------------|--------------|---------|
| `package.json` (root) | `cezar-monorepo` | MIT | ✅ | — | `github.com/open-mercato/cezar` | Không publish |
| `packages/cezar/package.json` | `@open-mercato/cezar` 0.17.0 | MIT | ❌ | `access: public` (:73-75) | upstream, `directory: packages/cezar` | **Có thể `npm publish` nếu có token scope** |
| `packages/contract/package.json` | `@open-mercato/cezar-contract` 0.17.0 | MIT | ✅ | — | — | Private, được inline lúc build |
| `packages/api-client/package.json` | `@open-mercato/cezar-api-client` 0.17.0 | MIT | ✅ | `access: public` (:36-38) | upstream, `directory: web/api-client` (:31-35) | **Mâu thuẫn** private + publishConfig; `directory` đã lỗi thời |
| `packages/web/package.json` | `@open-mercato/cezar-web` 0.17.0 | MIT | ✅ | — | — | — |
| `packages/desktop/package.json` | `@open-mercato/cezar-desktop` 0.1.11 | **thiếu** | ✅ | — | — | Không phải npm workspace |
| `docs/site/package.json` | `@open-mercato/cezar-docs` 0.0.0 | **thiếu** | ✅ | — | — | Next.js, không phải workspace |
| `alias-cezar/package.json` | `cezar-cli` 0.17.0 | MIT | ❌ | `access: public` (:16-18) | — | **Unscoped, ai cũng publish được**; phụ thuộc `@open-mercato/cezar` |
| `alias-cezar-run/package.json` | `cezar-run` 0.17.0 | MIT | ❌ | `access: public` (:13-15) | — | Như trên |
| `packages/desktop/src-tauri/Cargo.toml` | `cezar-desktop` 0.1.11 | **thiếu** | `publish = false` (:6) | — | — | Description "Desktop shell for cezar (PoC)" (:4) |
| `packages/desktop/src-tauri/tauri.conf.json` | `productName: "Cezar"` (:3), `identifier: com.openmercato.cezar` (:5) | — | — | — | — | Đổi identifier = đổi định danh app (xem §3) |

### 2.2 Vấn đề metadata

1. **`packages/cezar` thiếu `"private": true`** — đây là package duy nhất có thể publish thật. `publishConfig.access = public` là di sản upstream.
2. **`api-client` vừa `private: true` vừa `publishConfig.public`** — cấu hình tự mâu thuẫn, và `repository.directory` trỏ `web/api-client` (đường dẫn cũ, không còn tồn tại).
3. **Mọi `repository` trỏ upstream** — kể cả root. Không có `author`, `homepage`, `bugs`.
4. **Desktop/docs thiếu `license`** — nếu phân phối installer/tarball, nên có để metadata nhất quán. `Cargo.toml` cũng thiếu `license` và `repository`.
5. **Alias packages nằm ngoài `workspaces`** — `npm publish` ở root không đụng tới chúng, nhưng chúng vẫn là bề mặt publish có thể bị dùng thủ công.
6. **`sync-readme.mjs`** (prebuild của `packages/cezar`) copy `README.md` root vào package. README hiện **rỗng**, nên nếu ai publish sẽ đăng trang npm trống — thêm một lý do phải chặn publish.

---

## 3. Bề mặt thương hiệu (DOC-BRANDING)

Các tệp hiển thị tên/thương hiệu cezar, **chưa cần sửa ở Phase 2** trừ khi được duyệt; đây là inventory để quyết định rebrand sau.

### 3.1 Trong sản phẩm

| Tệp:dòng | Giá trị |
|----------|---------|
| `packages/web/index.html:14` | `<title>cezar</title>` |
| `packages/web/src/components/brand-mark.tsx:4,54` | default name `'cezar'`, logo lowercase |
| `packages/desktop/ui/index.html:7` | `<title>Cezar</title>` (splash) |
| `packages/desktop/src-tauri/src/lib.rs:257` | cửa sổ `.title("Cezar")` |
| `packages/desktop/src-tauri/src/lib.rs:336,342` | menu "Update cezar to latest…", mục "Cezar" |
| `packages/desktop/src-tauri/src/lib.rs:389,393` | tray "Open Cezar", tooltip "Cezar" |
| `packages/cezar/src/index.ts:62` | `cezar — local cockpit for AI agent tasks in your repo` |
| `packages/desktop/src-tauri/tauri.conf.json:3,5` | `productName "Cezar"`, `com.openmercato.cezar` |
| `packages/desktop/src-tauri/Cargo.toml:2,4` | crate `cezar-desktop`, description cezar |
| `packages/desktop/arch/PKGBUILD:10,15` | `pkgname=cezar-desktop-bin`, `url=github.com/open-mercato/cezar` |

Asset: `packages/web/public/icon.svg` + favicon, `packages/desktop/src-tauri/icons/*`, mark trong `brand-mark.tsx` (polygon của logo upstream). Đổi logo/icon là việc thiết kế, ngoài phạm vi sửa link.

### 3.2 Tài liệu & lịch sử

| Tệp | Số tham chiếu upstream | Ghi chú |
|-----|------------------------|---------|
| `README.zh-CN.md`, `README.zh-TW.md` | 15 mỗi tệp | Badge npm `@open-mercato/cezar`, `cezar.run`, `openmercatocloud.com/247agentic-cear` — nội dung marketing upstream |
| `CHANGELOG.md` | 95 link PR `github.com/open-mercato/cezar` | Lịch sử phát hành upstream |
| `docs/site/` | appName `Cezar`, `gitConfig {open-mercato, cezar}`, link `cezar.run` | Docs site Next.js/Fumadocs |
| `docs/reference.md`, `docs/publishing.md`, `docs/telemetry.md`, `docs/server-install/*` | nhiều | Tài liệu vận hành upstream |
| `AGENTS.md` (5), `BACKWARD_COMPATIBILITY.md` (6) | link/spec upstream | Hướng dẫn nội bộ, không user-facing |
| `.ai/specs/` + `.ai/runs/` | 302 refs / 684 files | Hồ sơ thiết kế lịch sử |
| `docs/project-overview.md` | 6 refs | Tài liệu do phiên này tạo, untracked |

---

## 4. Phân loại link theo nhóm

### 4.1 UPDATE — cơ chế tự cập nhật (mức Cao)

#### (a) Desktop shell cài package từ npm — **vector chính, dễ bị bỏ sót**

| Tệp:dòng | Hành vi |
|----------|---------|
| `packages/desktop/src-tauri/src/lib.rs:53` | `const PACKAGE: &str = "@open-mercato/cezar"` |
| `lib.rs:587-612` | `check_cezar_update` + `channel_latest` chạy `npm view @open-mercato/cezar@<tag> version` |
| `lib.rs:1092-1100` | `update_cezar_if_newer` — **mỗi lần restart**, nếu npm có bản mới hơn bản đang chạy thì cài và chạy bản upstream |
| `lib.rs:1205-1237` | `update_cezar` chạy `npm install --prefix <staging> @open-mercato/cezar@<tag>` |
| `lib.rs:1673` | `npm_install` thực thi lệnh npm |
| `lib.rs:336` | menu tray "Update cezar to latest…" |

Hệ quả: dù có xoá Tauri updater, desktop **vẫn** tải code upstream từ npm ở lần chạy đầu (khi `~/.cezar/versions` trống) và ở mỗi lần restart nếu có bản mới. Đây là lý do phải xử lý cả đường npm-install, không chỉ `tauri.conf.json`.

#### (b) Tauri updater plugin

| Tệp:dòng | Giá trị |
|----------|---------|
| `tauri.conf.json:18` | `pubkey` minisign **của upstream** (chỉ artifact ký bằng private key của upstream mới cài được) |
| `tauri.conf.json:19-21` | endpoint `https://github.com/open-mercato/cezar/releases/download/desktop-latest/desktop-latest.json` |
| `Cargo.toml:20` | `tauri-plugin-updater = "2"` |
| `lib.rs:1080-1085` | `updater.check()` rồi `download_and_install` trước khi restart |

Hệ quả: app desktop đang chạy sẽ tự nâng cấp lên bản cezar desktop do upstream phát hành. Không có endpoint mới thay thế — Phase 2 chỉ được **vô hiệu hoá**, không tự bịa endpoint.

#### (c) CLI self-update

| Tệp:dòng | Hành vi |
|----------|---------|
| `packages/cezar/src/self-update/layout.ts:30` | `PACKAGE_NAME = '@open-mercato/cezar'` |
| `self-update/registry.ts:12` | `REGISTRY = 'https://registry.npmjs.org'` |
| `self-update/installer.ts:55,98` | `npm install --prefix <staging> @open-mercato/cezar@<version>` |
| `self-update/cli.ts` | in dist-tags/versions từ registry |
| `src/index.ts:80-84` | help quảng bá `install`, `update`, `versions`, `use` |
| `scripts/install-as-command.mjs:9,72` | uninstall chạy `npm rm --global @open-mercato/cezar` |

Ngoài ra `cezar link` trỏ vào checkout local (hành vi dev, không gọi upstream), nhưng cùng cụm lệnh.

### 4.2 TELEMETRY (mức Trung bình — hiện opt-in)

| Tệp:dòng | Vai trò |
|----------|---------|
| `packages/cezar/src/telemetry.ts:29` | `DEFAULT_TELEMETRY_URL = 'https://stats.openmercato.cloud'` |
| `telemetry.ts:31,33` | `TELEMETRY_POLICY_VERSION = 1`, dev service ID upstream |
| `telemetry.ts` (`CEZ_TELEMETRY_URL`) | cho phép override endpoint |
| `packages/cezar/src/server/server.ts:7954-7985` | route `/api/v1/telemetry/{consent,page,event,error}` |
| `packages/desktop/src-tauri/src/telemetry.rs:16` | `DEFAULT_URL = "https://stats.openmercato.cloud"` |
| `telemetry.rs:170` | `POST {base}/track/error` |
| `telemetry.rs:19,24` | policy version + service ID upstream |
| `.env.example:337-338` | tài liệu hoá endpoint mặc định |
| `docs/telemetry.md:137` | mô tả endpoint |
| `packages/web/src/components/telemetry-consent.test.tsx:17` | fixture endpoint upstream |

Trạng thái thực tế: **opt-in** — không gửi gì cho tới khi người dùng đồng ý (consent bar/Settings/`cezar telemetry enable`), `CEZ_TELEMETRY=0`/`DO_NOT_TRACK=1` chặn cả khi đã đồng ý; nút "Send error report" ở trang lỗi desktop là consent cho từng báo cáo. Rủi ro không phải "gửi ngầm" mà là **dữ liệu đi vào hạ tầng upstream** khi người dùng đồng ý.

### 4.3 PUBLISH — bề mặt phát hành (mức Cao)

| Bề mặt | Chi tiết |
|--------|----------|
| `packages/cezar/package.json:73-75` | `publishConfig: { access: public }` |
| `packages/api-client/package.json:36-38` | `publishConfig` dù `private: true` |
| `alias-cezar`, `alias-cezar-run` | package unscoped, `publishConfig public`, phụ thuộc `@open-mercato/cezar` |
| `.github/workflows/ci.yml:154-176` | job publish snapshot lên `registry.npmjs.org` (NPM_TOKEN) |
| `.github/workflows/nightly.yml:40` | guard `github.repository == 'open-mercato/cezar'`; :84 publish nightly |
| `.github/workflows/release.yml:49` | workflow_dispatch, publish npm |
| `.github/workflows/release-publish.yml:42` | chạy khi tag `v*`, publish npm |
| `.github/workflows/release-cut.yml` | cắt release line |
| `.github/workflows/desktop-release.yml` | chạy khi tag `desktop-v*`/dispatch; build + rolling release `desktop-latest` (:204,379-464) |
| `.github/workflows/backport.yml` | push main + cron, mở PR cherry-pick |
| `.github/workflows/npm-preview-cleanup.yml:36` | dọn preview versions trên npm |
| `scripts/release.mts`, `release-line.mts`, `release-snapshot.mjs` | công cụ release local |
| `packages/desktop/arch/PKGBUILD` | đóng gói Arch, `url` upstream |

Điểm cần nhấn:

- `@open-mercato/cezar` chỉ publish được nếu token có quyền với scope `@open-mercato` (thuộc upstream). Nhưng để nguyên `publishConfig` + workflow là **bẫy**: workflow sẽ chạy, fail giữa chừng, hoặc tệ hơn là publish nhầm nếu token của ai đó có quyền.
- Hai alias `cezar-cli`/`cezar-run` là tên **unscoped** — bất kỳ ai cũng có thể publish, và chúng kéo code upstream về máy người dùng. Nên xoá hoặc đặt `private: true`.
- `npm-preview-cleanup.yml` và `backport.yml` phụ thuộc mô hình release-line của upstream; trên fork chúng vô nghĩa.

### 4.4 NETWORK-OTHER — gọi mạng khác (mức Trung bình)

| Tệp:dòng | Hành vi | Mặc định | Đề xuất |
|----------|---------|----------|---------|
| `packages/cezar/src/server/star-count.ts:28-30` | gọi `api.github.com/repos/open-mercato/cezar`, TTL 10 s | **Bật** | Xem §6.4 |
| `packages/cezar/src/server/server.ts:3457` | route `GET /api/v1/star-count` | Bật | Cùng quyết định |
| `packages/web/src/lib/star-promo.ts:14` | `CEZAR_REPO_URL = github.com/open-mercato/cezar` | — | Cùng quyết định |
| `packages/web/src/components/app-shell.tsx:886`, `star-promo.tsx:234` | link ⭐ tới repo upstream | — | Cùng quyết định |
| `packages/cezar/src/skills-banner.ts:55` | dòng banner "star helps others find it" | Bật khi serve | Xoá cùng star feature |
| `packages/cezar/src/config.ts:22-24,37` | `DEFAULT_SKILLS_REPOS = [{ repo: 'open-mercato/skills' }]` | **Bật** | Đặt `[]` |
| `packages/cezar/src/skills-banner.ts:22,25` | quảng bá `npx skills add open-mercato/skills` | Bật | Xoá |
| `packages/cezar/src/skills-remote.ts:116` | dựng `https://github.com/<owner>/<name>.git` từ shorthand | Chỉ khi có repo cấu hình | Giữ (generic) |
| `packages/cezar/src/self-update/pulls.ts:86` | `api.github.com/repos/<repo>/pulls` | Thuộc luồng self-update | Chết theo B-UPDATE |
| `packages/cezar/src/automations/github-poller.ts:177-180` | GitHub API cho automations | Chỉ khi bật automation | Giữ (generic, người dùng chủ động) |
| `packages/cezar/src/git-remotes.ts` (fork-parent lookup) | `gh api repos/<origin>` khi có remote thứ hai | Bật, nhưng chỉ với repo GitHub của người dùng, dùng `gh` auth của họ | Giữ (không phải hạ tầng upstream) |
| `packages/desktop/src-tauri/src/node_runtime.rs` | tải Node LTS từ `nodejs.org` | Khi máy chưa có Node | Giữ (dependency chung) |
| `packages/desktop/src-tauri/src/lib.rs:1870` | `http_get(port, "/api/v1/runs")` | Loopback | Giữ |
| `docs/site/lib/shared.ts:10-13` | `gitConfig` sinh link "Edit page" trỏ upstream | — | Sửa hoặc xoá docs site |

**Auto skill updates:** theo `AGENTS.md`, tính năng cập nhật skills từ repo mặc định đang **default-on**. Khi `DEFAULT_SKILLS_REPOS` rỗng, luồng này phải trở thành no-op — cần kiểm tra test tương ứng ở Phase 2.

### 4.5 DOC-BRANDING / DOC links

- **README.zh-CN.md / README.zh-TW.md**: marketing upstream đầy đủ (badge npm `@open-mercato/cezar`, `cezar.run`, chiến dịch `openmercatocloud.com/247agentic-cear`). Đề xuất: **xoá**.
- **CHANGELOG.md**: 95 link PR upstream. Không bắt buộc bởi MIT. Lựa chọn: xoá, hoặc giữ làm "lịch sử upstream" với header ghi rõ nguồn.
- **docs/site/**: toàn bộ docs upstream; `appName`, title template, nav `cezar.run`, `gitConfig` upstream. Lựa chọn: xoá cả site, hoặc rebrand (việc lớn).
- **docs/*.md**: `publishing.md`, `reference.md`, `telemetry.md`, `server-install/*` mô tả quy trình upstream. Cần sửa hoặc xoá theo quyết định về docs.
- **AGENTS.md / BACKWARD_COMPATIBILITY.md**: quy tắc nội bộ, có nhắc upstream; không user-facing.
- **`.ai/specs` + `.ai/runs`**: hồ sơ thiết kế lịch sử (684 files, 302 refs). Giữ để truy vết hay xoá để sạch repo — cần quyết định.
- **`docs/project-overview.md`**: tài liệu tổng quan do phiên này tạo (untracked), có 6 refs upstream; sẽ cập nhật theo kết quả Phase 2.

---

## 5. Số liệu grep (tại thời điểm kiểm toán)

| Pattern | Số lần | Số tệp | Diễn giải |
|---------|--------|--------|-----------|
| `open-mercato` | 1614 | 796 | Toàn bộ tham chiếu, gồm lịch sử và scope package |
| `@open-mercato/` | 933 | 647 | Hầu hết là **import package nội bộ** (`@open-mercato/cezar-contract`…) — **được miễn trừ** bởi ràng buộc chưa rename |
| `github.com/open-mercato` | 446 | 130 | Link GitHub thật; tập trung ở CHANGELOG (95) và `.ai/runs` |
| `stats.openmercato.cloud` | 6 | 5 | 2 là comment trong `.env.example`; còn lại code/docs/test |
| `cezar.run` | 5 (non-history) | — | README zh ×4 dòng, `docs/site/lib/layout.shared.tsx:25`, `CHANGELOG.md:384` |
| `api.github.com` | 18 | — | Chỉ `star-count.ts:30` là repo upstream; còn lại generic/tests |
| `npmjs.com/package/@open-mercato` | 2 | 2 | Chỉ trong README zh |
| `openmercatocloud.com` | 2 | 2 | Chỉ trong README zh (:43) |
| `desktop-latest` | >10 | — | Workflow desktop-release + `tauri.conf.json` |

**Hệ quả cho tiêu chí "grep về 0":** sau Phase 2, grep **không thể** về 0 nếu vẫn giữ:
- 933 refs `@open-mercato/*` (ràng buộc chưa rename),
- `.ai/specs` + `.ai/runs` (nếu giữ),
- `CHANGELOG.md` (nếu giữ).

Mục tiêu đúng nên là: **0 link chức năng gọi ra hạ tầng upstream** (UPDATE/TELEMETRY/PUBLISH/NETWORK-OTHER), và các ref còn lại chỉ là tên package nội bộ/lịch sử có chủ đích.

---

## 6. Đề xuất Phase 2 (chia nhóm commit)

### 6.1 Nhóm A — License & attribution

1. Giữ nguyên `LICENSE` và `packages/cezar/LICENSE`; thêm **một dòng** `Copyright (c) 2026 <TÊN ĐẦY ĐỦ>` ngay dưới dòng gốc.
2. Thêm `NOTICE` (hoặc `CREDITS.md`) ghi công cezar/Patryk Lewczuk + MIT + URL upstream.
3. Viết `README.md` mới cho Onni Work: mô tả sản phẩm, cách chạy, mục "Nguồn gốc & giấy phép" trỏ tới `NOTICE`/upstream. Không dùng badge/npm link upstream.
4. Xoá `README.zh-CN.md`, `README.zh-TW.md`.
5. Manifest: giữ `"license": "MIT"`; thêm `license` cho desktop `package.json` và `Cargo.toml`; sửa `repository` (own repo hoặc bỏ), bỏ `directory` lỗi thời; thêm `author` nếu muốn.
6. Quyết định về `CHANGELOG.md` (giữ có ghi chú nguồn / xoá).

### 6.2 Nhóm B-UPDATE — cắt tự cập nhật

1. **Desktop npm install (quan trọng nhất):** tách `PACKAGE` thành một hằng cấu hình duy nhất; Phase 2 đặt về chế độ "không tự cài" — khi `~/.cezar/versions` trống, hiển thị trang hướng dẫn cài thủ công thay vì `npm install @open-mercato/cezar`. Không bịa package/tag mới.
2. **Tauri updater:** xoá block `plugins.updater` (pubkey + endpoint) khỏi `tauri.conf.json`; gỡ `tauri-plugin-updater` khỏi `Cargo.toml`/`Cargo.lock` nếu không còn dùng; ẩn/disable menu "Update cezar to latest…", `check_shell_update`, `update_cezar_command`, các pill "Update/Switch version". Quyết định: xoá hẳn code hay chỉ vô hiệu hoá bằng một cờ build.
3. **CLI:** một module cờ rõ ràng (ví dụ `self-update/availability.ts` với `SELF_UPDATE_ENABLED = false`) mà `install/update/versions/use` và help đều đọc. Khi tắt: lệnh in thông báo "tính năng đã bị vô hiệu hoá trong bản Onni Work", không gọi mạng. `uninstall-as-command` chỉ được phép gỡ package **do chính bản này cài**, không đụng package global khác.
4. Giữ nguyên `CEZ_DRY_RUN=1` và test offline.

### 6.3 Nhóm B-TELEMETRY

1. `DEFAULT_TELEMETRY_URL` → rỗng/không có endpoint; `send()` trả về ngay khi không có endpoint (không DNS, không request).
2. Giữ nguyên interface: consent store, schema route, consent bar/Settings, `CEZ_TELEMETRY_URL` cho ai muốn tự host.
3. Desktop `telemetry.rs`: `DEFAULT_URL` rỗng; nút "Send error report" chỉ hiện khi có endpoint được cấu hình; giữ nguyên cơ chế consent từng báo cáo.
4. Cập nhật `.env.example`, `docs/telemetry.md` (hoặc xoá trang nếu bỏ docs), fixtures test.
5. Kiểm tra không còn ref `stats.openmercato.cloud` ngoài test fixture cố ý.

### 6.4 Nhóm B-OTHER — star-count, skills, docs links

1. **Star-count:** chọn một trong ba:
   - (a) xoá hẳn route/UI/banner (sạch nhất);
   - (b) giữ route + contract nhưng trả `{ available: false }` vô điều kiện, ẩn chip ⭐ và dialog;
   - (c) trỏ về repo Onni Work của bạn (vẫn là network mặc định).
   Đề xuất: **(b)** nếu muốn giữ contract ổn định, **(a)** nếu muốn ít code nhất. Không chọn (c) ở Phase 2 vì cần repo công khai + quyết định sản phẩm.
2. **Default skills repo:** `DEFAULT_SKILLS_REPOS = []`; xoá 3 dòng quảng bá trong `skills-banner.ts`; xác nhận auto-update là no-op khi danh sách rỗng; cập nhật test.
3. **Docs site:** nếu giữ, đổi `appName`, `gitConfig`, title, bỏ link `cezar.run`; nếu xoá, gỡ `docs:dev/check/build` khỏi root scripts và xoá `docs/site`.
4. **CHANGELOG / .ai / docs nội bộ:** theo quyết định ở §7.

### 6.5 Nhóm B-PUBLISH

1. `packages/cezar/package.json`: thêm `"private": true`, xoá `publishConfig`. (Lưu ý: `npm pack` vẫn chạy được với `private: true`, nên `check:pack` giữ nguyên.)
2. `packages/api-client`: xoá `publishConfig` (giữ `private`), sửa/bỏ `repository.directory`.
3. Alias packages: **xoá** `alias-cezar/` và `alias-cezar-run/` (không nằm trong workspaces, không được code nào import) hoặc đặt `private: true` nếu muốn giữ.
4. Workflow:
   - Xoá job publish-snapshot khỏi `ci.yml` (giữ typecheck/test/build).
   - Xoá `nightly.yml`, `release.yml`, `release-cut.yml`, `release-publish.yml`, `desktop-release.yml`, `backport.yml`, `npm-preview-cleanup.yml` — hoặc chuyển tất cả sang `workflow_dispatch` và bỏ mọi bước `npm publish`/`gh release`.
   - Giữ `ci.yml` (không publish), `codeql.yml`, `desktop-check.yml`.
   Đề xuất: **xoá** các workflow phát hành; giữ CI kiểm tra.
5. Cân nhắc giữ `scripts/release*.mts` chỉ để typecheck; nếu xoá workflow thì chúng thành dead code — có thể xoá luôn trong cùng commit (theo quy tắc "xoá artifact chết").
6. `PKGBUILD`: sửa `url` hoặc xoá nếu không phát hành Arch package.

### 6.6 Rủi ro & cách giảm

| Rủi ro | Giảm thiểu |
|--------|-----------|
| Xoá updater làm desktop không khởi động được khi máy trống | Giữ trang hướng dẫn cài thủ công rõ ràng; test luồng `~/.cezar/versions` rỗng |
| Đặt endpoint telemetry rỗng làm test/consent fail | Giữ schema/route; chỉ no-op `send`; cập nhật fixture |
| `private: true` làm `check:pack` hoặc `npm pack` fail | Chạy `npm run build` + `npm run check:pack` sau khi sửa; `npm pack` không bị chặn bởi private |
| Xoá `@open-mercato/*` import nhầm | **Không** đụng scope ở Phase 2; chỉ sửa URL/package-name xuất bản |
| Đổi `identifier` desktop làm mất dữ liệu app cũ | Dữ liệu cezar nằm ở `~/.cezar`, không phải app-data; nhưng nên tách thành quyết định rebrand riêng, không trộn vào commit cắt link |
| Xoá docs site/CHANGELOG mất thông tin | Quyết định rõ trước; nếu cần giữ, archive vào `docs/upstream/` kèm ghi chú |

---

## 7. Câu hỏi cần bạn quyết trước Phase 2

1. **Tên đầy đủ** để ghi dòng copyright mới (bắt buộc cho nhóm A).
2. **Tauri updater:** xoá hẳn plugin + command/menu, hay giữ code nhưng vô hiệu hoá bằng cờ build?
3. **CLI install/update/versions/use:** ẩn hẳn khỏi help + trả lỗi, hay giữ lệnh nhưng in thông báo "disabled"?
4. **Desktop npm install khi máy trống:** hiển thị hướng dẫn cài thủ công, hay cho phép cài từ một package do bạn phát hành (cần tên package mới — trái với ràng buộc chưa rename)?
5. **Telemetry:** giữ interface + `CEZ_TELEMETRY_URL` (khuyến nghị) hay xoá toàn bộ tính năng?
6. **Star-count:** xoá hẳn (a), giữ route trả `available:false` (b), hay trỏ repo của bạn (c)?
7. **Default skills repo:** đặt `[]` (khuyến nghị) hay trỏ một repo skills của bạn?
8. **Docs site:** xoá toàn bộ `docs/site`, hay giữ và rebrand?
9. **CHANGELOG.md:** xoá, hay giữ kèm ghi chú "lịch sử upstream"?
10. **`.ai/specs` + `.ai/runs`:** giữ làm hồ sơ thiết kế, hay xoá để repo sạch?
11. **Alias packages** `cezar-cli`/`cezar-run`: xoá hay `private: true`?
12. **Workflow phát hành:** xoá hẳn, hay chuyển sang `workflow_dispatch` không publish?
13. **Desktop productName/identifier:** giữ "Cezar"/`com.openmercato.cezar` ở Phase 2 (khuyến nghị, vì đây là rebrand chứ không phải cắt link), hay đổi luôn?

---

## 8. Kế hoạch kiểm chứng Phase 2

Sau khi sửa, chạy đúng thứ tự trong `AGENTS.md`:

```bash
npm run typecheck
npm test
npm run test:unit
npm run build
cd packages/desktop/src-tauri && cargo check
```

- `cargo test` **không chạy được trên máy này** (Smart App Control chặn binary tự build) — bỏ qua và ghi chú, theo đúng brief.
- Chạy lại grep Phase 1 và đính kèm kết quả còn lại, kèm lý do cho từng ref được giữ (scope package, lịch sử).
- Kiểm tra thêm: `npm pack --dry-run -w @open-mercato/cezar` để chắc `private: true` không phá `check:pack`.
- Với desktop: kiểm tra `tauri.conf.json` không còn `endpoint`/`pubkey`, `Cargo.lock` không còn `tauri-plugin-updater` nếu gỡ, và luồng khởi động khi `~/.cezar/versions` rỗng hiển thị hướng dẫn thay vì gọi npm.

---

## 9. Ngoài phạm vi Phase 2 (ghi nhận, chưa làm)

- Đổi tên nội bộ `cez`, `cezar`, `.ai/cezar`, `~/.cezar`, `CEZ_*`, scope `@open-mercato/*`.
- Đổi logo/icon/nhận diện thương hiệu.
- Đổi `productName`/`identifier` desktop (trừ khi bạn quyết ở câu 13).
- Viết lại toàn bộ docs site theo thương hiệu mới.

---

## 10. Phase 2 — nhật ký thực thi (2026-10-29)

Phase 2 chạy trên nhánh `dev`, **chỉ commit local** — không push, không tag, không chạy workflow phát hành.
Mọi thay đổi giữ nguyên ràng buộc "không đổi tên nội bộ": `cez`, `.ai/cezar`, `~/.cezar`, `CEZ_*`,
scope package `@open-mercato/*` và `productName`/`identifier` của desktop đều không bị đụng tới.

### 10.1 Cờ cấu hình

| Cờ | Trạng thái | Tác dụng |
| --- | --- | --- |
| `CEZ_SELF_UPDATE` | **mới, mặc định tắt** | Chỉ giá trị đúng `1` mới bật (cùng quy ước với `CEZ_REVIEW_GATE=1`). Khi tắt: `cezar install`, `cezar update`, `cezar versions`, `cezar use`, self-update service (`/api/v1/workspace/self-update*`), dialog cập nhật trong cockpit và mọi đường cập nhật của desktop đều trả **"không khả dụng trong Onni Work"** và không gọi registry. Đọc ở `packages/cezar/src/self-update/enabled.ts`; desktop dùng `const SELF_UPDATE_ENABLED: bool = false` trong `packages/desktop/src-tauri/src/lib.rs` (bản build desktop hiện tại không bật cờ này). |
| `CEZ_TELEMETRY_URL` | giữ, mặc định rỗng | Không còn endpoint upstream, nên telemetry là no-op cho tới khi người dùng tự cấu hình một endpoint của mình. Consent flow, `TELEMETRY_POLICY_VERSION` và các khoá đóng vẫn nguyên. |
| `CEZ_NO_BANNER` | giữ, **no-op** | Promo mà nó từng tắt (banner skills + dòng star) đã bị xoá; biến còn lại chỉ để script/cấu hình cũ không vỡ. |

Ba biến trên đều được ghi trong `.env.example`; `CEZ_SELF_UPDATE` và `CEZ_NO_BANNER` có thêm dòng trong
bảng env của `docs/reference.md`.

### 10.2 Commit theo nhóm

| Nhóm | Commit | Nội dung |
| --- | --- | --- |
| A — giấy phép & ghi công | `7b11c1f` | `Copyright (c) 2026 DOANTUANIT` dưới dòng cezar gốc trong `LICENSE` và `packages/cezar/LICENSE`; `NOTICE` mới; `README.md` viết lại; bỏ `README.zh-CN.md`/`README.zh-TW.md`; metadata `repository`, license của Rust crate/desktop, `PKGBUILD`; `CHANGELOG.md` của cezar chuyển sang `docs/upstream/CHANGELOG-cezar.md` và `CHANGELOG.md` mới cho Onni Work. |
| B-UPDATE | `498ecfb` | Tauri: bỏ `plugins.updater.endpoints` + `pubkey` khỏi `tauri.conf.json`, không đăng ký plugin updater, mọi nhánh install/update/restart mở trang `self_update_off`. CLI + service: gate bằng `CEZ_SELF_UPDATE`, thông điệp "không khả dụng trong Onni Work". |
| B-TELEMETRY | `75a43be` | `DEFAULT_TELEMETRY_URL = ''` (service) và `DEFAULT_URL = ""` (Rust); `post()` short-circuit; `endpoint()` trả `Option<String>`; consent chỉ hỏi khi có endpoint; nút *Send error report* ẩn khi không có endpoint; Settings → Privacy hiện trạng thái "chưa cấu hình". |
| B-PUBLISH | `a772142` | `packages/cezar` + `packages/api-client` `private: true`; bỏ mọi `publishConfig`; xoá `nightly.yml`, `npm-preview-cleanup.yml` và job `publish-snapshot` trong `ci.yml`; `BACKWARD_COMPATIBILITY.md` §6, `docs/publishing.md` ghi rõ "publishes nothing"; các workflow release còn lại chỉ chạy bằng dispatch/tag và cần secret + quyền npm scope của upstream nên không thể phát hành gì. |
| B-other | commit cuối Phase 2 | star-count trả `available:false` không gọi mạng; `DEFAULT_SKILLS_REPOS = []` và xoá banner terminal (`skills-banner.ts`); `CEZAR_REPO_URL` trỏ repo Onni Work; cập nhật `AGENTS.md`, `BACKWARD_COMPATIBILITY.md`, `docs/reference.md`, `docs/server-install/ubuntu-vps.md`, `packages/api-client/README.md`, banner `docs/site/README.md`; thêm `docs/project-overview.md` + tài liệu này. |

### 10.3 Chi tiết theo quyết định

- **Star-count (chọn b).** `StarCountReader.read()` luôn trả `{ available: false, url }` — xoá hẳn phần
  fetch/cache/rate-limit, không còn request tới github.com, không đọc `GITHUB_TOKEN`. Route
  `GET /api/v1/star-count`, `starCountSchema` và hình dạng response giữ nguyên, nên `contract-parity*`
  và BACKWARD_COMPATIBILITY vẫn đúng. Chip ⭐, toast và dialog tự ẩn vì `available` luôn `false`; dòng
  star trên banner `cezar serve` mất cùng `skills-banner.ts`.
- **Skills mặc định.** `DEFAULT_SKILLS_REPOS = []`: không còn team repo mặc định, nên `GET /api/v1/config`
  trả `teamSkills: false` khi chưa cấu hình và `PUT {teamSkills:true}` khôi phục "bộ mặc định" (đang rỗng).
  Hệ quả có chủ đích: switch *Team skill repositories* trong Settings không thể bật khi chưa có repo —
  hint của field nói rõ cần thêm `skillsRepos` vào `.ai/cezar/config.json`. Skill local, agent-mirror và
  built-in không đổi. Gating (`gatedSkillsRepos`/`projectGatedSkillsRepos`) vẫn chạy nhưng rỗng.
- **Updater.** Desktop không còn endpoint/khoá nên kể cả khi bật plugin cũng không có nguồn cập nhật;
  nhánh `install/update` của shell, npm install khi máy trống và "update on restart" đều bị compile off.
  CLI chỉ bật lại bằng `CEZ_SELF_UPDATE=1` + một nguồn phát hành riêng (Onni Work chưa có).
- **Telemetry.** Không còn URL upstream ở bất kỳ tầng nào; không có endpoint thì consent không hỏi, `post()`
  không gửi, nút gửi báo lỗi desktop bị ẩn. Việc ghi consent trong `~/.cezar/config.json` không đổi.
- **Tài liệu.** `docs/site` chỉ thêm banner ở `README.md` (nội dung gốc cezar, không deploy — không có
  workflow nào deploy docs site trong `.github/workflows`). `.ai/specs` giữ nguyên. `CHANGELOG.md` cũ
  chuyển nguyên văn sang `docs/upstream/CHANGELOG-cezar.md`.

### 10.4 Kiểm chứng

Chạy trên `D:\Multi Agent`, Node 24, Windows 10.0.26200 (Smart App Control bật):

| Lệnh | Kết quả | Ghi chú |
| --- | --- | --- |
| `npm run typecheck` | **pass** | contract + api-client + server + web + scripts release. |
| `npm test` (vitest) | 12 715 test: 12 272 pass / 393 fail (98 file) | Toàn bộ lỗi là môi trường Windows, không nằm trong file Phase 2 sửa: 39 `EPERM: symlink`, 198 `EPERM` khác (xoá temp dir đang bị khoá), 119 assertion sai separator `\` vs `/` hoặc mode `0666` vs `0600`, 37 lỗi render jsdom/mermaid. Các file liên quan trực tiếp (config-api, config, skills*, star-count*, star-promo*, app-shell, trunk-based-fields, telemetry, self-update, webhooks, release-workflows) đều **pass** khi chạy riêng; 2 test `skills-remote` + 2 assertion `config-api` hỏng do thay đổi có chủ đích đã được cập nhật trong Phase 2. |
| `npm run test:unit` (node:test) | 48 test: 46 pass / 1 fail / 1 skip | Lỗi còn lại: `test-env-launcher.test.ts` gọi `/bin/sh` (không có trên Windows) — **không liên quan** Phase 2. Hai test `skills-remote` về "default repo" đã viết lại theo mặc định rỗng. |
| `npm run build` | **pass** | `tsc` → `vite` → `check:pack`: *1093 files, 167 under web/dist*. |
| `npm pack --dry-run -w @open-mercato/cezar` | **pass** | `private: true` không chặn pack (`open-mercato-cezar-0.17.0.tgz`, 1093 file). |
| `cargo check` (`packages/desktop/src-tauri`) | **pass** | 3m13s. Plugin `tauri-plugin-updater` vẫn là dependency (giữ code) nhưng **không được đăng ký** trong `Builder`, và `tauri.conf.json` không còn `endpoint`/`pubkey`. |
| `cargo test` | **bỏ qua** | Smart App Control chặn chạy binary tự build trên máy này, đúng như brief. |

### 10.5 Deferred — link upstream còn lại trong vùng loại trừ

Ba nhóm dưới đây **được loại khỏi phép grep kiểm tra cuối** theo quyết định của owner; xử lý ở bước sau
(rebrand docs site / archive specs). Số liệu đếm bằng:

```bash
grep -rhoE "https?://[^ )\"'<>]+" <dir> | grep -Ei "open-mercato|cezar\.run" | wc -l
```

| Vùng | URL upstream | File có nhắc `open-mercato`/`cezar.run` | Ghi chú |
| --- | --- | --- | --- |
| `docs/site` | 4 | 9 | Nội dung docs gốc cezar + banner "not rebranded, not deployed"; không có workflow deploy. |
| `docs/upstream` | 95 | 1 | `CHANGELOG-cezar.md` giữ nguyên văn (lịch sử upstream). |
| `.ai/specs` | 26 | 34 | Hồ sơ thiết kế gốc; `AGENTS.md` tham chiếu các spec này. |
| `.ai/runs` (ngoài danh sách loại trừ, ghi nhận thêm) | 72 | 83 | Log run lịch sử, không phải mã chạy. |

### 10.6 Còn lại ngoài vùng loại trừ — và lý do giữ

| Nhóm | Số lượng | Lý do |
| --- | --- | --- |
| Import/tên package `@open-mercato/*` | 602 file | Ràng buộc "chưa rename nội bộ" của Phase 2; đổi scope là một bước riêng. |
| Fixture/URL trong `*.test.ts(x)`, `packages/web/e2e`, `__fixtures__` | 225 | Dữ liệu mẫu cho test (PR link, repo URL, mock event); không phải liên kết chức năng, không chạy mạng. |
| `CEZ_DRY_RUN` fake PR URL (`packages/cezar/src/server/forge/github.ts`, `packages/cezar/scripts/mock-claude.mjs`) | 3 | Placeholder của chế độ dry-run; không request nào được gửi. |
| Comment trích PR/issue upstream (`packages/cezar/src/runs/store.ts`) | 2 | Lịch sử kỹ thuật trong mã, không phải URL chạy được. |
| `docs/brand/README.md` | 1 | Ghi nguồn sinh mark/icon (repo asset của upstream) — provenance của file thiết kế. |
| `docs/upstream-audit.md` | 1 | Chính tài liệu này trích URL release manifest của upstream để mô tả cái đã gỡ. |
| `NOTICE` | 1 | Bắt buộc: ghi rõ sản phẩm phái sinh từ cezar kèm URL gốc (MIT). |

Ngoài ra, các workflow `release.yml`, `release-cut.yml`, `release-publish.yml`, `backport.yml`,
`desktop-release.yml` vẫn tồn tại vì bộ test `release-workflows.test.ts` hợp đồng hoá chúng, nhưng không
thể phát hành gì: mọi package đều `private: true`, publish cần `NPM_TOKEN`/quyền scope của upstream và các
workflow này chỉ chạy bằng `workflow_dispatch`/tag — Phase 2 **không** push tag và không chạy chúng.
