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
    pub node_type: String,
    pub description: String,
    pub source: String,
    pub confidence: Confidence,
    pub community: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
    pub relation: String,
    pub confidence: Confidence,
    pub confidence_score: f32,
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

// ── Merge ─────────────────────────────────────────────────────────────────────

/// Merge new nodes and edges into the graph.
/// Nodes with duplicate IDs are overwritten (new data wins).
/// Edges with duplicate source+target+relation are overwritten.
pub fn merge(graph: &mut KnowledgeGraph, new_nodes: Vec<GraphNode>, new_edges: Vec<GraphEdge>) {
    let mut node_index: HashMap<String, usize> = graph
        .nodes
        .iter()
        .enumerate()
        .map(|(i, n)| (n.id.clone(), i))
        .collect();

    for node in new_nodes {
        if let Some(&idx) = node_index.get(&node.id) {
            graph.nodes[idx] = node;
        } else {
            node_index.insert(node.id.clone(), graph.nodes.len());
            graph.nodes.push(node);
        }
    }

    let mut edge_index: HashMap<(String, String, String), usize> = graph
        .edges
        .iter()
        .enumerate()
        .map(|(i, e)| ((e.source.clone(), e.target.clone(), e.relation.clone()), i))
        .collect();

    for edge in new_edges {
        let key = (
            edge.source.clone(),
            edge.target.clone(),
            edge.relation.clone(),
        );
        if let Some(&idx) = edge_index.get(&key) {
            graph.edges[idx] = edge;
        } else {
            edge_index.insert(key, graph.edges.len());
            graph.edges.push(edge);
        }
    }
}

// ── BFS Query ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct QueryResult {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    pub start_nodes: Vec<String>,
}

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

fn build_adjacency(graph: &KnowledgeGraph) -> HashMap<String, Vec<String>> {
    let mut adj: HashMap<String, Vec<String>> = HashMap::new();
    for edge in &graph.edges {
        adj.entry(edge.source.clone())
            .or_default()
            .push(edge.target.clone());
        adj.entry(edge.target.clone())
            .or_default()
            .push(edge.source.clone());
    }
    adj
}

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

pub fn query_graph(
    graph: &KnowledgeGraph,
    query: &str,
    depth: usize,
    top_seeds: usize,
) -> QueryResult {
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

    let adj = build_adjacency(graph);
    let clamped_depth = depth.min(4);
    let visited = bfs(&adj, &seed_ids, clamped_depth);

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

// ── God Nodes ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct GodNode {
    pub id: String,
    pub label: String,
    pub node_type: String,
    pub degree: usize,
}

pub fn god_nodes(graph: &KnowledgeGraph, top_n: usize) -> Vec<GodNode> {
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

    let mut labels: Vec<usize> = (0..node_ids.len()).collect();

    let max_iter = 20;
    for _ in 0..max_iter {
        let mut changed = false;
        for i in 0..node_ids.len() {
            if adj[i].is_empty() {
                continue;
            }
            let mut freq: HashMap<usize, usize> = HashMap::new();
            for &nb in &adj[i] {
                *freq.entry(labels[nb]).or_insert(0) += 1;
            }
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

pub fn surprising_connections(
    graph: &KnowledgeGraph,
    communities: &HashMap<usize, Vec<String>>,
    top_n: usize,
) -> Vec<SurprisingConnection> {
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
