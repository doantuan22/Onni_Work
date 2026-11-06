# Nghiên cứu B — trực quan hóa Project Graph và UX

**Truy cập web trực tiếp: có.** Các trang được mở và đối chiếu ngày 2026-11-06 (UTC). Ngày push là trường pushed_at đọc từ GitHub API tại ngày kiểm tra. Với sản phẩm thương mại, nếu không thấy ngày phát hành công khai thì ghi rõ là chưa xác minh; ngày mở trang không được coi là ngày release. Dung lượng gói ghi gzip/compressed nếu nguồn cung cấp. Mọi ngưỡng của nhà cung cấp hoặc benchmark cộng đồng được ghi đúng phạm vi, không coi là SLA chung.

## Tóm tắt đề xuất

- Mở project ở cấp workspace/package/folder đã gộp, chỉ vẽ vài trăm nút có ý nghĩa. Search, local neighborhood và “impact của diff” là đường vào chính; không bắt đầu bằng toàn bộ symbol graph.
- Giữ React Flow cho subgraph nhỏ cần node tùy biến, panel và keyboard. Điểm chuyển ban đầu để benchmark: khoảng 1.500 nút đang vẽ hoặc 5.000 cạnh; giảm độ chi tiết/gộp phía server trước khi chuyển. Canvas như Cytoscape.js phù hợp vùng 1.500–10.000 nút; đánh giá WebGL như Sigma.js khi cần hơn 10.000 nút cùng lúc hoặc pan/zoom không đạt ngân sách. Đây là ngưỡng thử nghiệm đề xuất, không phải giới hạn vendor.
- Tính layout ổn định trong worker/cache; chỉ layout vùng vừa phải. Graph semantic và API độc lập renderer. Graph overview gộp theo workspace → package → folder → file → symbol, mở dần theo yêu cầu.
- Tách edge theo loại và provenance; cạnh inferred không được giả thành dependency chắc chắn. Metric overlay phải nêu kỳ đo, đơn vị và nguồn.

## Phạm vi, độ tin cậy và repo hiện tại

Survey này bao gồm sản phẩm, UX và thư viện; không phải quyết định triển khai. Ghi chú “chưa xác minh” nghĩa là trang công khai đã mở không cung cấp dữ kiện đủ cụ thể. Nhận xét trên trang marketing là claim của vendor. Feedback cộng đồng được ghi là ý kiến cá nhân. Ngày tham chiếu cho các trang là 2026-11-06.

Repo cockpit khai báo @xyflow/react ^12.12.0 và @dagrejs/dagre ^3.1.1 tại packages/web/package.json. Route packages/web/src/routes/workflow-graph/ dùng React Flow cho activity/task graph; đó là code hiện có để tham khảo, không phải bằng chứng Project Graph phải dùng một renderer duy nhất.

## Sản phẩm trực quan hóa code và kiến trúc

### CodeSee

- Hiển thị folder/file/dependency; folder mặc định thu gọn. Tree và search, pan/zoom, ẩn/hiện/chỉ giữ selection; bật insight hotspot, hoạt động mới, ngày tạo và LOC. Chọn node mở toolbar nhãn, ghi chú, visibility, source, comments; có avatar/cursor khi cộng tác. [Explore](https://docs.codesee.io/docs/explore-your-map), [edit](https://docs.codesee.io/docs/edit-your-map).
- Có custom map, code-review map, service map. Docs không nêu graph time travel, thuật toán impact hoặc giới hạn node cụ thể. Dịch vụ thương mại; giá/license theo gói chưa xác minh. Docs nói một phần code/code changes được gửi tới Anthropic cho AI. [Getting started](https://docs.codesee.io/docs/getting-started), [AI](https://docs.codesee.io/docs/ai-in-codesee).
- Không tìm thấy feedback độc lập đủ chắc. **Mượn:** collapse folder, insight bật/tắt, toolbar theo node. **Tránh:** upload mặc định khi Project Graph đặt mục tiêu local-first.

### Sourcetrail

- OSS GPL-3.0; GitHub API pushed_at=2021-12-13T18:24:17Z; repo archived 2021-12-14. [Repo](https://github.com/CoatiSoftware/Sourcetrail), [API](https://api.github.com/repos/CoatiSoftware/Sourcetrail), [docs](https://github.com/CoatiSoftware/Sourcetrail/blob/master/DOCUMENTATION.md).
- Phối hợp Search, Graph, Source: tìm symbol, xem call/quan hệ rồi mở source. Filter/overlay git và giới hạn hiện đại chưa xác minh. GitHub issues có báo call bị thiếu và indexing thoát mã 255, nên index cần trạng thái coverage/lỗi nhìn thấy được. [Issue search](https://github.com/CoatiSoftware/Sourcetrail/issues?q=is%3Aissue+call+indexing).
- Không có maintainer activity sau archive trong API. **Mượn:** search ↔ graph ↔ source đồng bộ. **Tránh:** coi graph symbol là đầy đủ nếu index có lỗi.

### Emerge / Sentry Size Analysis

- Emerge gia nhập Sentry năm 2025; Sentry Size Analysis GA 2026-02-10. Đây là binary/package size explorer, không phải repository source graph. Module X-Ray phân bổ kích thước theo module và hover breakdown. [Emerge](https://www.emergetools.com/blog/posts/emerge-tools-is-joining-sentry), [GA](https://blog.sentry.io/size-analysis-generally-available/), [Module X-Ray](https://docs.emergetools.com/docs/module-dependency-attribution-android).
- Thương mại trong Sentry, giá theo gói chưa xác minh; time travel graph ngoài build-size comparison chưa xác minh. **Mượn:** hover attribution/drill-down. **Tránh:** overlay metric không có đơn vị hoặc kỳ so sánh.

### CodeCharta

- OSS BSD-3-Clause; API pushed_at=2026-11-05T16:30:15Z. [Repo](https://github.com/MaibornWolff/codecharta), [API](https://api.github.com/repos/MaibornWolff/codecharta).
- Dùng “thành phố” 3D cho metric; domain view, dependency layering, search, flatten/exclude, git churn/co-change và delta comparison. Có điều khiển camera/select. [Overview](https://codecharta.com/docs/overview/introduction/), [Explorer](https://codecharta.com/docs/visualization/user-controls/explorer/), [app](https://codecharta.com/visualization/app/).
- Ngưỡng node và symbol-level impact panel chưa xác minh. **Mượn:** domain, exclude/flatten, delta. **Tránh:** bắt người dùng suy ra dependency chính xác từ chiều cao 3D.

### Gource

- OSS GPL-3.0; API pushed_at=2026-03-06T05:51:40Z. [Repo](https://github.com/acaudwell/Gource), [API](https://api.github.com/repos/acaudwell/Gource), [site](https://gource.io/).
- Hoạt ảnh lịch sử git với folder/file/contributor; có điều khiển tốc độ, camera, lọc file/user và ngày. [Controls](https://github.com/acaudwell/Gource/wiki/Controls).
- Là timeline replay, không phải dependency search/impact; số node tối đa chưa xác minh. Một Reddit thread đề nghị group theo subsystem cho kernel (ý kiến đơn lẻ). [Feedback](https://www.reddit.com/r/linux/comments/1kufinf/linux_kernel_git_repository_visualized_using_gource/). **Mượn:** replay tùy chọn. **Tránh:** hoạt ảnh tự chạy làm view mặc định.

### SciTools Understand

- Sản phẩm thương mại; pricing page ghi từ $100/tháng và miễn phí cho một số OSS/giáo dục tại thời điểm truy cập. [Pricing](https://documentation.scitools.com/pricing).
- Có call/dependency, butterfly, UML, control-flow và metric graph, với liên kết về source; model được phân tích theo ngôn ngữ hỗ trợ. [Graphs](https://scitools.com/graphs), [architecture](https://docs.scitools.com/help/architecture/what-is-an-architecture.html).
- Ngày release, ngưỡng node, time travel và feedback độc lập chưa xác minh. **Mượn:** graph chuyên biệt theo câu hỏi; **tránh:** một graph phải diễn giải mọi edge type.

### Structure101

- Công cụ thương mại; giá/license và release mới nhất chưa xác minh. Tài liệu mô tả hierarchical map, expand/collapse/filter, architecture rule overlay, action list mô phỏng refactor và snapshot comparison. [Getting started](https://www.sonarsource.com/structure101/docs/java/studio/Content/intro/getting-started-studio.html), [overview](https://www.sonarsource.com/structure101/docs/Welcome%20to%20Structure101.htm), [workflow](https://www.sonarsource.com/structure101/docs/cpa/studio/content/workflows).
- Selection gắn với rule/action; ngưỡng graph và feedback độc lập chưa xác minh. **Mượn:** rule overlay và preview impact; **tránh:** báo đỏ mà không cho xem đường vi phạm.

### Lattix

- Sản phẩm thương mại; giá và release date chưa xác minh. Trang giới thiệu DSM, dependency/rule model và change impact; bản 2026.0 được ghi “coming soon”. [Products](https://www.lattix.com/products/).
- Ma trận cho biết module nào phụ thuộc module nào; interaction, git time travel, feedback/ngưỡng chưa xác minh. **Mượn:** chế độ DSM khi node-edge view quá rối; **tránh:** ma trận không có drill-down tới file/symbol.

### Sourcegraph code navigation và Code Insights

- Sản phẩm thương mại; giá/license chi tiết và product release date chưa xác minh. Docs phân biệt search-based navigation với SCIP chính xác hơn, và nói search có thể false positive/negative. [Code navigation](https://sourcegraph.com/docs/code-navigation).
- Code navigation đưa người dùng tới definition/reference; Code Insights là time-series, không phải graph history. [Architecture/Insights](https://sourcegraph.com/docs/admin/architecture). Hạn mức graph, overlay ownership/churn và feedback độc lập chưa xác minh. Repo canonical trả 404 qua GitHub API lúc kiểm tra nên không suy license từ mirror.
- **Mượn:** thể hiện nguồn/cấp tin cậy của cạnh. **Tránh:** vẽ search result như cạnh compiler-resolved.

### GitHub dependency graph và CodeQL path view

- GitHub dependency graph hiển thị package từ manifests/lockfiles, license, advisory, dependency paths, search; dependents chỉ áp dụng repo public theo docs. Đây là hosted GitHub feature, không có license OSS/giá riêng; ngày cập nhật feature chưa xác minh. [Dependency graph](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/explore-dependencies).
- CodeQL path query thể hiện đường source-to-sink có node trung gian. Đây là path giải thích kết quả bảo mật, không phải graph tổng quát. [Path queries](https://codeql.github.com/docs/writing-codeql-queries/creating-path-queries/).
- Không có lịch sử node/heatmap ownership được mô tả. **Mượn:** exact path và package metadata; **tránh:** lẫn package graph với source imports/calls.

### Nx Project Graph

- OSS MIT; nrwl/nx API pushed_at=2026-11-06T10:29:19Z. [Repo](https://github.com/nrwl/nx), [API](https://api.github.com/repos/nrwl/nx).
- Project/package graph có search, focus/proximity, folder groups; affected graph thu hẹp phạm vi build/test theo thay đổi. [Explore](https://nx.dev/docs/features/explore-graph), [affected graph](https://nx.dev/blog/ci-affected-graph).
- Tài liệu Nx lưu ý full graph có thể khó quản lý kể cả ở repo nhỏ; grouping/affected giúp giảm tải. **Mượn:** affected subgraph và collapse folder; **tránh:** full workspace phẳng.

### Turborepo

- OSS MIT; vercel/turborepo API pushed_at=2026-11-06T06:50:59Z. [Repo](https://github.com/vercel/turborepo), [API](https://api.github.com/repos/vercel/turborepo).
- Package/task graph là DAG build pipeline; CLI run dùng task graph và xuất dữ liệu graph. [Concepts](https://turborepo.dev/docs/core-concepts/package-and-task-graph), [run](https://turborepo.dev/docs/reference/run).
- Không tương đương symbol/source graph; git overlay, time travel và UX impact nguồn chưa xác minh. Issue search có case graph biểu diễn dependencies quá rộng. [Issue search](https://github.com/vercel/turborepo/issues?q=graph+dependencies). **Mượn:** graph để chọn task/test; **tránh:** dùng task DAG làm dependency code.

### CodeScene behavioural analysis

- Thương mại, có gói OSS miễn phí; trang pricing ghi Standard €18, Pro €27 mỗi active author/tháng khi trả năm tại thời điểm mở. [Pricing](https://codescene.com/pricing).
- Hotspot phối hợp thay đổi và complexity; change coupling suy ra file thường đổi cùng nhau từ commit/ticket, có hover/click detail và temporal trend. [Hotspots](https://codescene.digitgaming.com/docs/guides/technical/hotspots.html), [coupling](https://codescene.digitgaming.com/docs/guides/technical/change-coupling.html).
- Docs v6.7.3; release mới nhất chưa xác minh. Docs cảnh báo coupling cần ngữ cảnh và ghi nhận advanced analysis ít dùng hơn. **Mượn:** heatmap có kỳ/legend; **tránh:** coi co-change như import/call.

## Knowledge graph, large-graph và agent-first

### Obsidian Graph view

- Ứng dụng proprietary: cá nhân miễn phí, thương mại theo license/pricing. [Terms](https://obsidian.md/license).
- Nút note, cạnh wikilink; local/global graph, depth, query/filter theo tag/attachment/orphan, color groups và time-lapse. [Docs](https://obsidian.md/help/Plugins/Graph%2Bview).
- Reddit feedback nói local graph hữu ích, global không lọc dễ thành hairball (ý kiến cá nhân). Ngưỡng node/release gần nhất chưa xác minh. [Feedback](https://www.reddit.com/r/ObsidianMD/comments/1vhdlib/do_you_actually_use_the_global_graph_to_navigate/). **Mượn:** neighborhood depth và local graph; **tránh:** overview rối không có câu hỏi mặc định.

### Logseq

- OSS AGPL-3.0; logseq/logseq API pushed_at=2026-11-06T09:20:17Z. [Repo](https://github.com/logseq/logseq), [API](https://api.github.com/repos/logseq/logseq).
- Graph UX dựa trên page/block references; property hỗ trợ loại trang khỏi graph. Mô hình được giải thích trong một bài cộng đồng, không phải spec chính thức. [Explanation](https://discuss.logseq.com/t/graphical-explanation-of-pages-blocks-and-references/15966), [properties](https://github.com/logseq/docs/blob/master/pages/Built-in%20Properties.md).
- Không xác minh git time travel/impact code. **Mượn:** exclusion do user kiểm soát; **tránh:** gán cùng trọng lượng cho mọi reference.

### Neo4j Bloom

- Thương mại/edition-dependent; giá cụ thể chưa xác minh. Perspective định nghĩa label, caption, style và search cho các view tác vụ. [Overview](https://neo4j.com/docs/bloom-user-guide/current/bloom-visual-tour/bloom-overview/), [perspectives](https://neo4j.com/docs/bloom-user-guide/current/bloom-perspectives/perspective-creation/).
- Query → chọn node → xem thuộc tính/neighborhood. Docs cảnh báo scan/search hơn 10 triệu node có thể chậm; đây là query/scan caveat, không phải giới hạn renderer. Code impact/history và feedback độc lập chưa xác minh.
- **Mượn:** perspective và query-first exploration; **tránh:** bắt người dùng viết graph query cho câu hỏi phổ biến.

### Gephi

- Desktop OSS GPL-3.0; gephi/gephi API pushed_at=2026-11-01T20:12:44Z. Maintainer/site claim xử lý tới triệu phần tử, không phải cam kết latency. [Repo](https://github.com/gephi/gephi), [API](https://api.github.com/repos/gephi/gephi), [desktop](https://gephi.org/desktop/).
- Có layout, filter và dynamic data/time. [Filters](https://docs.gephi.org/desktop/Plugins/Filter/), [dynamic](https://docs.gephi.org/desktop/User_Manual/Import_Dynamic_Data/). Roadmap nêu local exploration/compare và một số thiếu sót UI như parallel edges. [Roadmap](https://gephi.org/desktop/).
- **Mượn:** pipeline filter trước render, timeline. **Tránh:** force layout ngẫu nhiên không có semantic grouping.

### Gristle — agent repo graph

- OSS MIT; Alchemy-Agentic/gristle API pushed_at=2026-08-10T21:41:13Z. [Repo](https://github.com/Alchemy-Agentic/gristle), [API](https://api.github.com/repos/Alchemy-Agentic/gristle).
- MCP graph route→handler→DB, impact và HTML subgraph; edge heuristic chưa type-resolved, cần FalkorDB. README/repo là mô tả maintainer; feedback độc lập chưa xác minh. **Mượn:** multi-hop impact và subgraph nhỏ cho agent. **Tránh:** giấu heuristic hoặc buộc DB ngoài mặc định local-first.

### OpenVisio

- OSS MIT; syntaxPriest/openvisio-oss API pushed_at=2026-10-23T12:08:10Z. [Repo](https://github.com/syntaxPriest/openvisio-oss), [API](https://api.github.com/repos/syntaxPriest/openvisio-oss).
- Tree-sitter trích symbol/import; PageRank; MCP token budget; UI React/Three Atlas/City. Có tùy chọn transport upload graph JSON. README claims, benchmark/review độc lập chưa xác minh. **Mượn:** deterministic extraction + bounded MCP query; **tránh:** upload bật mặc định, hoặc diễn giải PageRank như quan hệ.

### codebase-graph-mcp

- OSS MIT; 0xbyt4/codebase-graph-mcp API pushed_at=2026-09-25T21:58:02Z. [Repo](https://github.com/0xbyt4/codebase-graph-mcp), [API](https://api.github.com/repos/0xbyt4/codebase-graph-mcp).
- Kết hợp Atlas, live Python pulse và MCP impact. README đưa ví dụ 9.5K source files; impact output nhóm, mặc định cap 50/tối đa 500. Đây là con số repo tự nêu, không phải benchmark độc lập. **Mượn:** cap + nhóm kết quả; **tránh:** coi file count ví dụ là giới hạn node đo được.

## Danh mục 94 URL đã mở

- https://api.github.com/repos/0xbyt4/codebase-graph-mcp
- https://api.github.com/repos/acaudwell/Gource
- https://api.github.com/repos/Alchemy-Agentic/gristle
- https://api.github.com/repos/CoatiSoftware/Sourcetrail
- https://api.github.com/repos/gephi/gephi
- https://api.github.com/repos/logseq/logseq
- https://api.github.com/repos/MaibornWolff/codecharta
- https://api.github.com/repos/nrwl/nx
- https://api.github.com/repos/syntaxPriest/openvisio-oss
- https://api.github.com/repos/vercel/turborepo
- https://blog.sentry.io/size-analysis-generally-available/
- https://bundlephobia.com/package/@react-sigma/core
- https://bundlephobia.com/package/@xyflow/react
- https://bundlephobia.com/package/cytoscape
- https://bundlephobia.com/package/elkjs
- https://bundlephobia.com/package/sigma
- https://bundlephobia.com/package/vis-network
- https://codecharta.com/docs/overview/introduction/
- https://codecharta.com/docs/visualization/user-controls/explorer/
- https://codecharta.com/visualization/app/
- https://codeql.github.com/docs/writing-codeql-queries/creating-path-queries/
- https://codescene.com/pricing
- https://codescene.digitgaming.com/docs/guides/technical/change-coupling.html
- https://codescene.digitgaming.com/docs/guides/technical/hotspots.html
- https://cosmograph.app/licensing/
- https://d3js.org/d3-force/many-body
- https://deck.gl/docs
- https://deck.gl/docs/developer-guide/building-apps
- https://discuss.logseq.com/t/graphical-explanation-of-pages-blocks-and-references/15966
- https://docs.codesee.io/docs/ai-in-codesee
- https://docs.codesee.io/docs/edit-your-map
- https://docs.codesee.io/docs/explore-your-map
- https://docs.codesee.io/docs/getting-started
- https://docs.emergetools.com/docs/module-dependency-attribution-android
- https://docs.gephi.org/desktop/Plugins/Filter/
- https://docs.gephi.org/desktop/User_Manual/Import_Dynamic_Data/
- https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/explore-dependencies
- https://docs.scitools.com/help/architecture/what-is-an-architecture.html
- https://documentation.scitools.com/pricing
- https://eclipse.dev/elk/
- https://gephi.org/desktop/
- https://github.com/0xbyt4/codebase-graph-mcp
- https://github.com/acaudwell/Gource
- https://github.com/acaudwell/Gource/wiki/Controls
- https://github.com/Alchemy-Agentic/gristle
- https://github.com/CoatiSoftware/Sourcetrail
- https://github.com/CoatiSoftware/Sourcetrail/blob/master/DOCUMENTATION.md
- https://github.com/CoatiSoftware/Sourcetrail/issues?q=is%3Aissue+call+indexing
- https://github.com/d3/d3-force
- https://github.com/dagrejs/dagre
- https://github.com/dagrejs/dagre/wiki
- https://github.com/gephi/gephi
- https://github.com/jacomyal/sigma.js
- https://github.com/kieler/elkjs
- https://github.com/logseq/docs/blob/master/pages/Built-in%20Properties.md
- https://github.com/logseq/logseq
- https://github.com/MaibornWolff/codecharta
- https://github.com/Naveen-Boddepalli/flowinger/blob/main/docs/benchmarks.md
- https://github.com/nrwl/nx
- https://github.com/syntaxPriest/openvisio-oss
- https://github.com/vercel/turborepo
- https://github.com/vercel/turborepo/issues?q=graph+dependencies
- https://github.com/visgl/deck.gl
- https://gource.io/
- https://hpla.lacity.org/static/webcola/WebCoLa/
- https://ieeexplore.ieee.org/document/9477202/
- https://manual.cytoscape.org/en/3.10.3/Rendering_Engine.html
- https://neo4j.com/docs/bloom-user-guide/current/bloom-perspectives/perspective-creation/
- https://neo4j.com/docs/bloom-user-guide/current/bloom-visual-tour/bloom-overview/
- https://next.cosmograph.app/docs-lib/features/clustering/
- https://nx.dev/blog/ci-affected-graph
- https://nx.dev/docs/features/explore-graph
- https://obsidian.md/help/Plugins/Graph%2Bview
- https://obsidian.md/license
- https://openjsf.org/blog/introducing-cosmos-gl
- https://reactflow.dev/learn/advanced-use/accessibility
- https://reactflow.dev/learn/advanced-use/performance
- https://scitools.com/graphs
- https://sourcegraph.com/docs/admin/architecture
- https://sourcegraph.com/docs/code-navigation
- https://turborepo.dev/docs/core-concepts/package-and-task-graph
- https://turborepo.dev/docs/reference/run
- https://visjs.github.io/vis/docs/network/
- https://www.emergetools.com/blog/posts/emerge-tools-is-joining-sentry
- https://www.lattix.com/products/
- https://www.npmjs.com/package/@cosmograph/react
- https://www.npmjs.com/package/elkjs
- https://www.npmjs.com/package/vis-network
- https://www.reddit.com/r/linux/comments/1kufinf/linux_kernel_git_repository_visualized_using_gource/
- https://www.reddit.com/r/ObsidianMD/comments/1vhdlib/do_you_actually_use_the_global_graph_to_navigate/
- https://www.sigmajs.org/concepts/rendering/
- https://www.sonarsource.com/structure101/docs/cpa/studio/content/workflows
- https://www.sonarsource.com/structure101/docs/java/studio/Content/intro/getting-started-studio.html
- https://www.sonarsource.com/structure101/docs/Welcome%20to%20Structure101.htm

## Đối chiếu các chiều UX theo từng sản phẩm

Các nguồn vendor được dẫn ngay trong từng hồ sơ ở trên; nếu không thấy chức năng/giới hạn được mô tả thì ghi “chưa xác minh”, không suy ra là không có. Cột feedback chỉ ghi nguồn cộng đồng/issue khi có; nếu trống là chưa xác minh được ý kiến người dùng độc lập.

| Sản phẩm | Filter / overlay / time travel | Search / selection / impact | Quy mô / feedback đã xác minh |
|---|---|---|---|
| CodeSee | Tree/visibility; insight metric; time travel chưa xác minh | Tree search, node toolbar; impact chưa xác minh | Scale chưa nêu; feedback độc lập chưa xác minh |
| Sourcetrail | Filter, git overlay và time travel chưa xác minh | Search symbol, chọn graph/source; navigation tới call, impact chưa xác minh | Repo archived; issue ghi call thiếu/index fail |
| Emerge | Size breakdown và build comparison; filter/time chưa xác minh | Hover module attribution; code impact chưa xác minh | Không phải repo graph; scale/feedback độc lập chưa xác minh |
| CodeCharta | Metric, churn/co-change, exclude, delta | Search/camera/selection; source impact chưa xác minh | Node limit/feedback độc lập chưa xác minh |
| Gource | File/user/date filter, timeline replay | Camera/selection; dependency impact không phải mục đích | Node limit chưa xác minh; Reddit comment đề xuất group subsystem |
| Understand | Nhiều kiểu graph; filter/overlay/time cụ thể chưa xác minh | Source-linked graph; impact UX chưa xác minh | Scale và feedback độc lập chưa xác minh |
| Structure101 | Filter, rule overlay, snapshot time compare | Action list/refactor preview; search không nêu | Scale/feedback độc lập chưa xác minh |
| Lattix | Rules/model; filter/time cụ thể chưa xác minh | Change impact theo DSM; search/selection cụ thể chưa xác minh | Scale/feedback độc lập chưa xác minh |
| Sourcegraph | Search/SCIP provenance; Insights time-series | Definition/reference; code navigation, graph impact chưa xác minh | Search có false positive/negative theo docs; feedback độc lập chưa xác minh |
| GitHub / CodeQL | Search/filter package, advisory, path; time chưa xác minh | Chọn dependency path/source→sink; impact path cụ thể | Graph-wide node limit/feedback độc lập chưa xác minh |
| Nx | Folder group, focus/proximity, affected subset; history/overlay chưa xác minh | Search/focus; affected build/test | Nx blog ghi full graph có thể khó quản lý |
| Turborepo | Graph export; filter/search/time UI chưa xác minh | Task DAG/run; task impact | Issue report case graph dependency quá rộng; general scale chưa xác minh |
| CodeScene | Churn/complexity/coupling, temporal trend | Hover/click hotspot; behavioral coupling impact | Scale chưa xác minh; docs cảnh báo coupling phải xét ngữ cảnh |
| Obsidian | Local/global, depth, query/group, time-lapse | Search/select note và neighbor | User feedback: local hữu ích, global hairball; node cap chưa xác minh |
| Logseq | Property exclusion; overlay/time chưa xác minh | Page/block references; code impact chưa xác minh | Scale/feedback độc lập chưa xác minh |
| Neo4j Bloom | Perspective style/search; time overlay chưa xác minh | Query, chọn node/property/neighborhood; code impact chưa xác minh | Docs cảnh báo scan >10M node chậm; feedback độc lập chưa xác minh |
| Gephi | Filter, dynamic time data | Selection/filter; code impact không phải trọng tâm | Maintainer claim triệu phần tử; roadmap nêu một số thiếu sót UX |
| Gristle | HTML subgraph; filter/time chưa xác minh | MCP impact; UI search/selection chi tiết chưa xác minh | FalkorDB bắt buộc; benchmark/feedback độc lập chưa xác minh |
| OpenVisio | Atlas/City; filter/time chưa xác minh | MCP query có token budget; UI impact chi tiết chưa xác minh | README claim; benchmark/feedback độc lập chưa xác minh |
| codebase-graph-mcp | Atlas/live pulse; filter/time chưa xác minh | MCP impact output capped/grouped | README ví dụ 9.5K file; benchmark/feedback độc lập chưa xác minh |

## Bảng so sánh sản phẩm

| Sản phẩm | Node/edge và aggregation | Filter/overlay/time | Search, selection, impact | Scale/UX/điểm cần tránh |
|---|---|---|---|---|
| CodeSee | folder/file/dependency; collapse folder | insight hotspot/activity/LOC, custom maps | tree/search, toolbar; impact chưa rõ | ngưỡng chưa rõ; tránh upload mặc định |
| Sourcetrail | symbol/call/source | overlay/time chưa rõ | search↔graph↔source | archived; indexing issue |
| Emerge | module trong binary | breakdown size/build | hover attribution | không phải source graph |
| CodeCharta | file/domain/metric city | churn/co-change, delta, exclude | search, chọn/camera | ngưỡng chưa rõ; cẩn thận 3D |
| Gource | file/folder/contributor | replay commit, filter | user/file filters; không impact | animation là mode riêng |
| Understand | call/dependency/UML/control flow | nhiều graph chuyên biệt | chọn graph/source | thương mại; ngưỡng chưa rõ |
| Structure101/Lattix | hierarchy / DSM | rules, snapshot, model | action/impact | giá/ngưỡng chưa rõ |
| Sourcegraph | symbol/reference | provenance SCIP/search; Insights time-series | navigation/reference | search có false +/- |
| GitHub/CodeQL | package/path source→sink | advisory/license | search package/exact path | các graph domain khác nhau |
| Nx/Turbo | project DAG / task DAG | folder/affected/task export | build/test impact | không thay source graph |
| CodeScene | hotspot/co-change | churn, complexity, trend | hover/click detail | coupling là inference |
| Obsidian/Logseq | note/page/block/reference | local/depth/filter/time/exclude | selection/reference | global hairball feedback |
| Bloom/Gephi | graph DB / generic graph | perspective, filter, time | query/property/local graph | Bloom >10M scan caveat; Gephi claim triệu |
| Gristle/OpenVisio/codebase-graph-mcp | route/code/symbol | HTML/Atlas/City | MCP impact, token/output cap | README claims, evidence level varies |

## Thư viện render và layout

| Thư viện | Quy mô evidence | Layout / clustering | A11y / React | Bundle gzip/compressed và license |
|---|---|---|---|---|
| @xyflow/react (React Flow) | Không có hard limit chính thức; benchmark community 10K nodes báo culling ~96 node visible và pan/zoom 3.7/4.3 ms trên M4/Chrome fixture, không tổng quát. [Perf](https://reactflow.dev/learn/advanced-use/performance), [benchmark](https://github.com/Naveen-Boddepalli/flowinger/blob/main/docs/benchmarks.md) | Renderer; layout ngoài; expand/collapse do app | React; docs có keyboard, tab, ARIA, live region. [A11y](https://reactflow.dev/learn/advanced-use/accessibility) | 58.6 kB; MIT. [Bundle](https://bundlephobia.com/package/@xyflow/react) |
| dagre | Hard node cap/benchmark chưa xác minh | Directed layered; graphlib compound. Crossing phase O(E log Vsmall) theo wiki, tổng phụ thuộc graph. [Wiki](https://github.com/dagrejs/dagre/wiki) | Layout lib, UI/a11y ngoài | size chưa xác minh; MIT. [Repo](https://github.com/dagrejs/dagre) |
| elkjs | Hard cap chưa xác minh | Layered/tree/radial/force, hierarchy/ports/compound, async worker. [ELK](https://eclipse.dev/elk/), [repo](https://github.com/kieler/elkjs) | React Flow integration qua layout API; UI a11y ngoài | 427.1 kB gzip v0.12.0; EPL-2.0 OR GPL-3.0-or-later. [npm](https://www.npmjs.com/package/elkjs), [bundle](https://bundlephobia.com/package/elkjs) |
| Cytoscape.js | Docs hướng dẫn coarse LOD khi node+edge >4K; nhãn khi <200 node visible; docs nói >10K interactive, không SLA. [Rendering](https://manual.cytoscape.org/en/3.10.3/Rendering_Engine.html) | Nhiều layouts, compound; fcose compound/constraints; Cola paper nói small/medium interactive. [fcose](https://ieeexplore.ieee.org/document/9477202/), [Cola](https://hpla.lacity.org/static/webcola/WebCoLa/) | Framework-agnostic; React wrapper được tự tích hợp | 133.6 kB; MIT. [Bundle](https://bundlephobia.com/package/cytoscape) |
| Sigma.js + Graphology | Maintainer claim WebGL “tens of thousands”, không benchmark độc lập. [Rendering](https://www.sigmajs.org/concepts/rendering/) | WebGL; Graphology/plugin; clustering chuẩn bị ở model | @react-sigma/core; cần DOM companion cho a11y | Sigma 94.3 kB, wrapper 3.2 kB; MIT. [Sigma](https://bundlephobia.com/package/sigma), [React](https://bundlephobia.com/package/@react-sigma/core), [repo](https://github.com/jacomyal/sigma.js) |
| d3-force | Barnes–Hut many-body O(n log n) mỗi lượt; ticks/constraints làm tổng chi phí tăng. [Docs](https://d3js.org/d3-force/many-body) | Force layout; semantic compounds không built-in | Không phải UI/React | size chưa xác minh do rate limit; ISC. [Repo](https://github.com/d3/d3-force) |
| vis-network | Docs nói vài nghìn; clustering giảm tải, docs cũ nêu >50K, không coi là SLA. [Docs](https://visjs.github.io/vis/docs/network/) | Force/hierarchical, cluster APIs | Wrapper/ref với React; a11y cần đánh giá | 115.6 kB; Apache-2.0 OR MIT. [npm](https://www.npmjs.com/package/vis-network), [bundle](https://bundlephobia.com/package/vis-network) |
| Cosmograph/cosmos.gl | OpenJS Foundation claim million-element interactive visualization; workload-specific, không guarantee. [OpenJS](https://openjsf.org/blog/introducing-cosmos-gl) | GPU/WebGL, clustering. [Docs](https://next.cosmograph.app/docs-lib/features/clustering/) | React package; cần DOM/keyboard companion | bundle size chưa lấy được; CC-BY-NC-4.0 non-commercial. [React](https://www.npmjs.com/package/@cosmograph/react), [license](https://cosmograph.app/licensing/) |
| deck.gl | GPU layers; graph-specific node ceiling chưa xác minh. [Docs](https://deck.gl/docs) | React/layers; graph layer experimental | React DeckGL; semantics cần DOM support | Deck+Layer 146.8 kB compressed; wrapper +5.2 kB; MIT. [Bundle guide](https://deck.gl/docs/developer-guide/building-apps), [repo](https://github.com/visgl/deck.gl) |

## Khuyến nghị renderer cho quy mô repo

1. **0–1.500 nút hiển thị:** React Flow cho custom node, focus/selection/panel và keyboard. Đây là mốc benchmark đề xuất, không phải vendor cap. Dùng memoization, tránh style/object đổi mỗi render, ẩn edge ngoài viewport và gộp folder.
2. **1.500–10.000 nút:** giảm label/edge detail và dùng canvas như Cytoscape.js. Theo docs Cytoscape, LOD thô bắt đầu khi node+edge >4K; mở rộng subgraph nhỏ về React Flow khi cần interaction cockpit.
3. **Hơn ~10.000 nút hiển thị hoặc không đạt 30 FPS:** đánh giá Sigma.js WebGL; benchmark Cosmograph nếu licensing non-commercial phù hợp. deck.gl phù hợp custom GPU layers, không phải lựa chọn graph mặc định.
4. **Server-side cluster/query:** từ workspace → package → folder → file → symbol; server trả neighborhood/impact có giới hạn. Không tải hàng triệu symbol lên browser rồi trông chờ GPU. Cạnh aggregate phải có count và expand-to-real-path.
5. **Layout:** Dagre cho hierarchy nhẹ/ổn định; ELK khi cần nested compound/ports/thuật toán đa dạng và chấp nhận bundle lớn hơn. Force chỉ cho neighborhood nhỏ, chạy worker rồi cache tọa độ; không force-relayout toàn repo mỗi pan.
6. Các ngưỡng cần benchmark trên máy phổ thông Windows: p95 frame, first paint, memory, time search-to-focus, keyboard traversal; kiểm tra cả graph thưa/dày và edge label. Giữ semantic model độc lập renderer.

## Đề cương UX Project Graph

### View mặc định và zoom

- Mặc định workspace/package/folder đã gộp, có legend, trạng thái index, stale timestamp và provenance. Overview trả lời “các vùng lớn nối nhau ra sao?” thay vì cố hiển thị mọi symbol.
- Zoom 1: workspace/package + dependency trực tiếp. Zoom 2: folder/file, imports/calls, test. Zoom 3: symbol và docs/schema→route→client→hook. Không tự bung mọi cấp.
- Local neighborhood 1-hop mặc định; mở thêm hop theo yêu cầu. Search focus node. Selection giữ panel khi pan/zoom.

### Filter, overlay, history

- Filter theo node: package/folder/file/symbol/test/doc/schema/route/client/hook/run/worker; path, language, owner, external, orphan/cycle.
- Edge toggles riêng: import, call/reference, test-covers, contract-flow, declared/ownership, co-change, run-touched. Hiển thị hướng, confidence và extracted/inferred/declared bằng kiểu nét/nhãn.
- Overlay bật riêng: churn theo thời gian chọn, co-change, ownership, coverage nếu có, complexity, active task/worker. Ghi đơn vị/kỳ/nguồn; missing data không được tô như số 0.
- Time travel là snapshot theo commit và diff before/after khi history index có; current worker state không trộn với git history.

### Panel và hành động

- Selection panel: tên/path/type, metadata, lý do/provenance/độ tin cậy edge, inbound/outbound neighbors, owner, test gần nhất, lịch sử và active run.
- “Show impact of this diff”: changed nodes làm seed; hiển thị downstream dependents, tests ứng viên, confidence và edge reasoning. Toggle edge class, click để highlight exact path; candidate inferred không được hứa chắc chắn.
- “Start a task here”: tạo task có scope path/node và impact context; user sửa prompt, xem đường/context/token trước start. Không auto-commit/merge.
- “Worker editing this node”: highlight worker/task/time qua WS, bỏ khi task kết thúc; chỉ truyền id/path/status, không đẩy file content.

### Loading, empty/error, accessibility

- Loading skeleton toolbar/panel; giữ graph cũ tới khi subgraph mới sẵn; nêu index progress/stale timestamp.
- Empty phân biệt repo chưa index, filter rỗng, node cô lập; có clear filters/rebuild và gợi ý lệnh CLI.
- Error/degraded vẫn giữ graph tĩnh nếu git/parser/cache không sẵn; nêu edge coverage thiếu và query giảm, không crash cockpit.
- Keyboard: Tab vào graph, mũi tên qua neighbor, Enter chọn/mở panel, Escape bỏ chọn; focus ring rõ và shortcut help. Tôn trọng focus trong form, contrast và reduced motion.
- Có cây/table DOM tương đương cho screen reader khi canvas/WebGL; đọc được edge type/direction/provenance; live region chỉ thông báo selection/worker change cần thiết. Không để màu/graph là kênh thông tin duy nhất. React Flow docs có keyboard/ARIA/live region, nhưng canvas renderer khác cần QA riêng. [A11y docs](https://reactflow.dev/learn/advanced-use/accessibility).

## Anti-patterns và cách tránh

| Anti-pattern | Cách tránh và ví dụ |
|---|---|
| Hairball toàn repo | Obsidian user feedback về global graph; dùng local depth, query filter, Nx affected subgraph/grouping. [Obsidian](https://www.reddit.com/r/ObsidianMD/comments/1vhdlib/do_you_actually_use_the_global_graph_to_navigate/), [Nx](https://nx.dev/blog/ci-affected-graph) |
| Mọi node/edge ngang hàng | CodeSee collapse folders; Structure101 hierarchy/rules. Chỉ expand khi zoom/selection. [CodeSee](https://docs.codesee.io/docs/explore-your-map), [Structure101](https://www.sonarsource.com/structure101/docs/java/studio/Content/intro/getting-started-studio.html) |
| Force toàn graph mỗi lần pan | Dagre/ELK hierarchical layout ổn định; d3-force vẫn có O(n log n) many-body mỗi lần áp dụng. Layout nhỏ, cache/worker. [Dagre](https://github.com/dagrejs/dagre/wiki), [D3](https://d3js.org/d3-force/many-body) |
| Heatmap không legend | CodeScene nhắc coupling cần ngữ cảnh. Nêu unit, window, source và missing data. [Coupling](https://codescene.digitgaming.com/docs/guides/technical/change-coupling.html) |
| Inferred thành fact | Sourcegraph phân biệt SCIP/search; Gristle có heuristic edges. Nêu provenance/confidence và vì sao. [Sourcegraph](https://sourcegraph.com/docs/code-navigation), [Gristle](https://github.com/Alchemy-Agentic/gristle) |
| Graph đẹp nhưng không trả lời “sửa gì?” | Nx affected graph, CodeQL path, Structure101 actions nối graph với build/test/rule/path. [Nx](https://nx.dev/blog/ci-affected-graph), [CodeQL](https://codeql.github.com/docs/writing-codeql-queries/creating-path-queries/), [Structure101](https://www.sonarsource.com/structure101/docs/cpa/studio/content/workflows) |
| 3D/animation cản so sánh | CodeCharta/Gource hữu ích như mode riêng; có bảng/path và pause/step. [CodeCharta](https://codecharta.com/docs/visualization/user-controls/explorer/), [Gource](https://github.com/acaudwell/Gource/wiki/Controls) |
| Vẽ hết rồi hy vọng GPU cứu | Cytoscape LOD, Sigma WebGL; aggregate/LOD trước render và bỏ label trước node. [Cytoscape](https://manual.cytoscape.org/en/3.10.3/Rendering_Engine.html), [Sigma](https://www.sigmajs.org/concepts/rendering/) |
| Canvas là kênh duy nhất | React Flow docs hỗ trợ keyboard/ARIA/live region; thêm cây/table DOM tương đương và screen-reader labels. [A11y](https://reactflow.dev/learn/advanced-use/accessibility) |
| Package, task, import, co-change gọi chung “dependency” | GitHub package graph, Turbo task DAG, CodeScene co-change là miền khác nhau. Edge type/provenance rõ. [GitHub](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/explore-dependencies), [Turbo](https://turborepo.dev/docs/core-concepts/package-and-task-graph), [CodeScene](https://codescene.digitgaming.com/docs/guides/technical/change-coupling.html) |
| Upload code cho graph local-first | CodeSee nêu gửi code/code changes tới Anthropic; OpenVisio có transport upload tùy chọn. Không bật egress mặc định. [CodeSee](https://docs.codesee.io/docs/ai-in-codesee), [OpenVisio](https://github.com/syntaxPriest/openvisio-oss) |
| Một graph phải trả lời mọi câu hỏi | Understand có graph chuyên biệt; CodeQL giải thích path. Tách overview, impact, history và table/list. [Understand](https://scitools.com/graphs), [CodeQL](https://codeql.github.com/docs/writing-codeql-queries/creating-path-queries/) |
