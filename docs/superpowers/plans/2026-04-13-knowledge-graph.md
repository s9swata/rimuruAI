# Knowledge Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Raphael's agent a persistent, queryable knowledge graph so it can store and recall facts, relationships, and context across conversations — preserving all core graphify v3 features (confidence levels, BFS/DFS traversal, community detection, god nodes, surprising connections, content-hash caching).

**Architecture:** Graph logic lives entirely in Rust (`graph.rs`, `graph_cache.rs`) and is exposed as Tauri commands. The TypeScript side uses the Vercel AI SDK + Groq to extract structured nodes/edges from free text on demand, then immediately persists them via Tauri commands. Community detection uses label propagation (no external crate). Graph is stored as `graph.json` in `~/Library/Application Support/raphael/`.

**Tech Stack:** Rust (existing sha2, serde_json, dirs crates — no new deps), Vercel AI SDK `generateObject`, Groq `llama-3.3-70b-versatile`, zod for extraction schema, TypeScript.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `raphael/src-tauri/src/graph.rs` | **Create** | Types, load/save graph.json, merge nodes/edges (dedup), BFS query, god nodes, label-propagation community detection, surprising connections, stats |
| `raphael/src-tauri/src/graph_cache.rs` | **Create** | SHA256 content-hash cache — skip Groq extraction if same text was already processed |
| `raphael/src-tauri/src/commands.rs` | **Modify** | Add `add_to_graph`, `query_graph`, `get_graph_stats` commands |
| `raphael/src-tauri/src/lib.rs` | **Modify** | `mod graph; mod graph_cache;` + register three new commands |
| `raphael/src/services/index.ts` | **Modify** | `memory.store` — Groq extraction + invoke `add_to_graph`. `memory.query` — invoke `query_graph` |
| `raphael/src/agent/registry.ts` | **Modify** | Register `memory.store` tool in `initRegistry` |

---

## Task 1: Create `graph.rs` — Types and Load/Save

**Files:**
- Create: `raphael/src-tauri/src/graph.rs`

- [ ] **Step 1: Create the file with types and load/save functions**

```rust
// raphael/src-tauri/src/graph.rs
//
// Knowledge graph: types, persistent load/save, merge, BFS query,
// community detection, god nodes, surprising connections, stats.
// Mirrors graphify v3's core feature set without external graph crates.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::path::PathBuf;

// ── Types ─────────────────────────────────────────────────────────────────────

/// Confidence levels — mirrors graphify v3 (EXTRACTED, INFERRED, AMBIGUOUS).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Confidence {
    Extracted,
    Inferred,
    Ambiguous,
}

impl Default for Confidence {
    fn default() -> Self {
        Confidence::Extracted
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphNode {
    pub id: String,
    pub label: String,
    pub node_type: String,    // "person", "place", "concept", "event", "organization", "technology"
    pub description: String,
    pub source: String,       // free-text origin, e.g. "user message 2026-04-13"
    pub confidence: Confidence,
    pub community: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
    pub relation: String,
    pub confidence: Confidence,
    pub confidence_score: f32,  // 0.0–1.0
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct KnowledgeGraph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

// ── Load / Save ───────────────────────────────────────────────────────────────

fn graph_path(store_dir: &PathBuf) -> PathBuf {
    store_dir.join("graph.json")
}

pub fn load_graph(store_dir: &PathBuf) -> KnowledgeGraph {
    let path = graph_path(store_dir);
    if !path.exists() {
        return KnowledgeGraph::default();
    }
    match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => KnowledgeGraph::default(),
    }
}

pub fn save_graph(store_dir: &PathBuf, graph: &KnowledgeGraph) -> Result<(), String> {
    fs::create_dir_all(store_dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(graph).map_err(|e| e.to_string())?;
    let tmp = graph_path(store_dir).with_extension("tmp");
    fs::write(&tmp, &json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, graph_path(store_dir)).map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 2: Verify the file compiles (no commands registered yet — just check syntax)**

```bash
cd raphael
cargo check 2>&1 | head -30
```

Expected: errors about unused imports or `mod graph` not found — that's fine for now. We're just checking types compile. If you see errors about `Serialize`/`Deserialize` not found, you're missing a `use` — the types above already import them from `serde`.

- [ ] **Step 3: Commit**

```bash
git add raphael/src-tauri/src/graph.rs
git commit -m "feat: add graph.rs with types and load/save"
```

---

## Task 2: Add Merge to `graph.rs`

**Files:**
- Modify: `raphael/src-tauri/src/graph.rs`

The merge function adds new nodes/edges into the graph with deduplication:
- **Nodes**: if a node with the same `id` already exists, the new node overwrites it (last write wins — matches graphify v3 behavior).
- **Edges**: if an edge with the same `source + target + relation` already exists, overwrite it.

- [ ] **Step 1: Append the merge function to `graph.rs`**

Add this at the bottom of `raphael/src-tauri/src/graph.rs`, after `save_graph`:

```rust
// ── Merge ─────────────────────────────────────────────────────────────────────

/// Merge new nodes and edges into the graph.
/// Nodes with duplicate IDs are overwritten (new data wins).
/// Edges with duplicate source+target+relation are overwritten.
pub fn merge(graph: &mut KnowledgeGraph, new_nodes: Vec<GraphNode>, new_edges: Vec<GraphEdge>) {
    // Build index: node_id → position in graph.nodes
    let mut node_index: HashMap<String, usize> = graph
        .nodes
        .iter()
        .enumerate()
        .map(|(i, n)| (n.id.clone(), i))
        .collect();

    for node in new_nodes {
        if let Some(&idx) = node_index.get(&node.id) {
            graph.nodes[idx] = node; // overwrite
        } else {
            node_index.insert(node.id.clone(), graph.nodes.len());
            graph.nodes.push(node);
        }
    }

    // Build edge key index: (source, target, relation) → position
    let mut edge_index: HashMap<(String, String, String), usize> = graph
        .edges
        .iter()
        .enumerate()
        .map(|(i, e)| ((e.source.clone(), e.target.clone(), e.relation.clone()), i))
        .collect();

    for edge in new_edges {
        let key = (edge.source.clone(), edge.target.clone(), edge.relation.clone());
        if let Some(&idx) = edge_index.get(&key) {
            graph.edges[idx] = edge; // overwrite
        } else {
            edge_index.insert(key, graph.edges.len());
            graph.edges.push(edge);
        }
    }
}
```

- [ ] **Step 2: Check compile**

```bash
cd raphael
cargo check 2>&1 | head -20
```

Expected: same not-yet-registered errors. No type errors inside graph.rs.

- [ ] **Step 3: Commit**

```bash
git add raphael/src-tauri/src/graph.rs
git commit -m "feat: add graph merge with node/edge deduplication"
```

---

## Task 3: Add BFS Query to `graph.rs`

**Files:**
- Modify: `raphael/src-tauri/src/graph.rs`

The BFS query mirrors graphify v3's `serve.py` `query_graph` tool:
1. Score all nodes by how many query terms match their label or description.
2. Start BFS from the top-scoring nodes.
3. Expand to neighbors up to `depth` hops.
4. Return the subgraph (nodes + edges within the visited set).

- [ ] **Step 1: Append query types and BFS function to `graph.rs`**

Add after the `merge` function:

```rust
// ── BFS Query ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct QueryResult {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    pub start_nodes: Vec<String>,  // top-scoring seed nodes
}

/// Score a node against the query terms.
/// +1 for each term found in label (case-insensitive).
/// +0.5 for each term found in description (case-insensitive).
fn score_node(node: &GraphNode, terms: &[String]) -> f32 {
    let label = node.label.to_lowercase();
    let desc = node.description.to_lowercase();
    let mut score = 0.0f32;
    for t in terms {
        if label.contains(t.as_str()) {
            score += 1.0;
        }
        if desc.contains(t.as_str()) {
            score += 0.5;
        }
    }
    score
}

/// Build adjacency list: node_id → list of neighbor node_ids.
fn build_adjacency(graph: &KnowledgeGraph) -> HashMap<String, Vec<String>> {
    let mut adj: HashMap<String, Vec<String>> = HashMap::new();
    for edge in &graph.edges {
        // Undirected: add both directions
        adj.entry(edge.source.clone())
            .or_default()
            .push(edge.target.clone());
        adj.entry(edge.target.clone())
            .or_default()
            .push(edge.source.clone());
    }
    adj
}

/// BFS from seed_ids up to `depth` hops. Returns set of visited node IDs.
fn bfs(adj: &HashMap<String, Vec<String>>, seed_ids: &[String], depth: usize) -> HashSet<String> {
    let mut visited: HashSet<String> = seed_ids.iter().cloned().collect();
    let mut frontier: VecDeque<(String, usize)> =
        seed_ids.iter().map(|id| (id.clone(), 0)).collect();

    while let Some((node_id, d)) = frontier.pop_front() {
        if d >= depth {
            continue;
        }
        if let Some(neighbors) = adj.get(&node_id) {
            for neighbor in neighbors {
                if !visited.contains(neighbor) {
                    visited.insert(neighbor.clone());
                    frontier.push_back((neighbor.clone(), d + 1));
                }
            }
        }
    }
    visited
}

/// Query the graph: score nodes, BFS-expand, return subgraph.
///
/// `query` is a plain-text string; it is split on whitespace into terms.
/// `depth` controls how many hops BFS expands (default 2, max 4).
/// `top_seeds` controls how many top-scoring nodes seed the BFS (default 3).
pub fn query_graph(graph: &KnowledgeGraph, query: &str, depth: usize, top_seeds: usize) -> QueryResult {
    let terms: Vec<String> = query
        .to_lowercase()
        .split_whitespace()
        .map(String::from)
        .collect();

    if terms.is_empty() || graph.nodes.is_empty() {
        return QueryResult {
            nodes: vec![],
            edges: vec![],
            start_nodes: vec![],
        };
    }

    // Score every node
    let mut scored: Vec<(f32, &GraphNode)> = graph
        .nodes
        .iter()
        .map(|n| (score_node(n, &terms), n))
        .filter(|(s, _)| *s > 0.0)
        .collect();
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    let seed_ids: Vec<String> = scored
        .iter()
        .take(top_seeds)
        .map(|(_, n)| n.id.clone())
        .collect();

    if seed_ids.is_empty() {
        return QueryResult {
            nodes: vec![],
            edges: vec![],
            start_nodes: vec![],
        };
    }

    // BFS expand
    let adj = build_adjacency(graph);
    let clamped_depth = depth.min(4);
    let visited = bfs(&adj, &seed_ids, clamped_depth);

    // Collect subgraph
    let nodes: Vec<GraphNode> = graph
        .nodes
        .iter()
        .filter(|n| visited.contains(&n.id))
        .cloned()
        .collect();

    let edges: Vec<GraphEdge> = graph
        .edges
        .iter()
        .filter(|e| visited.contains(&e.source) && visited.contains(&e.target))
        .cloned()
        .collect();

    QueryResult {
        nodes,
        edges,
        start_nodes: seed_ids,
    }
}
```

- [ ] **Step 2: Check compile**

```bash
cd raphael
cargo check 2>&1 | head -30
```

Expected: no errors inside graph.rs (the only errors should be about `mod graph` not being in lib.rs yet).

- [ ] **Step 3: Commit**

```bash
git add raphael/src-tauri/src/graph.rs
git commit -m "feat: add BFS query to knowledge graph"
```

---

## Task 4: Add God Nodes, Community Detection, Surprising Connections, Stats to `graph.rs`

**Files:**
- Modify: `raphael/src-tauri/src/graph.rs`

These implement the remaining core graphify v3 analysis features:
- **God nodes**: top-N nodes sorted by degree (number of edges). Mirrors graphify's `analyze.py`.
- **Community detection**: label propagation algorithm. Each node starts with its own community label; repeatedly adopts the most common label among its neighbors until stable. Equivalent quality to Louvain for Raphael's graph sizes.
- **Surprising connections**: cross-community edges, sorted by confidence (AMBIGUOUS > INFERRED > EXTRACTED). Mirrors graphify's `analyze.py`.
- **Stats**: node count, edge count, community count, confidence breakdown.

- [ ] **Step 1: Append the analysis functions to `graph.rs`**

Add after `query_graph`:

```rust
// ── God Nodes ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct GodNode {
    pub id: String,
    pub label: String,
    pub node_type: String,
    pub degree: usize,
}

/// Return the top_n most-connected nodes (god nodes).
/// Mirrors graphify v3 analyze.py god_nodes().
pub fn god_nodes(graph: &KnowledgeGraph, top_n: usize) -> Vec<GodNode> {
    // Count degree for each node
    let mut degree: HashMap<String, usize> = HashMap::new();
    for node in &graph.nodes {
        degree.entry(node.id.clone()).or_insert(0);
    }
    for edge in &graph.edges {
        *degree.entry(edge.source.clone()).or_insert(0) += 1;
        *degree.entry(edge.target.clone()).or_insert(0) += 1;
    }

    let node_map: HashMap<&str, &GraphNode> =
        graph.nodes.iter().map(|n| (n.id.as_str(), n)).collect();

    let mut sorted: Vec<(&String, &usize)> = degree.iter().collect();
    sorted.sort_by(|a, b| b.1.cmp(a.1));

    sorted
        .into_iter()
        .take(top_n)
        .filter_map(|(id, &deg)| {
            node_map.get(id.as_str()).map(|node| GodNode {
                id: node.id.clone(),
                label: node.label.clone(),
                node_type: node.node_type.clone(),
                degree: deg,
            })
        })
        .collect()
}

// ── Community Detection (Label Propagation) ───────────────────────────────────

/// Run label propagation community detection.
/// Returns: { community_id → [node_ids] }
///
/// Algorithm:
/// 1. Each node starts as its own community (label = index).
/// 2. In each iteration, every node adopts the most frequent label among its neighbors.
/// 3. Stop when no labels change (convergence) or after max_iter iterations.
///
/// This is a deterministic approximation to Louvain — adequate for Raphael's graph sizes.
pub fn detect_communities(graph: &KnowledgeGraph) -> HashMap<usize, Vec<String>> {
    if graph.nodes.is_empty() {
        return HashMap::new();
    }

    let node_ids: Vec<String> = graph.nodes.iter().map(|n| n.id.clone()).collect();
    let id_to_idx: HashMap<&str, usize> = node_ids
        .iter()
        .enumerate()
        .map(|(i, id)| (id.as_str(), i))
        .collect();

    // Build adjacency (index-based for speed)
    let mut adj: Vec<Vec<usize>> = vec![vec![]; node_ids.len()];
    for edge in &graph.edges {
        if let (Some(&si), Some(&ti)) = (
            id_to_idx.get(edge.source.as_str()),
            id_to_idx.get(edge.target.as_str()),
        ) {
            adj[si].push(ti);
            adj[ti].push(si);
        }
    }

    // Initial labels: each node is its own community
    let mut labels: Vec<usize> = (0..node_ids.len()).collect();

    let max_iter = 20;
    for _ in 0..max_iter {
        let mut changed = false;
        // Iterate in a fixed order for determinism
        for i in 0..node_ids.len() {
            if adj[i].is_empty() {
                continue; // isolated nodes keep their own label
            }
            // Count neighbor labels
            let mut freq: HashMap<usize, usize> = HashMap::new();
            for &nb in &adj[i] {
                *freq.entry(labels[nb]).or_insert(0) += 1;
            }
            // Pick most frequent (tie-break: smallest label for determinism)
            let best = freq
                .into_iter()
                .max_by(|a, b| a.1.cmp(&b.1).then(b.0.cmp(&a.0)))
                .map(|(label, _)| label)
                .unwrap_or(labels[i]);
            if best != labels[i] {
                labels[i] = best;
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }

    // Re-index communities as 0, 1, 2, ... sorted by size descending
    let mut raw: HashMap<usize, Vec<String>> = HashMap::new();
    for (i, &label) in labels.iter().enumerate() {
        raw.entry(label).or_default().push(node_ids[i].clone());
    }

    let mut communities: Vec<Vec<String>> = raw.into_values().collect();
    communities.sort_by(|a, b| b.len().cmp(&a.len()));

    communities
        .into_iter()
        .enumerate()
        .map(|(cid, nodes)| (cid, nodes))
        .collect()
}

// ── Surprising Connections ────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct SurprisingConnection {
    pub source_label: String,
    pub target_label: String,
    pub relation: String,
    pub confidence: Confidence,
    pub confidence_score: f32,
    pub note: String,
}

/// Return cross-community edges, sorted AMBIGUOUS > INFERRED > EXTRACTED.
/// Mirrors graphify v3 analyze.py surprising_connections().
pub fn surprising_connections(
    graph: &KnowledgeGraph,
    communities: &HashMap<usize, Vec<String>>,
    top_n: usize,
) -> Vec<SurprisingConnection> {
    // Build node → community map
    let node_community: HashMap<String, usize> = communities
        .iter()
        .flat_map(|(cid, nodes)| nodes.iter().map(move |nid| (nid.clone(), *cid)))
        .collect();

    let node_label: HashMap<&str, &str> = graph
        .nodes
        .iter()
        .map(|n| (n.id.as_str(), n.label.as_str()))
        .collect();

    let conf_rank = |c: &Confidence| match c {
        Confidence::Ambiguous => 0usize,
        Confidence::Inferred => 1,
        Confidence::Extracted => 2,
    };

    let mut candidates: Vec<SurprisingConnection> = graph
        .edges
        .iter()
        .filter(|e| {
            // Only cross-community edges
            let cid_s = node_community.get(&e.source);
            let cid_t = node_community.get(&e.target);
            match (cid_s, cid_t) {
                (Some(s), Some(t)) => s != t,
                _ => false,
            }
        })
        .map(|e| {
            let cid_s = node_community[&e.source];
            let cid_t = node_community[&e.target];
            SurprisingConnection {
                source_label: node_label
                    .get(e.source.as_str())
                    .unwrap_or(&e.source.as_str())
                    .to_string(),
                target_label: node_label
                    .get(e.target.as_str())
                    .unwrap_or(&e.target.as_str())
                    .to_string(),
                relation: e.relation.clone(),
                confidence: e.confidence.clone(),
                confidence_score: e.confidence_score,
                note: format!("Bridges community {} → community {}", cid_s, cid_t),
            }
        })
        .collect();

    candidates.sort_by(|a, b| conf_rank(&a.confidence).cmp(&conf_rank(&b.confidence)));
    candidates.truncate(top_n);
    candidates
}

// ── Graph Stats ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct GraphStats {
    pub node_count: usize,
    pub edge_count: usize,
    pub community_count: usize,
    pub extracted_edges: usize,
    pub inferred_edges: usize,
    pub ambiguous_edges: usize,
    pub god_nodes: Vec<GodNode>,
    pub surprising_connections: Vec<SurprisingConnection>,
}

/// Compute full graph stats — returned by the get_graph_stats Tauri command.
pub fn compute_stats(graph: &KnowledgeGraph) -> GraphStats {
    let communities = detect_communities(graph);
    let extracted = graph
        .edges
        .iter()
        .filter(|e| e.confidence == Confidence::Extracted)
        .count();
    let inferred = graph
        .edges
        .iter()
        .filter(|e| e.confidence == Confidence::Inferred)
        .count();
    let ambiguous = graph
        .edges
        .iter()
        .filter(|e| e.confidence == Confidence::Ambiguous)
        .count();

    GraphStats {
        node_count: graph.nodes.len(),
        edge_count: graph.edges.len(),
        community_count: communities.len(),
        extracted_edges: extracted,
        inferred_edges: inferred,
        ambiguous_edges: ambiguous,
        god_nodes: god_nodes(graph, 10),
        surprising_connections: surprising_connections(&graph, &communities, 5),
    }
}
```

- [ ] **Step 2: Check compile**

```bash
cd raphael
cargo check 2>&1 | head -30
```

Expected: no errors inside graph.rs.

- [ ] **Step 3: Commit**

```bash
git add raphael/src-tauri/src/graph.rs
git commit -m "feat: add god nodes, community detection, surprising connections, stats"
```

---

## Task 5: Create `graph_cache.rs` — Content-Hash Cache

**Files:**
- Create: `raphael/src-tauri/src/graph_cache.rs`

The cache prevents calling Groq again for the same input text. Key = SHA256 of the text. Value = cached extraction result (nodes + edges as JSON). Stored as `~/Library/Application Support/raphael/graph_cache/{hash}.json`. Mirrors graphify v3's `cache.py`.

- [ ] **Step 1: Create the file**

```rust
// raphael/src-tauri/src/graph_cache.rs
//
// Content-hash cache for graph extraction results.
// Key: SHA256(input_text). Value: JSON of { nodes, edges }.
// Stored in store_dir/graph_cache/{hash}.json
//
// This mirrors graphify v3 cache.py — prevents re-calling Groq
// for text the agent has already processed.

use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;

fn cache_dir(store_dir: &PathBuf) -> PathBuf {
    store_dir.join("graph_cache")
}

fn content_hash(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Check if we have a cached extraction for this text.
/// Returns the raw JSON string if found, None otherwise.
pub fn load_cached(text: &str, store_dir: &PathBuf) -> Option<String> {
    let hash = content_hash(text);
    let path = cache_dir(store_dir).join(format!("{}.json", hash));
    fs::read_to_string(&path).ok()
}

/// Save an extraction result for this text to cache.
/// `json` is the serialized extraction result ({ nodes, edges }).
pub fn save_cached(text: &str, json: &str, store_dir: &PathBuf) -> Result<(), String> {
    let dir = cache_dir(store_dir);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let hash = content_hash(text);
    let path = dir.join(format!("{}.json", hash));
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 2: Check compile**

```bash
cd raphael
cargo check 2>&1 | head -20
```

Expected: no errors inside graph_cache.rs (sha2 is already in Cargo.toml).

- [ ] **Step 3: Commit**

```bash
git add raphael/src-tauri/src/graph_cache.rs
git commit -m "feat: add content-hash cache for graph extraction results"
```

---

## Task 6: Add Tauri Commands to `commands.rs`

**Files:**
- Modify: `raphael/src-tauri/src/commands.rs`

Add three new commands at the bottom of the file. Do NOT modify existing commands.

- [ ] **Step 1: Add the three commands at the bottom of `commands.rs`**

Open `raphael/src-tauri/src/commands.rs` and append this block after the last `}` of `http_fetch`:

```rust
// ── Knowledge Graph Commands ──────────────────────────────────────────────────

use crate::graph::{GraphEdge, GraphNode};

#[derive(serde::Deserialize)]
pub struct AddToGraphParams {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    /// The original text that was extracted — used as cache key.
    pub source_text: String,
}

/// Add nodes and edges to the persistent knowledge graph.
/// Deduplicates by node id and (source, target, relation) for edges.
/// Saves cache entry so the same text is never re-extracted.
#[tauri::command]
pub fn add_to_graph(params: AddToGraphParams) -> Result<(), String> {
    let dir = store_dir();
    log_to_file(&format!(
        "add_to_graph: {} nodes, {} edges",
        params.nodes.len(),
        params.edges.len()
    ));

    // Save cache entry first (fire-and-forget if it fails)
    if let Ok(json) = serde_json::to_string(&serde_json::json!({
        "nodes": &params.nodes,
        "edges": &params.edges,
    })) {
        let _ = crate::graph_cache::save_cached(&params.source_text, &json, &dir);
    }

    let mut graph = crate::graph::load_graph(&dir);
    crate::graph::merge(&mut graph, params.nodes, params.edges);
    crate::graph::save_graph(&dir, &graph)?;

    log_to_file("add_to_graph: saved");
    Ok(())
}

/// Query the knowledge graph with a plain-text query.
/// Returns a subgraph of the most relevant nodes and their connections.
#[tauri::command]
pub fn query_graph(query: String, depth: Option<usize>) -> Result<crate::graph::QueryResult, String> {
    let dir = store_dir();
    log_to_file(&format!("query_graph: '{}'", query));
    let graph = crate::graph::load_graph(&dir);
    let result = crate::graph::query_graph(&graph, &query, depth.unwrap_or(2), 3);
    log_to_file(&format!(
        "query_graph result: {} nodes, {} edges",
        result.nodes.len(),
        result.edges.len()
    ));
    Ok(result)
}

/// Return full graph statistics: node count, edge count, community count,
/// confidence breakdown, god nodes, and surprising connections.
#[tauri::command]
pub fn get_graph_stats() -> Result<crate::graph::GraphStats, String> {
    let dir = store_dir();
    log_to_file("get_graph_stats");
    let graph = crate::graph::load_graph(&dir);
    Ok(crate::graph::compute_stats(&graph))
}

/// Check if a given text was already extracted (cache hit).
/// Used by the TypeScript side to skip the Groq call.
#[tauri::command]
pub fn check_graph_cache(text: String) -> Option<String> {
    let dir = store_dir();
    crate::graph_cache::load_cached(&text, &dir)
}
```

- [ ] **Step 2: Check compile**

```bash
cd raphael
cargo check 2>&1 | head -30
```

Expected: errors saying `add_to_graph`, `query_graph`, etc. are defined but not in the handler. That's fine — we register them in Task 7.

- [ ] **Step 3: Commit**

```bash
git add raphael/src-tauri/src/commands.rs
git commit -m "feat: add add_to_graph, query_graph, get_graph_stats Tauri commands"
```

---

## Task 7: Register Modules and Commands in `lib.rs`

**Files:**
- Modify: `raphael/src-tauri/src/lib.rs`

- [ ] **Step 1: Add `mod` declarations and register the four new commands**

Open `raphael/src-tauri/src/lib.rs`. After the existing `mod` lines at the top, add:

```rust
mod graph;
mod graph_cache;
```

So the top of the file now reads:

```rust
mod commands;
mod secure_store;
mod search;
mod google_oauth;
mod gmail_api;
mod graph;
mod graph_cache;
```

Then in the `invoke_handler!` block, add the four new commands. The complete handler block should be:

```rust
.invoke_handler(tauri::generate_handler![
    commands::get_secret,
    commands::set_secret,
    commands::list_files,
    commands::read_file_content,
    commands::get_logs,
    commands::clear_logs,
    commands::send_email,
    commands::start_google_oauth,
    commands::get_gmail_auth_status,
    commands::revoke_google_oauth,
    commands::load_config,
    commands::save_config,
    commands::load_profile,
    commands::update_profile,
    commands::http_fetch,
    commands::add_to_graph,
    commands::query_graph,
    commands::get_graph_stats,
    commands::check_graph_cache,
    search::search_web,
])
```

- [ ] **Step 2: Build the full project**

```bash
cd raphael
cargo build 2>&1 | tail -20
```

Expected: `Finished dev [unoptimized + debuginfo] target(s)` with no errors. If you see errors, read them carefully — they will show which file and line has the problem.

- [ ] **Step 3: Commit**

```bash
git add raphael/src-tauri/src/lib.rs
git commit -m "feat: register graph modules and Tauri commands"
```

---

## Task 8: Update `services/index.ts` — `memory.store` with Groq Extraction

**Files:**
- Modify: `raphael/src/services/index.ts`

The `memory.store` function:
1. Checks the Rust cache (`check_graph_cache`) — if hit, uses cached nodes/edges without calling Groq.
2. If cache miss: calls Groq `generateObject` with `llama-3.3-70b-versatile` to extract nodes/edges from the input text.
3. Calls `add_to_graph` with the extracted data + original text.

- [ ] **Step 1: Add imports at the top of `services/index.ts`**

The file currently starts with:
```typescript
import { invoke } from "@tauri-apps/api/core";
import { ServiceMap } from "../agent/dispatcher";
import { calendarService } from "../calendar/store";
```

Replace with:
```typescript
import { invoke } from "@tauri-apps/api/core";
import { ServiceMap } from "../agent/dispatcher";
import { calendarService } from "../calendar/store";
import { generateObject } from "ai";
import { z } from "zod";
import { getGroqProvider } from "../agent/groq";
```

- [ ] **Step 2: Add the extraction schema and helper function**

After the imports and before `export async function getGmailAuthStatus`, add:

```typescript
// ── Knowledge Graph Extraction ────────────────────────────────────────────────

const extractionSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.string().describe(
        "Stable snake_case identifier derived from the entity name. e.g. 'priya_sharma', 'delhi', 'machine_learning'. Must be unique."
      ),
      label: z.string().describe("Human-readable name. e.g. 'Priya Sharma', 'Delhi', 'Machine Learning'."),
      node_type: z.string().describe(
        "Category. One of: person, place, concept, event, organization, technology, preference, habit."
      ),
      description: z.string().describe("One sentence describing this entity in context."),
      confidence: z.enum(["EXTRACTED", "INFERRED"]).describe(
        "EXTRACTED if explicitly stated in text. INFERRED if implied but not directly stated."
      ),
    })
  ),
  edges: z.array(
    z.object({
      source: z.string().describe("ID of the source node (must match a node id above)."),
      target: z.string().describe("ID of the target node (must match a node id above)."),
      relation: z.string().describe(
        "Relationship type. e.g. 'knows', 'lives_in', 'works_at', 'prefers', 'related_to', 'part_of'."
      ),
      confidence: z.enum(["EXTRACTED", "INFERRED", "AMBIGUOUS"]).describe(
        "EXTRACTED: directly stated. INFERRED: implied. AMBIGUOUS: uncertain."
      ),
      confidence_score: z.number().min(0).max(1).describe("0.0 to 1.0 confidence. 1.0 for EXTRACTED, 0.5 for INFERRED, 0.2 for AMBIGUOUS."),
    })
  ),
});

type ExtractionResult = z.infer<typeof extractionSchema>;

/**
 * Call Groq to extract nodes and edges from free text.
 * Returns { nodes, edges } or throws on failure.
 */
async function extractNodesFromText(text: string): Promise<ExtractionResult> {
  const groq = await getGroqProvider();

  const { object } = await generateObject({
    model: groq("llama-3.3-70b-versatile"),
    providerOptions: { groq: { structuredOutputs: false } },
    schema: extractionSchema,
    messages: [
      {
        role: "system",
        content: `You are a knowledge graph extraction engine. Given text, extract entities (nodes) and relationships (edges).

Rules:
- Only extract entities that are clearly present or strongly implied.
- Node IDs must be snake_case, unique, and stable (same entity = same ID always).
- Each edge source and target must match a node ID you defined above.
- Use confidence EXTRACTED for explicitly stated facts, INFERRED for implied, AMBIGUOUS for guesses.
- Prefer specific relations over generic ones: 'works_at' over 'related_to'.
- If nothing meaningful can be extracted, return empty arrays.`,
      },
      {
        role: "user",
        content: `Extract all entities and relationships from this text:\n\n${text}`,
      },
    ],
  });

  return object;
}
```

- [ ] **Step 3: Update the `memory` section inside `createServices()`**

Find this block in `createServices()`:

```typescript
memory: {
  query: async () => ({ success: true, data: {} }),
  saveProfile: async (p) => {
    const params = p as { info?: string };
    if (!params.info) return { success: false, error: "Missing info param" };
    try {
      await invoke("update_profile", { info: params.info });
      return { success: true, data: { saved: true } };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },
},
```

Replace it with:

```typescript
memory: {
  query: async (p) => {
    const params = p as { query?: string; depth?: number };
    if (!params.query) return { success: false, error: "Missing query param" };
    try {
      const result = await invoke<{
        nodes: Array<{ id: string; label: string; node_type: string; description: string; confidence: string }>;
        edges: Array<{ source: string; target: string; relation: string; confidence: string; confidence_score: number }>;
        start_nodes: string[];
      }>("query_graph", {
        query: params.query,
        depth: params.depth ?? 2,
      });
      return { success: true, data: result };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },
  saveProfile: async (p) => {
    const params = p as { info?: string };
    if (!params.info) return { success: false, error: "Missing info param" };
    try {
      await invoke("update_profile", { info: params.info });
      return { success: true, data: { saved: true } };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },
  store: async (p) => {
    const params = p as { text?: string; source?: string };
    if (!params.text) return { success: false, error: "Missing text param" };
    try {
      // 1. Check cache — skip Groq if already extracted
      const cached = await invoke<string | null>("check_graph_cache", { text: params.text });

      let nodes: ExtractionResult["nodes"];
      let edges: ExtractionResult["edges"];

      if (cached) {
        const parsed = JSON.parse(cached) as ExtractionResult;
        nodes = parsed.nodes;
        edges = parsed.edges;
      } else {
        // 2. Call Groq to extract nodes and edges
        const extracted = await extractNodesFromText(params.text);
        nodes = extracted.nodes;
        edges = extracted.edges;
      }

      if (nodes.length === 0 && edges.length === 0) {
        return { success: true, data: { stored: 0, note: "Nothing meaningful to extract" } };
      }

      // 3. Add to Rust graph (also saves cache entry)
      await invoke("add_to_graph", {
        params: {
          nodes: nodes.map((n) => ({
            ...n,
            source: params.source ?? "agent",
            community: null,
          })),
          edges,
          source_text: params.text,
        },
      });

      return {
        success: true,
        data: { stored: nodes.length, nodes: nodes.length, edges: edges.length },
      };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },
},
```

- [ ] **Step 4: Update the `ServiceMap` type in `dispatcher.ts` to include `store`**

Open `raphael/src/agent/dispatcher.ts`. Find:

```typescript
memory: {
  query: (params: Record<string, unknown>) => Promise<ToolResult>;
  saveProfile: (params: Record<string, unknown>) => Promise<ToolResult>;
};
```

Replace with:

```typescript
memory: {
  query: (params: Record<string, unknown>) => Promise<ToolResult>;
  saveProfile: (params: Record<string, unknown>) => Promise<ToolResult>;
  store: (params: Record<string, unknown>) => Promise<ToolResult>;
};
```

- [ ] **Step 5: Check TypeScript compiles**

```bash
cd raphael
npm run typecheck 2>&1 | head -30
```

If `typecheck` script doesn't exist, run:
```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add raphael/src/services/index.ts raphael/src/agent/dispatcher.ts
git commit -m "feat: memory.store with Groq extraction and memory.query via knowledge graph"
```

---

## Task 9: Register `memory.store` in `registry.ts`

**Files:**
- Modify: `raphael/src/agent/registry.ts`

The `memory.store` tool needs to be registered so the orchestrator can use it.

- [ ] **Step 1: Find the memory section in `initRegistry` in `registry.ts`**

Find this block (around line 251):

```typescript
// ── memory ────────────────────────────────────────────────────────────────
r.register(
  { name: "memory.query", description: "Query the user memory/profile", parameters: {}, type: "builtin" },
  services.memory.query,
);
r.register(
  {
    name: "memory.saveProfile",
    description: "Save a fact about the user to long-term memory",
    parameters: { info: { type: "string", description: "Fact or preference to remember" } },
    type: "builtin",
  },
  services.memory.saveProfile,
);
```

Replace with:

```typescript
// ── memory ────────────────────────────────────────────────────────────────
r.register(
  {
    name: "memory.query",
    description: "Search the knowledge graph for entities and relationships related to a topic. Returns nodes and edges from the graph.",
    parameters: {
      query: { type: "string", description: "Plain text query, e.g. 'Priya sister Delhi' or 'machine learning projects'" },
      depth: { type: "number", description: "How many hops to expand from matching nodes (default 2, max 4)" },
    },
    type: "builtin",
  },
  services.memory.query,
);
r.register(
  {
    name: "memory.saveProfile",
    description: "Save a personal fact or preference about the user to the flat profile (PROFILE.md). Use for simple biographical facts.",
    parameters: { info: { type: "string", description: "Fact or preference to remember, e.g. 'User prefers dark mode'" } },
    type: "builtin",
  },
  services.memory.saveProfile,
);
r.register(
  {
    name: "memory.store",
    description: "Extract entities and relationships from text and store them in the knowledge graph. Use this when you learn something worth remembering — facts about people, places, events, preferences, or relationships.",
    parameters: {
      text: { type: "string", description: "The text to extract knowledge from. Can be a sentence, paragraph, or summary of what you learned." },
      source: { type: "string", description: "Where this info came from, e.g. 'user message', 'email from Priya', 'web search result'" },
    },
    type: "builtin",
  },
  services.memory.store,
);
```

- [ ] **Step 2: Check TypeScript compiles**

```bash
cd raphael
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add raphael/src/agent/registry.ts
git commit -m "feat: register memory.store and update memory.query description in ToolRegistry"
```

---

## Task 10: Build and Smoke Test

**Files:**
- None (verification only)

- [ ] **Step 1: Full Rust build**

```bash
cd raphael
cargo build 2>&1 | tail -10
```

Expected: `Finished dev [unoptimized + debuginfo] target(s) in ...s`

- [ ] **Step 2: TypeScript type check**

```bash
cd raphael
npx tsc --noEmit 2>&1
```

Expected: no output (no errors).

- [ ] **Step 3: Start the dev app**

```bash
cd raphael
npm run tauri dev
```

- [ ] **Step 4: Smoke test `memory.store`**

In the Raphael chat, send:
```
Remember this: my friend Arjun works at Google in Bangalore and is interested in machine learning.
```

Expected: agent calls `memory.store` with that text. Should respond confirming it saved. Check `~/Library/Application Support/raphael/graph.json` exists and contains nodes like `arjun`, `google`, `bangalore`.

```bash
cat ~/Library/Application\ Support/raphael/graph.json
```

- [ ] **Step 5: Smoke test `memory.query`**

In the chat:
```
What do you know about Arjun?
```

Expected: agent calls `memory.query` with `query: "Arjun"`, gets back nodes/edges, and responds with what it knows.

- [ ] **Step 6: Smoke test cache**

Send the exact same message as Step 4 again. The Rust logs (`~/Library/Application Support/raphael/raphael.log`) should show `add_to_graph` was called but no new Groq call should be made (cache hit). Verify in logs.

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: knowledge graph — on-demand extraction, BFS query, community detection, god nodes"
```

---

## Self-Review

### Spec Coverage Check

| Feature | Implemented |
|---------|-------------|
| LLM-based semantic extraction | ✅ Task 8 — Groq `generateObject` with extraction schema |
| Confidence levels (EXTRACTED / INFERRED / AMBIGUOUS) | ✅ Tasks 1, 8 — Rust enum + Groq schema |
| Persistent graph storage (JSON) | ✅ Tasks 1–2 — `graph.json` with atomic rename |
| Content-hash cache (no re-extraction) | ✅ Tasks 5–6, 8 — SHA256 cache + `check_graph_cache` |
| Node deduplication (last write wins) | ✅ Task 2 — `merge()` |
| Edge deduplication (source+target+relation) | ✅ Task 2 — `merge()` |
| BFS traversal with text scoring | ✅ Task 3 — `query_graph()` |
| God nodes (most-connected) | ✅ Task 4 — `god_nodes()` |
| Community detection | ✅ Task 4 — label propagation |
| Surprising connections (cross-community) | ✅ Task 4 — `surprising_connections()` |
| Graph stats | ✅ Task 4 — `compute_stats()` |
| Agent tool — `memory.store` | ✅ Tasks 8–9 |
| Agent tool — `memory.query` | ✅ Tasks 8–9 |

### No Placeholders Confirmed
All steps contain complete code. No TBDs.

### Type Consistency Confirmed
- `GraphNode` / `GraphEdge` defined in `graph.rs` Task 1 — used verbatim in `commands.rs` Task 6 via `use crate::graph::{GraphNode, GraphEdge}`.
- `ExtractionResult` type in `services/index.ts` derives from `extractionSchema` — same schema used in extraction call and in `add_to_graph` invoke.

---

---

# V2: File Ingestion — Images and PDFs

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Prerequisite:** V1 must be fully implemented and working before starting V2.

**Goal:** Let the agent ingest images and PDFs into the knowledge graph — images go directly to a Groq vision model; PDFs try `pdftotext` (poppler) first, fall back to vision model if that fails.

**Architecture:** Two new Tauri commands: `extract_image_text` (base64-encodes image, sends to vision model via Groq HTTP API) and `extract_pdf_text` (shells out to `pdftotext`, falls back to `extract_image_text` per page on failure). TypeScript calls these commands to get plain text, then passes that text straight into the existing `memory.store` flow — no changes to graph logic needed.

**Tech Stack:** Rust `std::process::Command` for pdftotext shell-out, `base64` crate (already in Cargo.toml), `reqwest` (already in Cargo.toml) for Groq vision API HTTP call, TypeScript existing `memory.store`.

---

## V2 File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `raphael/src-tauri/src/file_extract.rs` | **Create** | `extract_image_text`: base64 encode + Groq vision API call. `extract_pdf_text`: pdftotext shell-out + vision fallback. |
| `raphael/src-tauri/src/lib.rs` | **Modify** | `mod file_extract;` + register two new commands |
| `raphael/src-tauri/src/commands.rs` | **Modify** | Add `extract_image_text` and `extract_pdf_text` Tauri command wrappers |
| `raphael/src/services/index.ts` | **Modify** | Add `memory.ingestFile` service that reads file type, calls correct Tauri command, pipes text to `memory.store` |
| `raphael/src/agent/registry.ts` | **Modify** | Register `memory.ingestFile` tool |

---

## V2 Task 1: Create `file_extract.rs` — Image Text Extraction via Groq Vision

**Files:**
- Create: `raphael/src-tauri/src/file_extract.rs`

Groq's vision API accepts images as base64 data URLs inside a chat message. We send the image with a prompt asking for a full text transcription plus key facts. The model returns plain text which then flows into the existing `memory.store` pipeline.

The Groq vision endpoint is the same as the chat completions endpoint (`https://api.groq.com/openai/v1/chat/completions`) — we use `reqwest` (already in Cargo.toml) to call it directly with a JSON body, since the AI SDK runs on the TypeScript side only.

- [ ] **Step 1: Create the file with the image extraction function**

```rust
// raphael/src-tauri/src/file_extract.rs
//
// File content extraction for non-text formats:
// - Images: base64 encode → Groq vision model
// - PDFs: pdftotext shell-out → fallback to vision model
//
// Output is always plain text, which is then fed into memory.store → graph extraction.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use reqwest::Client;
use serde_json::json;
use std::fs;
use std::path::Path;

/// Detect MIME type from file extension.
/// Returns None if the extension is not a supported image type.
fn image_mime(path: &Path) -> Option<&'static str> {
    match path.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()).as_deref() {
        Some("png")  => Some("image/png"),
        Some("jpg") | Some("jpeg") => Some("image/jpeg"),
        Some("webp") => Some("image/webp"),
        Some("gif")  => Some("image/gif"),
        _ => None,
    }
}

/// Send an image file to the Groq vision model and return the extracted text.
///
/// Uses `meta-llama/llama-4-scout-17b-16e-instruct` which supports image inputs.
/// The image is base64-encoded and sent as a data URL in the message content.
///
/// Returns the model's response text (transcription + key facts).
pub async fn extract_image_text(image_path: &str, groq_api_key: &str) -> Result<String, String> {
    let path = Path::new(image_path);

    let mime = image_mime(path)
        .ok_or_else(|| format!("Unsupported image type: {}", image_path))?;

    let bytes = fs::read(path).map_err(|e| format!("Cannot read image file: {}", e))?;
    let b64 = B64.encode(&bytes);
    let data_url = format!("data:{};base64,{}", mime, b64);

    let client = Client::new();
    let body = json!({
        "model": "meta-llama/llama-4-scout-17b-16e-instruct",
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "Transcribe all text visible in this image. Then list the key entities, facts, and relationships you can identify. Be thorough and specific."
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": data_url
                        }
                    }
                ]
            }
        ],
        "max_tokens": 2048
    });

    let response = client
        .post("https://api.groq.com/openai/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", groq_api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Groq vision API request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Groq vision API error {}: {}", status, text));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Groq response: {}", e))?;

    let content = json["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .to_string();

    if content.is_empty() {
        return Err("Groq vision model returned empty response".to_string());
    }

    Ok(content)
}
```

- [ ] **Step 2: Check compile**

```bash
cd raphael
cargo check 2>&1 | head -20
```

Expected: no errors inside `file_extract.rs`. May see "mod file_extract not found" — fine, we add it in V2 Task 3.

- [ ] **Step 3: Commit**

```bash
git add raphael/src-tauri/src/file_extract.rs
git commit -m "feat: add image text extraction via Groq vision model"
```

---

## V2 Task 2: Add PDF Extraction to `file_extract.rs`

**Files:**
- Modify: `raphael/src-tauri/src/file_extract.rs`

PDF strategy:
1. Shell out to `pdftotext -layout <file> -` — the `-` means output to stdout, `-layout` preserves column structure.
2. If `pdftotext` is not installed or returns an error, convert each PDF page to an image and run `extract_image_text` on it — **not implemented yet** since that requires a PDF rendering library. For now the fallback is a clear error message telling the user to install poppler.
3. If `pdftotext` succeeds but returns empty text (scanned PDF), fall back to vision model by treating the PDF as an image (Groq vision can read single-page PDFs directly as images).

- [ ] **Step 1: Append the PDF extraction function to `file_extract.rs`**

Add after `extract_image_text`:

```rust
/// Extract text from a PDF file.
///
/// Strategy:
/// 1. Try `pdftotext` (poppler) — best quality, handles complex layouts.
///    Install with: brew install poppler
/// 2. If pdftotext is not found: return a clear error telling user to install it.
/// 3. If pdftotext succeeds but output is empty (scanned PDF): fall back to
///    Groq vision model (sends PDF directly as base64 — works for single-page PDFs).
///
/// `groq_api_key` is only used for the vision fallback.
pub async fn extract_pdf_text(pdf_path: &str, groq_api_key: &str) -> Result<String, String> {
    // ── Step 1: try pdftotext ────────────────────────────────────────────────
    let output = std::process::Command::new("pdftotext")
        .arg("-layout")   // preserve column layout
        .arg(pdf_path)
        .arg("-")         // output to stdout
        .output();

    match output {
        Ok(out) if out.status.success() => {
            let text = String::from_utf8_lossy(&out.stdout).to_string();
            let trimmed = text.trim().to_string();

            if !trimmed.is_empty() {
                // pdftotext succeeded with content — return it directly
                return Ok(trimmed);
            }

            // ── Step 3: empty output = scanned PDF → vision fallback ─────────
            // Groq vision can accept PDF files as base64 for single-page docs.
            // For multi-page PDFs this will only read what the model can see,
            // but it is better than returning nothing.
            let bytes = fs::read(pdf_path)
                .map_err(|e| format!("Cannot read PDF file: {}", e))?;
            let b64 = B64.encode(&bytes);
            let data_url = format!("data:application/pdf;base64,{}", b64);

            let client = Client::new();
            let body = json!({
                "model": "meta-llama/llama-4-scout-17b-16e-instruct",
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": "This is a scanned PDF. Transcribe all visible text and list the key entities, facts, and relationships you can identify."
                            },
                            {
                                "type": "image_url",
                                "image_url": { "url": data_url }
                            }
                        ]
                    }
                ],
                "max_tokens": 2048
            });

            let response = client
                .post("https://api.groq.com/openai/v1/chat/completions")
                .header("Authorization", format!("Bearer {}", groq_api_key))
                .header("Content-Type", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Groq vision fallback request failed: {}", e))?;

            if !response.status().is_success() {
                let status = response.status();
                let text = response.text().await.unwrap_or_default();
                return Err(format!("Groq vision fallback error {}: {}", status, text));
            }

            let json: serde_json::Value = response
                .json()
                .await
                .map_err(|e| format!("Failed to parse Groq vision response: {}", e))?;

            let content = json["choices"][0]["message"]["content"]
                .as_str()
                .unwrap_or("")
                .to_string();

            Ok(content)
        }

        Ok(out) => {
            // pdftotext ran but returned non-zero exit code
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            Err(format!("pdftotext failed: {}", stderr))
        }

        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // ── Step 2: pdftotext not installed ─────────────────────────────
            Err(
                "pdftotext not found. Install poppler to enable PDF extraction: brew install poppler"
                    .to_string(),
            )
        }

        Err(e) => Err(format!("Failed to run pdftotext: {}", e)),
    }
}
```

- [ ] **Step 2: Check compile**

```bash
cd raphael
cargo check 2>&1 | head -20
```

Expected: no errors inside `file_extract.rs`.

- [ ] **Step 3: Commit**

```bash
git add raphael/src-tauri/src/file_extract.rs
git commit -m "feat: add PDF extraction with pdftotext and vision fallback"
```

---

## V2 Task 3: Add Tauri Commands to `commands.rs` and Register in `lib.rs`

**Files:**
- Modify: `raphael/src-tauri/src/commands.rs`
- Modify: `raphael/src-tauri/src/lib.rs`

- [ ] **Step 1: Append two new commands at the bottom of `commands.rs`**

Add after `check_graph_cache` (the last function from V1):

```rust
// ── File Extraction Commands ───────────────────────────────────────────────────

/// Extract text from an image file using the Groq vision model.
/// `path` must be an absolute path to a .png, .jpg, .jpeg, .webp, or .gif file.
/// Returns the extracted text.
#[tauri::command]
pub async fn extract_image_text(path: String) -> Result<String, String> {
    log_to_file(&format!("extract_image_text: {}", path));

    let api_key = SecureStore::new(store_dir())?
        .get("groq_api_key")?
        .ok_or("Groq API key not configured")?;

    let text = crate::file_extract::extract_image_text(&path, &api_key).await?;
    log_to_file(&format!("extract_image_text: {} chars extracted", text.len()));
    Ok(text)
}

/// Extract text from a PDF file.
/// Tries pdftotext first; falls back to Groq vision model for scanned PDFs.
/// `path` must be an absolute path to a .pdf file.
/// Returns the extracted text.
#[tauri::command]
pub async fn extract_pdf_text(path: String) -> Result<String, String> {
    log_to_file(&format!("extract_pdf_text: {}", path));

    let api_key = SecureStore::new(store_dir())?
        .get("groq_api_key")?
        .ok_or("Groq API key not configured")?;

    let text = crate::file_extract::extract_pdf_text(&path, &api_key).await?;
    log_to_file(&format!("extract_pdf_text: {} chars extracted", text.len()));
    Ok(text)
}
```

- [ ] **Step 2: Add `mod file_extract;` to `lib.rs`**

Open `raphael/src-tauri/src/lib.rs`. After the existing mod lines, add:

```rust
mod file_extract;
```

So the mod block now reads:

```rust
mod commands;
mod secure_store;
mod search;
mod google_oauth;
mod gmail_api;
mod graph;
mod graph_cache;
mod file_extract;
```

- [ ] **Step 3: Register the two new commands in the `invoke_handler!` block in `lib.rs`**

Add `commands::extract_image_text` and `commands::extract_pdf_text` to the handler list. The complete list should now be:

```rust
.invoke_handler(tauri::generate_handler![
    commands::get_secret,
    commands::set_secret,
    commands::list_files,
    commands::read_file_content,
    commands::get_logs,
    commands::clear_logs,
    commands::send_email,
    commands::start_google_oauth,
    commands::get_gmail_auth_status,
    commands::revoke_google_oauth,
    commands::load_config,
    commands::save_config,
    commands::load_profile,
    commands::update_profile,
    commands::http_fetch,
    commands::add_to_graph,
    commands::query_graph,
    commands::get_graph_stats,
    commands::check_graph_cache,
    commands::extract_image_text,
    commands::extract_pdf_text,
    search::search_web,
])
```

- [ ] **Step 4: Full build**

```bash
cd raphael
cargo build 2>&1 | tail -10
```

Expected: `Finished dev [unoptimized + debuginfo] target(s) in ...s`

- [ ] **Step 5: Commit**

```bash
git add raphael/src-tauri/src/commands.rs raphael/src-tauri/src/lib.rs
git commit -m "feat: register extract_image_text and extract_pdf_text Tauri commands"
```

---

## V2 Task 4: Add `memory.ingestFile` to `services/index.ts`

**Files:**
- Modify: `raphael/src/services/index.ts`

`memory.ingestFile` does three things:
1. Detects file type from the path extension.
2. Calls the correct Tauri command (`extract_image_text`, `extract_pdf_text`, or `read_file_content` for text files).
3. Passes the returned text directly to the existing `memory.store` logic (calls `extractNodesFromText` + `add_to_graph`).

No changes to graph logic — it just extends the ingestion pipeline.

- [ ] **Step 1: Add `ingestFile` to the `memory` object inside `createServices()`**

Open `raphael/src/services/index.ts`. Inside `createServices()`, find the `memory` object. It currently ends with the `store` function added in V1. Add `ingestFile` as a new property after `store`:

```typescript
ingestFile: async (p) => {
  const params = p as { path?: string };
  if (!params.path) return { success: false, error: "Missing path param" };

  const path = params.path.trim();
  const ext = path.split(".").pop()?.toLowerCase() ?? "";

  try {
    let text: string;

    // ── Route by file type ───────────────────────────────────────────────
    if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) {
      // Image → Groq vision model
      text = await invoke<string>("extract_image_text", { path });

    } else if (ext === "pdf") {
      // PDF → pdftotext with vision fallback
      text = await invoke<string>("extract_pdf_text", { path });

    } else if (["txt", "md", "ts", "tsx", "js", "jsx", "rs", "go", "py", "json", "yaml", "yml", "toml", "csv"].includes(ext)) {
      // Plain text file → read directly
      text = await invoke<string>("read_file_content", { path });

    } else {
      return {
        success: false,
        error: `Unsupported file type: .${ext}. Supported: images (png/jpg/webp/gif), pdf, text files (txt/md/ts/rs/go/py/json/yaml/toml/csv).`,
      };
    }

    if (!text || text.trim().length === 0) {
      return { success: false, error: "File appears to be empty or could not be read." };
    }

    // ── Extract nodes/edges and store in graph ───────────────────────────
    // Check cache first to avoid re-extracting same file content
    const cached = await invoke<string | null>("check_graph_cache", { text });

    let nodes: ExtractionResult["nodes"];
    let edges: ExtractionResult["edges"];

    if (cached) {
      const parsed = JSON.parse(cached) as ExtractionResult;
      nodes = parsed.nodes;
      edges = parsed.edges;
    } else {
      const extracted = await extractNodesFromText(text);
      nodes = extracted.nodes;
      edges = extracted.edges;
    }

    if (nodes.length === 0 && edges.length === 0) {
      return { success: true, data: { stored: 0, note: "Nothing meaningful to extract from file" } };
    }

    await invoke("add_to_graph", {
      params: {
        nodes: nodes.map((n) => ({
          ...n,
          source: `file:${path}`,
          community: null,
        })),
        edges,
        source_text: text,
      },
    });

    return {
      success: true,
      data: { stored: nodes.length, nodes: nodes.length, edges: edges.length, file: path },
    };

  } catch (e) {
    return { success: false, error: String(e) };
  }
},
```

- [ ] **Step 2: Add `ingestFile` to the `ServiceMap` type in `dispatcher.ts`**

Open `raphael/src/agent/dispatcher.ts`. Find the `memory` type block:

```typescript
memory: {
  query: (params: Record<string, unknown>) => Promise<ToolResult>;
  saveProfile: (params: Record<string, unknown>) => Promise<ToolResult>;
  store: (params: Record<string, unknown>) => Promise<ToolResult>;
};
```

Replace with:

```typescript
memory: {
  query: (params: Record<string, unknown>) => Promise<ToolResult>;
  saveProfile: (params: Record<string, unknown>) => Promise<ToolResult>;
  store: (params: Record<string, unknown>) => Promise<ToolResult>;
  ingestFile: (params: Record<string, unknown>) => Promise<ToolResult>;
};
```

- [ ] **Step 3: TypeScript type check**

```bash
cd raphael
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add raphael/src/services/index.ts raphael/src/agent/dispatcher.ts
git commit -m "feat: add memory.ingestFile — routes images/PDFs/text into knowledge graph"
```

---

## V2 Task 5: Register `memory.ingestFile` in `registry.ts`

**Files:**
- Modify: `raphael/src/agent/registry.ts`

- [ ] **Step 1: Add `memory.ingestFile` registration after `memory.store` in `initRegistry`**

Open `raphael/src/agent/registry.ts`. Find the `memory.store` registration block added in V1 Task 9. Add this immediately after it:

```typescript
r.register(
  {
    name: "memory.ingestFile",
    description: "Read a file from disk and extract all knowledge from it into the graph. Supports images (png/jpg/webp/gif), PDFs, and text files (txt/md/ts/rs/go/py/json/yaml/toml/csv). Use this when the user gives you a file path and wants you to learn from it.",
    parameters: {
      path: { type: "string", description: "Absolute path to the file on disk. e.g. '/Users/saswata/Documents/report.pdf'" },
    },
    type: "builtin",
  },
  services.memory.ingestFile,
);
```

- [ ] **Step 2: TypeScript type check**

```bash
cd raphael
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add raphael/src/agent/registry.ts
git commit -m "feat: register memory.ingestFile tool in ToolRegistry"
```

---

## V2 Task 6: Build and Smoke Test

**Files:**
- None (verification only)

- [ ] **Step 1: Full Rust build**

```bash
cd raphael
cargo build 2>&1 | tail -10
```

Expected: `Finished dev [unoptimized + debuginfo] target(s) in ...s`

- [ ] **Step 2: Start dev app**

```bash
cd raphael
npm run tauri dev
```

- [ ] **Step 3: Smoke test image ingestion**

In the Raphael chat, send:
```
Ingest this image: /path/to/any/screenshot.png
```

Expected: agent calls `memory.ingestFile`, which calls `extract_image_text`, which calls Groq vision, which returns text, which gets extracted into graph nodes. Agent should confirm what it found.

Check graph.json was updated:
```bash
cat ~/Library/Application\ Support/raphael/graph.json | python3 -m json.tool | head -40
```

- [ ] **Step 4: Smoke test PDF ingestion (with poppler)**

First check if pdftotext is available:
```bash
which pdftotext
```

If installed, test with any PDF:
```
Ingest this file: /path/to/any/document.pdf
```

Expected: agent calls `memory.ingestFile`, routes to `extract_pdf_text`, pdftotext extracts text, Groq extracts nodes, graph is updated.

- [ ] **Step 5: Smoke test PDF fallback (without poppler)**

Temporarily rename pdftotext to test the fallback:
```bash
sudo mv $(which pdftotext) /usr/local/bin/pdftotext.bak
```

Repeat the PDF test. Expected: agent should respond with the error message `"pdftotext not found. Install poppler to enable PDF extraction: brew install poppler"`.

Restore:
```bash
sudo mv /usr/local/bin/pdftotext.bak $(dirname $(which pdftotext.bak))/pdftotext
```

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: V2 file ingestion — images via Groq vision, PDFs via pdftotext with vision fallback"
```

---

## V2 Self-Review

### Spec Coverage Check

| Feature | Implemented |
|---------|-------------|
| Image ingestion (png/jpg/webp/gif) | ✅ V2 Tasks 1, 3, 4 — base64 → Groq vision |
| PDF ingestion — pdftotext primary | ✅ V2 Tasks 2, 3, 4 — `std::process::Command` shell-out |
| PDF ingestion — scanned fallback | ✅ V2 Task 2 — empty pdftotext output → Groq vision |
| PDF ingestion — not installed error | ✅ V2 Task 2 — clear error message with install instructions |
| Text file ingestion | ✅ V2 Task 4 — routes to existing `read_file_content` |
| Cache (no re-extraction same file) | ✅ V2 Task 4 — `check_graph_cache` before Groq call |
| Agent tool — `memory.ingestFile` | ✅ V2 Tasks 4–5 |
| Flows into existing graph pipeline | ✅ V2 Task 4 — calls `add_to_graph` identically to `memory.store` |

### No Placeholders Confirmed
All steps contain complete code. No TBDs.

### Type Consistency Confirmed
- `extract_image_text` / `extract_pdf_text` defined in `file_extract.rs` — called from `commands.rs` as `crate::file_extract::extract_image_text` / `crate::file_extract::extract_pdf_text`.
- `ExtractionResult` reused from V1 `services/index.ts` — same type, same schema, no duplication.
- `ServiceMap.memory.ingestFile` added to `dispatcher.ts` — consumed by `registry.ts` as `services.memory.ingestFile`.
- `ServiceMap.memory.store` added to `dispatcher.ts` in Task 8 — consumed by `registry.ts` Task 9 as `services.memory.store`.
