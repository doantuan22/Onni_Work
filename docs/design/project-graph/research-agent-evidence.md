# Bằng chứng: code graph có giúp coding agent không?

**Ngày khảo sát: 2026-11-13.** Báo cáo này không lặp lại kiểm kê engine/UX trong PLAN.md và hai báo cáo cùng thư mục. Star là ảnh chụp xấp xỉ trên GitHub, không phải thước đo hiệu quả. Commit gần nhất ghi “chưa kiểm” nếu không đọc được trực tiếp; số do nhóm dự án/paper công bố là tự báo cáo.

## Kết luận

Graph giúp các câu hỏi quan hệ (caller/callee, impact, multi-hop) và cải thiện localization. Bằng chứng graph làm agent sửa issue tốt hơn khiêm tốn hơn: RepoGraph tăng resolve vài điểm nhưng có thêm chi phí; LocAgent, OrcaLoca, KGCompass báo số mạnh nhưng kết hợp graph với model/workflow/re-ranking. Một ablation 2026 trên cùng model/harness cho structural index hybrid thấy gain đáng kể, song chỉ 91 task và còn preprint.

Không có representation thắng tất cả. Grep tốt cho chuỗi chính xác, source đầy đủ và exhaustive search. Embeddings tốt khi mô tả tự nhiên lệch tên symbol. Graph tốt cho structure và đường đi nhiều bước. Kết luận thực tế: hybrid có fallback; MCP, popularity hay tuyên bố “tiết kiệm token” không tự nó là bằng chứng.

## Benchmark định lượng

| Nghiên cứu | Kết quả | Giới hạn |
|---|---|---|
| **RepoGraph**, ICLR 2025, SWE-bench Lite (300) | Thêm graph vào Agentless + GPT-4o: resolve 27.33% → 29.67% (+2.34 điểm); file localization 68.7 → 74.3%, function 51 → 54%, line 34.3 → 36.7%. SWE-agent resolve 18.33 → 20.33%, file 61.7 → 67.3%. | Plugin ablation tương đối sạch, nhưng Agentless cost tăng $0.34 → $0.39 và tokens 42,376 → 47,323. Không thể gọi là tiết kiệm token. Chỉ Python/model 2024. |
| **RepoGraph budget/hops** | Repo trung bình >1,000 node, >25,000 cạnh. 1-hop ego ~11.6 node/37.1 edge; 2-hop ~54.5/89.9. Flatten 2-hop cho resolve 26%, thấp hơn baseline; LLM summary 2-hop cải thiện. Summary 1-hop lại giảm còn 28.33%. | Context nhiều hop làm nhiễu; summary đôi lúc giúp, đôi lúc bỏ mất chi tiết. |
| **LocAgent**, ACL 2025 | Paper báo Qwen2.5-Coder-32B file localization tối đa 92.7%, Agentless Pass@10 +12%, localization cost thấp hơn ~86% so với cấu hình proprietary được so. Graph file/class/function với import/call/inheritance. | Không phải ablation graph ON/OFF cùng workflow; Acc@k không đồng nghĩa fix đúng; cost lệ thuộc model/API. |
| **OrcaLoca** | SWE-bench Lite: file match 83.33%, function 65.33%, resolve 41% (123/300). Với Agentless-1.5 báo +6.33 điểm resolve, +6.67 function. Bỏ scheduling/decomposition/pruning mất 3–5 điểm function trên subset Common. | Evidence tốt cho pipeline explore/prune; không cô lập graph. |
| **KGCompass** | SWE-bench Lite: resolve 45.67%, function localization 51.33%, $0.20/repair; top 20 functions; 69.7% bug định vị thành công cần multi-hop. | Theo paper; không so trực tiếp số resolve giữa bộ harness/model khác. KG nối issue/PR với code, không chỉ dependency. |
| **Code Isn’t Memory (2026)** | Cùng SuperCoder harness, Claude Opus 4.7, 91 task Go/Java/Python, 3 seed. Structural hybrid index ON/OFF: acc@5 44.3 → 84.5% (p<.0001), resolve 41.9 → 50.4% (p=.003), cost/cell không khác có ý nghĩa, $/solve thấp hơn. Đối chứng OpenCode grep: resolve 50.4 vs 45.3% (p=.087); acc@5 84.5 vs 75.3% (p=.080). | Causal ablation index mạnh nhất, nhưng index = semantic + lexical + call graph; preprint, n nhỏ, tác giả liên quan harness. Đối chứng grep khác harness và chưa đạt ý nghĩa thống kê. |
| **Codebase-Memory paper (2026)** | 31 repo/ngôn ngữ; MCP graph quality 0.83 vs grep/read 0.92, ~1k vs 10k tokens/câu, 2.3 vs 4.8 calls. Graph thắng hub/caller ranking ở 19/31 ngôn ngữ; explorer thắng full-source/exhaustive call-site grep. Macro-heavy C 0.58 vs 1.00. | Tác giả thứ nhất tự chấm 12 dạng câu hỏi; structural QA, không phải fix issue. Tốt để xác định query graph hữu ích, không chứng minh end-to-end resolve. |
| **Deep Agentic Search vs semantic search (2026)** | SWE-QA, 720 câu/15 repo/4 model: vector semantic search đúng 65.2%, agentic grep/subagent 46.2%; mỗi câu đúng dưới nửa cost. | QA không phải repair; không có graph arm. Chứng tỏ vector retrieval cũng có thể vượt agentic grep tùy workload. |
| **Agentless (đối chứng)** | Hierarchical file → class/function → edit location, không để LLM quyết định tool loop; SWE-bench Lite 32%, 96 fixes, ~$0.70 theo paper. | Graph không phải điều kiện cần để baseline tốt. |
| **Aider repo-map** | Tree-sitter definitions/references + personalized PageRank, signature map tự thêm vào prompt, budget mặc định khoảng 1k token nhưng soft/query-aware. | Chưa thấy ablation SWE-bench riêng bật/tắt map. Điểm Aider end-to-end không phải graph delta. |

Nguồn: [RepoGraph ICLR 2025](https://proceedings.iclr.cc/paper_files/paper/2025/file/4a4a3c197deac042461c677219efd36c-Paper-Conference.pdf), [LocAgent ACL 2025](https://aclanthology.org/2025.acl-long.426/), [OrcaLoca](https://arxiv.org/abs/2502.00350), [KGCompass](https://arxiv.org/abs/2503.21710), [Code Isn’t Memory](https://arxiv.org/abs/2606.22417), [Codebase-Memory](https://arxiv.org/abs/2603.27277), [Deep Agentic Search](https://arxiv.org/abs/2608.01507), [Agentless](https://arxiv.org/abs/2407.01489), [Aider map](https://aider.chat/2023/10/22/repomap.html).

## Dự án agent-facing: metadata và evidence

| Dự án | URL; license; stars; commit gần nhất | Ngôn ngữ / cách dùng | Evidence of real value |
|---|---|---|---|
| Aider repo-map | [repo](https://github.com/Aider-AI/aider); Apache-2.0; 50.1k; commit chưa kiểm | CLI; ~100 Tree-sitter tag grammars; PageRank-ranked signatures được prompt inject, personalized theo query. | Production integration mạnh; benchmark repo-map cô lập chưa thấy. |
| Serena | [repo](https://github.com/oraios/serena); MIT; 31.3k; 28-10-2026 theo trang project | Python MCP + LSP/JetBrains; >40 ngôn ngữ tùy server; symbol/references/implementations, outline, rename/edit. | Chưa thấy matched resolve/token benchmark; tác dụng semantic navigation có thể dùng ngay nhưng uplift chưa kiểm. |
| code-graph-rag | [repo](https://github.com/vitali87/code-graph-rag); MIT; 5.4k; push 08-11-2026 | Python CLI/MCP; Tree-sitter, Memgraph/Cypher, LLM NL-query/edit. | Benchmark độc lập/resolve chưa kiểm; stars/releases không chứng minh gain. |
| CodeGraphContext | [repo](https://github.com/CodeGraphContext/CodeGraphContext); MIT; 4.4k; push 22-10-2026 | Python CLI, MCP, UI; Tree-sitter hoặc SCIP; call chain/hierarchy; watcher; embedded DB/Neo4j/FalkorDB/Kuzu. | Chưa thấy đối chứng resolve; mô tả accurate context chưa có số đo kiểm chứng. |
| GitNexus | [repo](https://github.com/abhigyanpatwari/GitNexus); license và commit chưa kiểm (README nói có điều kiện thương mại); 48.5k | TypeScript/JavaScript trọng tâm; Tree-sitter/LadybugDB; CLI, MCP, UI, skills/hooks; impact/clusters/call graph. | Có workflow bench trong repo nhưng resolve độc lập chưa kiểm; token claims chưa xác minh. Rà license trước reuse. |
| Codebase-Memory MCP | [repo](https://github.com/DeusData/codebase-memory-mcp); MIT theo README; ~47k; commit chưa kiểm | Native C/SQLite; paper 66 grammars, README hiện nói 158; 14 MCP tools; watcher + XXH3 hash; LSP/type resolution lai. | Paper: quality 83 vs 92%, ~10x ít token, 2.1x ít calls; tác giả tự chấm structural QA. Version/paper/repo khác nhau cả language count. |
| CodexGraph | [demo repo](https://github.com/modelscope/modelscope-agent/tree/master/apps/codexgraph_agent); MIT; stars/commit chưa kiểm | Python, graph DB, static analysis + agent-generated Cypher. | NAACL 2025 thử CrossCodeEval/SWE-bench/EvoCodeBench; “competitive”, graph-only resolve delta chưa kiểm. Cypher generation có thể lỗi/loop. |
| LocAgent | [repo](https://github.com/gersteinlab/LocAgent); license/commit chưa kiểm; 641 stars | Python SWE-bench; heterogeneous file/class/function graph, agent multi-hop. | 92.7% localization, Pass@10 +12% theo ACL 2025; không cô lập graph khỏi tuning/workflow. |
| OrcaLoca | [paper](https://arxiv.org/abs/2502.00350); repo/license/stars chưa kiểm | Python SWE-bench agent; CodeGraph API, priority queue, decomposition/pruning. | 65.33% function match, 41% resolve; ablation 3–5pt. |
| KGCompass | [paper](https://arxiv.org/abs/2503.21710); repo/license/stars chưa kiểm | Language-agnostic KG files/classes/functions + issue/PR; incremental/path-guided. | 45.67% resolve, $0.20/repair; tự báo cáo paper. |
| CodeRAG, EMNLP 2025 | [paper](https://aclanthology.org/2025.emnlp-main.1187/); repo/license/stars chưa kiểm | Retrieval tìm relevant/necessary knowledge cho repo-level completion, không đồng nghĩa dependency graph. | Completion/retrieval, không phải issue resolve; số cụ thể chưa kiểm trong nguồn mở. Không dùng làm bằng chứng graph thắng embeddings. |
| Sourcegraph Cody + SCIP | [SCIP docs](https://sourcegraph.com/docs/code-navigation/writing-an-indexer); Cody thương mại, SCIP tools Apache-2.0; sao/commit nhiều repo chưa kiểm | IDE/web/agent; compiler-specific SCIP definition/reference xuyên file/repo. | Shipping code navigation là evidence capability; Cody resolution ablation chưa thấy. |
| Cursor indexing | [docs](https://docs.cursor.com/context/codebase-indexing); proprietary; N/A | IDE; embeddings trên chunks, cache/index, semantic retrieval và ignore. | Product adoption; indexing ON/OFF matched resolution chưa kiểm. |
| Continue | [repo](https://github.com/continuedev/continue); Apache-2.0; ~30k; commit chưa kiểm | VS Code/JetBrains; background embeddings + FTS/chunk retrieval SQLite/LanceDB, repo-map signatures. | Docs index/reload/ignore, chưa thấy resolve ablation. |
| Cline | [repo](https://github.com/cline/cline); Apache-2.0; stars/commit chưa kiểm | IDE agent; ripgrep/filesystem on demand, no vector index default. | Maintainer rationale stale-index/ingestion; không phải benchmark chứng minh grep hơn. |
| Claude Code | [Anthropic guide](https://claude.com/resources/articles/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start); proprietary; N/A | Local glob/grep/read + CLAUDE.md preloaded; subagents/MCP/LSP optional; không bắt buộc repo index. | Anthropic ưu tiên live filesystem vì index tập trung stale, đồng thời nói runtime search chậm và cần context/heuristics. Rationale/vendor experience, không phải ablation. |

“Chưa kiểm” nghĩa là không xác minh được, không có nghĩa dự án không có. Star chỉ là adoption. Snapshot GitHub trực tiếp: [Aider](https://github.com/Aider-AI/aider), [Serena](https://github.com/oraios/serena), [GitNexus](https://github.com/abhigyanpatwari/GitNexus), [Code-Graph-RAG](https://github.com/vitali87/code-graph-rag), [CodeGraphContext](https://github.com/CodeGraphContext/CodeGraphContext), [LocAgent](https://github.com/gersteinlab/LocAgent).

## Trả lời câu hỏi thiết kế

### Graph, embeddings, agentic grep; granularity và hubs

- Graph trên SWE-bench tăng localization ổn định hơn resolve: RepoGraph +2–2.34 điểm resolve, +2.3–5.6 localization. Ablation structural hybrid 2026 +8.5 điểm resolve/+40.2 acc@5 đáng để Onni kiểm tra, nhưng mẫu nhỏ và preprint.
- Semantic search thắng deep agentic search trên SWE-QA 65.2 vs 46.2; graph tốt hơn grep/read cho hub/caller/multi-hop structural QA. Workload quyết định winner.
- Dùng file/module để khoanh vùng; symbol-level file/class/function cho function selection, refactor và call traversal. Line/patch correctness vẫn cần agent đọc nguồn/test. Top-k file localization không phải fix success.
- Hub: personalized PageRank theo prompt (Aider), không degree toàn cục; giới hạn 1–2 hop, dedupe, group file/module, bỏ generated/vendor, trả signature + line range cho file lớn. RepoGraph cho thấy flatten graph quá rộng làm giảm resolve. Summary có thể giúp hoặc làm mất chi tiết.
- Budget phải có trạng thái đầy đủ/truncated và pagination. Benchmark độc lập của MCP graph ghi nhận cap output khiến một tác vụ 7 turns thành 18 và input 267k → 708k tokens (case study tác giả); không cắt lặng lẽ.

### MCP, CLI, pre-injected map

- RepoGraph dùng cả context injection cho Agentless và action search_repograph cho SWE-agent/AutoCodeRover; Codebase-Memory dùng MCP typed tools. Không có bằng chứng MCP protocol tốt hơn CLI/API với cùng output.
- Pre-injected map giúp orientation nhưng trả phí mỗi task và stale trong session; query tool chỉ trả khi cần. Agent cũng có thể không gọi tool nếu tool-list dài hoặc instructions mơ hồ.
- Onni nên bắt đầu typed CLI dùng được với mọi runner; output có path/line/provenance/budget/completeness và fallback grep/read. MCP adapter tùy chọn. Tiêm map nhỏ chỉ cho task multi-file/path uncertain, không dump toàn graph.

### Freshness

- Claude Code đọc filesystem live để tránh stale index; đổi lại tốn lượt. Codebase-Memory mô tả watcher + content-hash incremental; CodeGraphContext có watch; git hash xác nhận snapshot nhưng không tự bắt edit chưa commit tức thời.
- Baseline: hash/file + parser version + git HEAD; validate trước query, atomic incremental update; stale thì báo và fallback grep. Rename/delete, inbound refs sau signature change, branch checkout, generated files, watcher overflow, ignore/symlink, restart phải kiểm.
- Chưa có bằng chứng watcher hoàn hảo. Đo latency/correctness trước khi bật mặc định; lazy hash validation là MVP dễ kiểm hơn.

### Ngôn ngữ và parser

- Tree-sitter rộng, nhanh, incremental/error-tolerant, hợp symbol/import baseline đa ngôn ngữ. Nó không tự phân giải type/dynamic dispatch/macro; macro-heavy C là ví dụ hỏng.
- TS compiler/LSP/SCIP chính xác hơn trong ngôn ngữ có toolchain nhưng tốn config/version/resource, không nên bắt buộc khi startup.
- Dùng Tree-sitter cho file/module/import/definitions; edge có provenance extracted/declared/inferred + confidence. LSP/compiler adapter opt-in, timeout, không bịa call edge. Agent đọc source khi uncertain.

## Nguồn bổ sung

- [Aider repo map](https://aider.chat/2023/10/22/repomap.html), [map docs](https://aider.chat/docs/repomap.html), [language tags](https://aider.chat/docs/languages.html).
- [Anthropic large-codebase guide, 2026-05-14](https://claude.com/resources/articles/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start), [context engineering](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents).
- [Cursor indexing](https://docs.cursor.com/context/codebase-indexing), [Continue index](https://docs.continue.dev/reference/deprecated-codebase), [Cline rationale](https://cline.ghost.io/why-cline-doesnt-index-your-codebase-and-why-thats-a-good-thing/).
- [CodexGraph NAACL 2025](https://aclanthology.org/2025.naacl-long.7/), [CodeRAG EMNLP 2025](https://aclanthology.org/2025.emnlp-main.1187/), [SCIP indexers](https://sourcegraph.com/docs/code-navigation/writing-an-indexer).
- [252 headless Claude runs: MCP graph vs Read/Grep](https://github.com/nefayran/claude-code-token-bench), author-built, not peer-reviewed: small repos showed no significant savings; on a large repo Sonnet had equal accuracy but grep cheaper on 11/12 questions. Directional counterexample only.

## Bài học cho OnniCode

1. **Thêm evaluation gate trước giai đoạn 3 agent/manager.** Cùng model/prompt/commit so graph-off, graph-on, native grep; task multi-file thật, nhiều seed. Đo resolve/pass@1, localization file/function, tokens, turns, wall time, stale incidents. Chỉ tiếp tục nếu localization tăng mà resolve/cost không hồi quy.
2. **Hybrid query + fallback.** Graph cho relation/path/impact; grep exact/exhaustive; source read để sửa. Trả provenance, confidence, line và completeness.
3. **Copy Aider/RepoGraph về personalized ranking và subgraph budget.** Signature outline trước, tối đa 1–2 hop, group hubs, dedupe, paginate; tránh full graph/flatten dày.
4. **File/module trước rồi symbol, không dừng ở file-only.** Nghiên cứu hỗ trợ multi-hop; line/patch vẫn cần đọc source và tests.
5. **Freshness là correctness.** Hash validation + atomic incremental update trước watcher; lỗi/stale thì fallback.
6. **Tree-sitter breadth mặc định, LSP/compiler depth tùy chọn.** Spike TS semantic riêng, giữ schema đa ngôn ngữ và degrade.
7. **Chưa mặc định embeddings/LLM summary.** Có giá trị cho paraphrase, đôi lúc summary gây hại; thêm khi eval Onni vượt graph+grep.
8. **Tách adoption khỏi efficacy.** Aider map và IDE embeddings chứng minh ship/adoption, không chứng minh resolve gain. Đừng quảng bá token savings đến khi đo đủ calls, retry/truncation và patch quality.
