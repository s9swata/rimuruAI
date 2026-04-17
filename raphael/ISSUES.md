# Raphael Codebase — Known Issues

> Audited 2026-04-17. 27 issues across 7 categories. **All 27 fixed.**

---

## STATE / REF BUGS

### 1. ✅ `hasDocumentsRef` never resets — **FIXED**
- **File**: `src/App.tsx:312`
- After any file upload, all subsequent text-only messages route to `files.queryDocument` forever for the session, even when the user is asking something unrelated.

### 2. ✅ `submittingRef` not released on early return — **FIXED**
- **File**: `src/App.tsx:241-249`
- Added explicit `submittingRef.current = false` before the early return when registry is null.

### 3. ✅ `startupMemory` never refreshed during session — **FIXED**
- **File**: `src/App.tsx:213-220`
- Now refreshed after `memory.store` and `memory.saveProfile` tool calls.

---

## RACE CONDITIONS

### 4. ✅ `approvalResolveRef` can fire twice on rapid double-click — **FIXED**
- **File**: `src/App.tsx:507-515`
- Resolver is now nulled before calling, preventing double-fire.

### 5. ✅ Process exit drops `ProcessSlot` while I/O threads are alive — **FIXED**
- **File**: `src-tauri/src/shell_exec.rs:209-234`
- Exit handler drops the slot (closing file descriptors) while read/write threads may still be active, causing mid-read I/O errors.

### 6. ✅ `listen()` not cleaned up if `spawn_process()` throws — **FIXED** (by code structure)
- **File**: `src/App.tsx:165-196`
- `listen()` calls are inside the Promise constructor which only runs after `spawn_process()` succeeds. Throw skips listener creation entirely.

---

## WRONG ROUTING

### 7. ✅ Orchestrator bypassed when `filesReady` is true — **FIXED** (by prior refactor)
- **File**: `src/App.tsx:313-317`
- `justUploadedFiles` only true for the same message that had attachments. Subsequent messages go through orchestrator with a `hasStoredDocs` hint.

### 8. ✅ `tools.register` accepts arbitrary internal URLs — **FIXED** (by prior work)
- **File**: `src/agent/registry.ts:345-371`
- `validateToolUrl()` blocks localhost, private IPs, `.local` domains, and non-HTTPS.

### 9. ✅ Tool params not validated before dispatch — **FIXED**
- **File**: `src/agent/registry.ts`
- `validateAndCoerceParams()` runs before every tool dispatch: absent params return a typed error, wrong-type values are coerced (string/number/boolean), NaN coercions are rejected. Internal `_`-prefixed params skipped.

---

## CONTEXT BLEED

### 10. ✅ Global `chunks.json` — no session or user scoping — **FIXED**
- **File**: `src-tauri/src/chunk_store.rs`, `src-tauri/src/commands.rs:717-732`
- All uploaded file chunks go into one flat file. Re-uploading a same-named file replaces chunks on disk but stale in-memory data persists until restart. Multi-user scenarios contaminate each other.

### 11. ✅ `fileAnalysisContext` bleeds into chained tool iterations — **FIXED**
- **File**: `src/App.tsx`
- `files.queryDocument` removed from `READ_TOOLS` — doc queries are terminal, preventing re-orchestration that mixed file context with unrelated tool results. Error messages from failed file uploads no longer forwarded to the orchestrator.

### 12. ✅ `profileContent` never revalidated during session — **FIXED**
- **File**: `src/App.tsx`
- Profile loaded fresh from disk at the start of each `handleSubmit` via `invoke("load_profile")`. Breaks the stale closure value — both normal and research paths use the freshly read profile.

---

## SILENT FAILURES

### 13. ✅ Chunk embedding failure shows "Analysis complete" — **FIXED**
- **File**: `src/services/fileAnalysis.ts:172`, `src/App.tsx:296`
- If `embedContent()` throws during chunking, no chunks are stored but the UI marks the tool as done. The next `files.queryDocument` silently returns empty.

### 14. ✅ Memory query failure at startup swallowed — **FIXED**
- **File**: `src/App.tsx:219-221`
- Failure now logged as `console.warn` with error message.

### 15. ✅ Orchestrator failure returns `FALLBACK` silently — **FIXED**
- **File**: `src/agent/orchestrator.ts`
- Outer try/catch removed — errors now propagate to callers. Narrow try/catch around `parseOrchestration` rethrows with the raw response snippet. App.tsx `.catch()` handles the fallback explicitly and logs it.

### 16. ✅ HTTP tool errors not distinguished — **FIXED**
- **File**: `src/agent/registry.ts`
- Errors classified as client (4xx), server (5xx), or network/parse. HTML responses rejected before reaching the LLM. GET params now serialized as query string instead of being dropped.

### 17. ✅ `pendingAttachments` double-decremented — **FIXED** on error
- **File**: `src/App.tsx:286-302`
- The error path decrements `pendingAttachments` (line 302) but under certain code paths line 286 already decremented it, creating a counter mismatch that can permanently freeze the "Analyzing file…" spinner.

---

## TOKEN WASTE

### 18. ✅ Full `history` passed to orchestrator on every call — **FIXED**
- **File**: `src/agent/orchestrator.ts:51`
- History sliced to last 6 messages before passing to orchestrator.

### 19. ✅ Full `iterContext` passed verbatim to re-orchestration — **FIXED**
- **File**: `src/agent/orchestrator.ts`
- `toolResult` in the user message now sliced to 500 chars, matching the system prompt truncation.

### 20. ✅ Tool list regenerated on every orchestration call — **FIXED**
- **File**: `src/agent/registry.ts`
- `toPromptString()` now uses `_promptCache`, invalidated only when tools are registered/removed.

---

## MISSING EDGE CASES

### 21. ✅ File names not sanitized before temp storage — **FIXED**
- **File**: `src-tauri/src/commands.rs:437`
- Filename stripped of directory components via `Path::file_name()` and truncated to 200 chars.

### 22. ✅ Embedding dimension mismatch silently returns empty — **FIXED**
- **File**: `src-tauri/src/chunk_store.rs:41-42`
- `search()` now filters out chunks whose embedding length differs from the query, preventing spurious 0.0 scores.

### 23. ✅ `topK: 0` wastes compute and returns nothing — **FIXED**
- **File**: `src-tauri/src/commands.rs:736-746`
- `search_chunks` returns early with empty vec when `top_k == 0`.

### 24. ✅ Borderline file types pay API cost before failing — **FIXED** (by prior work)
- **File**: `src/services/fileAnalysis.ts:152-154`
- Strict whitelist (PDF, text/plain, image/*) rejects unsupported types before any Gemini API call.

### 25. ✅ Empty/whitespace user message reaches orchestrator — **FIXED**
- **File**: `src/agent/orchestrator.ts:29`
- `orchestrate()` returns `FALLBACK` immediately if `userMessage.trim()` is empty.

### 26. ✅ Memory store never deduplicates entities — **FIXED**
- **File**: `src/services/index.ts:151-153`
- `memory.store` now searches for existing entity first; adds observation if found, creates new only if not. Falls back to create on error.

### 27. ✅ No way to cancel in-flight file analysis or tool execution — **FIXED**
- **File**: `src/App.tsx`, `src/agent/groq.ts`, `src/services/fileAnalysis.ts`, `src/components/InputBar.tsx`
- `AbortController` created per submission; "⏹ Stop" button in InputBar aborts it. Signal wired to `streamText`, `streamCompound` (fetch), and `analyzeDocument` (checked between embedding calls). AbortError caught silently.
