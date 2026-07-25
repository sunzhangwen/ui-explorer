# Requirements Roadmap Resequencing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update `REQUIREMENTS.md` so every unfinished capability follows the approved web-first Phase 4–13 roadmap and project management moves to Phase 11.

**Architecture:** Treat the requirements document as one consistency boundary. First capture the obsolete references, then update scope tables and feature ownership, replace the roadmap and milestone sections, and finally audit every Phase reference against the approved design.

**Tech Stack:** Markdown, PowerShell, ripgrep, Git.

## Global Constraints

- Phase 0–3 remain completed and retain their existing functional scope.
- Phase 4 contains only the completed standard HTML table extraction capability.
- Project management and Selector regression validation belong to Phase 11.
- Relative week estimates are Phase 4 weeks 9–10, Phase 5 weeks 11–13, Phase 6 weeks 14–17, Phase 7 weeks 18–20, Phase 8 weeks 21–22, Phase 9 weeks 23–27, Phase 10 weeks 28–30, Phase 11 weeks 31–34, Phase 12 weeks 35–36, and Phase 13 in a later release.
- Every unfinished capability has one primary owning Phase.
- The approved source of truth is `docs/superpowers/specs/2026-07-25-roadmap-resequencing-design.md`.

---

### Task 1: Rewrite the Requirements Roadmap as One Consistent Boundary

**Files:**
- Modify: `REQUIREMENTS.md`
- Reference: `docs/superpowers/specs/2026-07-25-roadmap-resequencing-design.md`

**Interfaces:**
- Consumes: the approved Phase 4–13 names, scope, order, periods, and dependency rules.
- Produces: one internally consistent requirements document whose MVP tables, detailed features, roadmap, acceptance criteria, milestones, and open questions use the same phase mapping.

- [ ] **Step 1: Capture the obsolete roadmap references**

Run:

```powershell
rg -n "项目保存.*P0|项目管理和表格提取|Phase 5.*桌面|Phase 6.*UiPath|Phase 7.*瞬态|Phase 8.*AI|Phase 9.*企业|第 12-15 周|第 16-17 周|第 18-19 周|第 20 周以后" REQUIREMENTS.md
```

Expected: matches show the old MVP promise, old Phase 4 combined scope, old Phase 5–9 ordering, and old milestone periods.

- [ ] **Step 2: Align the project overview and MVP boundary**

Update the opening target and route principle so the web MVP closes at capture, Selector generation, validation, and export. Remove project saving from “MVP 必须完成的能力”, and add it to the deferred table as:

```markdown
| 项目管理与 Selector 回归验证 | 等网页、桌面和 UiPath 资产模型稳定后再冻结 `.uiproj` schema，避免反复迁移 | Phase 11 |
```

Update all other deferred phase references to Phase 7, 8, 9, 10, 12, or 13 according to the approved design.

- [ ] **Step 3: Align detailed feature ownership**

Keep the detailed requirement sections, but annotate future ownership explicitly:

```markdown
### 3.8 项目管理（Phase 11）
### 3.9 表格识别与提取（Phase 4 已完成基础能力，Phase 7 增强）
### 3.10 桌面应用识别（Phase 9）
### 3.11 瞬态元素与冻结捕获（Phase 5 / Phase 9）
### 3.12 JavaScript 指令生成（Phase 8）
### 3.13 AI 辅助（Phase 12）
```

Split table export into completed CSV/JSON/Markdown and Phase 7 Excel export. Mark delayed capture as Phase 5 and Native freezing as Phase 9.

- [ ] **Step 4: Replace Phase 4–13 roadmap entries**

Use the exact phase names and relative periods from Global Constraints. For every phase include:

```markdown
### Phase N：阶段名称（相对周期，状态）

**目标**：一句可验收目标。

| 任务 | 描述 |
|------|------|
| N.1 | 独立且明确的交付项 |

**阶段验收标准**：

1. 可观察、可验证的结果。
```

Copy the approved scope and safety gates from the design without adding new capabilities. Phase 9 must state that freezing is not a prerequisite for UIAutomation acceptance; Phase 10 must gate XAML on real UiPath Studio verification; Phase 12 must require local validation of AI recommendations.

- [ ] **Step 5: Replace the milestone overview**

Create one row per Phase 0–13. Mark Phase 0–4 as completed and Phase 5–13 as planned. Use the exact periods in Global Constraints and describe one primary value per milestone.

- [ ] **Step 6: Reconcile open questions and cross-references**

Retain unresolved product choices, but update their target phases:

```markdown
- `.uiproj` compatibility and version fields → Phase 11
- UiPath XML/XAML compatibility target → Phase 10
- desktop sample applications and sidecar choice → Phase 9
- external/private AI model policy → Phase 12
```

Remove wording that still describes project saving as MVP or AI as part of Phase 8.

- [ ] **Step 7: Run automated consistency checks**

Run:

```powershell
rg -n "项目管理和表格提取|第 12-15 周|第 16-17 周|第 18-19 周|第 20 周以后|Phase 8.*AI|Phase 9.*企业" REQUIREMENTS.md
```

Expected: no matches.

Run:

```powershell
rg -n "^### Phase (4|5|6|7|8|9|10|11|12|13)|^\\| Phase (4|5|6|7|8|9|10|11|12|13)" REQUIREMENTS.md
```

Expected: Phase 4–13 each appears once in the detailed roadmap and once in the milestone overview.

Run:

```powershell
rg -n "项目管理|\\.uiproj|Selector 回归验证" REQUIREMENTS.md
```

Expected: roadmap ownership points to Phase 11; no MVP-required row remains.

- [ ] **Step 8: Perform structural and Markdown validation**

Run:

```powershell
git diff --check
git diff -- REQUIREMENTS.md
```

Expected: no whitespace errors; the diff covers overview/MVP scope, detailed ownership, Phase 4–13 roadmap, milestones, and open questions.

- [ ] **Step 9: Commit**

```powershell
git add REQUIREMENTS.md
git commit -m "docs: resequence project roadmap"
```
