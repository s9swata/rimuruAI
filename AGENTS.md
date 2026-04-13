# Before executing ANY task, agents MUST consult the project's knowledge graph to understand existing architecture, relationships, and patterns.

### When to Use the Graph
- Before modifying any component or function
- When asked about architecture or dependencies
- When adding new features that may touch existing code
- When debugging or tracing execution paths

### Graph Files Location
- **Audit report**: `graphify-out/GRAPH_REPORT.md`

python3 -c "from graphify.ingest import query; query('What does X do?')"
```

## 🚨 Critical Safety Rules

### 1. Git Safety
- NEVER run destructive commands:
  - `git reset --hard`
  - `git clean -fd`
  - Any command that rewrites or deletes history

- ALWAYS create commits:
  - Commit BEFORE making changes
  - Commit AFTER completing a task

- Commit messages must be meaningful and describe the changes made.

---

### 2. File System Safety
- NEVER execute destructive commands such as:
  - `rm -rf *`
  - Recursive deletion of project files

- Do NOT delete files unless explicitly instructed and necessary.

---

## 📚 Documentation & Accuracy

- ALWAYS follow the **latest official documentation** of any framework, library, or tool used.
- Do NOT rely on outdated knowledge or assumptions.
- If unsure, prioritize correctness over speed.

---

## ⚙️ Development Behavior

- Make incremental, safe changes (avoid large unreviewable diffs)
- Preserve existing functionality unless explicitly modifying it
- Write clean, readable, and maintainable code

---

## ✅ Task Execution Workflow

For EVERY task:

1. Commit current state  
2. Execute requested changes  
3. Verify functionality (basic sanity checks)  
4. Commit final state  

---



## 🧠 Guiding Principles

- Safety > Speed  
- Consistency > Creativity  
- Accuracy > Assumptions  

---

Agents that fail to follow these rules are considered unsafe.
