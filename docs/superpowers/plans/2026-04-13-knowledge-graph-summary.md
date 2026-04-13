# Knowledge Graph - Implementation Summary

## Overview
Persistent, queryable knowledge graph for storing facts about people, places, organizations, and relationships.

## Files Created/Modified

### Rust (Tauri Backend)
- `raphael/src-tauri/src/graph.rs` - Graph types, load/save, merge, BFS query, community detection (label propagation), god nodes, surprising connections, stats
- `raphael/src-tauri/src/graph_cache.rs` - SHA256 content-hash cache for extraction results
- `raphael/src-tauri/src/commands.rs` - Tauri commands: `add_to_graph`, `query_graph`, `get_graph_stats`, `check_graph_cache`
- `raphael/src-tauri/src/lib.rs` - Module registration

### TypeScript (Frontend)
- `raphael/src/services/index.ts` - `memory.store` with Groq extraction, `memory.query` via graph
- `raphael/src/agent/dispatcher.ts` - Added `store` to memory ServiceMap
- `raphael/src/agent/registry.ts` - Registered `memory.store` tool
- `raphael/src/agent/prompts.ts` - Orchestrator rules for query handling and auto-store

## Commands

| Command | Purpose |
|---------|---------|
| `add_to_graph` | Add nodes/edges with deduplication (last-write-wins) |
| `query_graph` | BFS query with text scoring |
| `get_graph_stats` | Graph stats: node count, edge count, communities, god nodes, surprising connections |
| `check_graph_cache` | Check if text was already extracted |

## Graph Structure
```
nodes: { id, label, node_type, description, source, confidence, community }
edges: { source, target, relation, confidence, confidence_score }
```

## Confidence Levels
- `EXTRACTED` (1.0) - explicitly stated
- `INFERRED` (0.5) - implied
- `AMBIGUOUS` (0.2) - uncertain

## Agent Rules
1. Query first before answering about any entity
2. If query returns empty nodes array → "I don't have information about [entity] in my knowledge graph"
3. If user asks about unknown entity → call `memory.store` to add it
4. Do NOT hallucinate or assume information

## Extraction Prompt Key Rules
1. DO NOT extract "user", "me", "my", "I", "myself" (speaker, not external entities)
2. Node IDs must be snake_case and unique - append context for ambiguous names: `priya_google`, `priya_yoga_class`
3. Every node must have a description
4. Uncertain info ("might", "maybe") → use `AMBIGUOUS` confidence with score `0.2`

## Testing Queries
```bash
# Store
"My friend Arjun works at Google in Bangalore and is interested in machine learning"

# Query
"What do you know about Arjun?"

# Ambiguous names (creates unique IDs)
"My friend Priya works at Google. Another Priya from my yoga class lives in Bangalore."

# Unknown entity (should auto-store)
"Do you know anything about my friend David who works at Netflix?"
```

## Storage Location
`~/Library/Application Support/raphael/graph.json`
Cache: `~/Library/Application Support/raphael/graph_cache/`