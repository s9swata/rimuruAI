# Raphael Codebase — Known Issues

> Audited 2026-04-17. 27 issues across 7 categories. Fixed: #1, #5, #10, #13, #17.

---

## STATE / REF BUGS

### 1. ✅ `hasDocumentsRef` never resets — **FIXED**
- **File**: `src/App.tsx:312`
- After any file upload, all subsequent text-only messages route to `files.queryDocument` forever for the session, even when the user is asking something unrelated.

### 2. `submittingRef` not released on early return
- **File**: `src/App.tsx:241-249`
- `finally` block does release it, but if the registry is null at submit time there is a brief window before the finally runs where a second submit can sneak through.

### 3. `startupMemory` never refreshed during session
- **File**: `src/App.tsx:213-220`
- Loaded once at startup. Newly stored memory facts during the session don't appear in the system prompt for later messages.

---

## RACE CONDITIONS

### 4. `approvalResolveRef` can fire twice on rapid double-click
- **File**: `src/App.tsx:507-515`
- No guard prevents the approve/deny resolver from being called more than once on rapid double-click or re-render.

### 5. ✅ Process exit drops `ProcessSlot` while I/O threads are alive — **FIXED**
- **File**: `src-tauri/src/shell_exec.rs:209-234`
- Exit handler drops the slot (closing file descriptors) while read/write threads may still be active, causing mid-read I/O errors.

### 6. `listen()` not cleaned up if `spawn_process()` throws
- **File**: `src/App.tsx:165-196`
- Process event listeners are only unregistered on normal exit. If spawn throws, listeners leak and accumulate over a long session.

---

## WRONG ROUTING

### 7. Orchestrator bypassed when `filesReady` is true
- **File**: `src/App.tsx:313-317`
- Every message after a file upload hardcodes `files.queryDocument` without consulting the orchestrator, even for unrelated queries.

### 8. `tools.register` accepts arbitrary internal URLs
- **File**: `src/agent/registry.ts:345-371`
- No URL sanitization. Agent can register `http://localhost:PORT/anything` and invoke it freely.

### 9. Tool params not validated before dispatch
- **File**: `src/App.tsx:354`, `src/agent/dispatcher.ts:87`
- Orchestrator can return malformed params that silently pass through to tool implementations without any schema validation.

---

## CONTEXT BLEED

### 10. ✅ Global `chunks.json` — no session or user scoping — **FIXED**
- **File**: `src-tauri/src/chunk_store.rs`, `src-tauri/src/commands.rs:717-732`
- All uploaded file chunks go into one flat file. Re-uploading a same-named file replaces chunks on disk but stale in-memory data persists until restart. Multi-user scenarios contaminate each other.

### 11. `fileAnalysisContext` bleeds into chained tool iterations
- **File**: `src/App.tsx:382-386`
- File context from the upload is not cleared between chained tool calls, mixing it with subsequent tool results during re-orchestration.

### 12. `profileContent` never revalidated during session
- **File**: `src/App.tsx:108-109`
- Loaded once at startup. If contaminated by injected memory or stale data, every message in the session includes it.

---

## SILENT FAILURES

### 13. ✅ Chunk embedding failure shows "Analysis complete" — **FIXED**
- **File**: `src/services/fileAnalysis.ts:172`, `src/App.tsx:296`
- If `embedContent()` throws during chunking, no chunks are stored but the UI marks the tool as done. The next `files.queryDocument` silently returns empty.

### 14. Memory query failure at startup swallowed
- **File**: `src/App.tsx:219-221`
- If the memory MCP server is unreachable, the catch block does nothing. User gets blank memory context with no indication anything is wrong.

### 15. Orchestrator failure returns `FALLBACK` silently
- **File**: `src/agent/orchestrator.ts:82-84`
- Any orchestration error collapses to a generic fast-model response. The user sees a normal reply with no indication orchestration failed.

### 16. HTTP tool errors not distinguished
- **File**: `src/agent/registry.ts:79-95`
- Network errors, 4xx, 5xx, and JSON parse failures all return the same `{ success: false }`. HTML error pages can be passed as tool output to the LLM.

### 17. ✅ `pendingAttachments` double-decremented — **FIXED** on error
- **File**: `src/App.tsx:286-302`
- The error path decrements `pendingAttachments` (line 302) but under certain code paths line 286 already decremented it, creating a counter mismatch that can permanently freeze the "Analyzing file…" spinner.

---

## TOKEN WASTE

### 18. Full `history` passed to orchestrator on every call
- **File**: `src/agent/orchestrator.ts:51`, `src/App.tsx:317, 386`
- No slice limit. Long sessions send the entire conversation history just to pick a tool.

### 19. Full `iterContext` passed verbatim to re-orchestration
- **File**: `src/App.tsx:386`
- Up to 8000 chars of tool output sent to the orchestrator for re-routing. Orchestrator only needs success/failure signal, not full output.

### 20. Tool list regenerated on every orchestration call
- **File**: `src/agent/orchestrator.ts:42`
- `registry.toPromptString()` called fresh each time even though the registry is static after initialization.

---

## MISSING EDGE CASES

### 21. File names not sanitized before temp storage
- **File**: `src-tauri/src/commands.rs:437`
- `temp_dir.join(&file_name)` accepts path separators and names >255 chars. Can escape the temp directory or fail on the filesystem.

### 22. Embedding dimension mismatch silently returns empty
- **File**: `src-tauri/src/chunk_store.rs:41-42`, `src/services/fileAnalysis.ts:196`
- If query embedding and stored chunk embeddings have different dimensions, cosine similarity returns 0.0 for all chunks. User sees "No relevant document content found" with no explanation.

### 23. `topK: 0` wastes compute and returns nothing
- **File**: `src-tauri/src/commands.rs:736-746`
- Sorts all chunks then truncates to 0 results. Treated identically to "no results found".

### 24. Borderline file types pay API cost before failing
- **File**: `src/services/fileAnalysis.ts:150-158`
- Files like spreadsheets or presentations pass the type check, get uploaded to Gemini File API, then fail after the API cost is incurred.

### 25. Empty/whitespace user message reaches orchestrator
- **File**: `src/agent/orchestrator.ts:29`
- No guard on `userMessage`. Blank input produces garbage routing decisions.

### 26. Memory store never deduplicates entities
- **File**: `src/services/index.ts:151-153`
- `create_entities` always inserts. Storing the same fact multiple times across sessions creates duplicate entities that clutter the memory graph.

### 27. No way to cancel in-flight file analysis or tool execution
- **File**: `src/App.tsx`
- `submittingRef` blocks new submissions but does not abort the current one. Long-running tools or heavy file analysis cannot be interrupted by the user.
