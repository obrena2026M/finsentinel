# FinSentinel — User Experience Design

*FinSentinel — Financial Crime Risk Assessment Workbench*

| Field | Value |
|---|---|
| Stage | **STAGE02 — Design** (document 3 of 3: UX) |
| Companion docs | `STAGE02_Design_Architecture.md`, `STAGE02_Design_Data_Model.md` |
| Version | 1.0 (2026-09-28) |

Design goal: the UI must make the three layers visible at all times — what the **AI prepared**, what the **rules calculated**, and what the **human decided**. Every AI output is labelled, every calculated number is explainable, every human action needs a reason.

---

## 1. Design principles

| # | Principle | Implementation |
|---|---|---|
| U1 | Three-column truth | Every dimension row shows AI recommendation · Calculated · Human override side by side (UX-01). |
| U2 | Evidence one click away | Every fact, claim and evidence reference opens the source snippet in a side panel. |
| U3 | Warnings are blockers, not decorations | Missing info, contradictions, unsupported claims and low-confidence facts appear in a **Blockers** rail and disable Finalize until cleared (UX-02/03). |
| U4 | Rationale is a form field, not a comment | Override, resolve, accept-gap and decision dialogs cannot submit with an empty rationale (UX-04). |
| U5 | Failure is a state, not a toast | LLM failure renders an inline failure card with "Continue manually"; nothing disappears (UX-07). |
| U6 | Role-appropriate surfaces | Navigation and actions are filtered by role; forbidden actions are absent, not greyed. |
| U7 | Demo-first density | Screens are designed to be read on a projector: large status chips, few colours, no dense tables without headers. |

---

## 2. Information architecture

```
/signin                         Role tiles / user picker (no password)
/cases                          Case list (all roles; filtered)
/cases/new                      Create case (Product Owner)
/cases/:id                      Case workspace
   ├─ #overview                 Status, pipeline, blockers
   ├─ #facts                    Extracted facts, missing, contradictions
   ├─ #evidence                 Retrieved policy sections + document chunks
   ├─ #assessment               AI narrative, claims with verdicts
   ├─ #risk                     Dimension table, inherent/residual, overrides, controls
   ├─ #committee                Packet + decision (Committee), read-only otherwise
   └─ #history                  Audit timeline + integrity check
/quality                        FinSentinel Quality Center
/ops                            Operations dashboard
/admin/risk-model               Risk model editor (Admin)
```

Global shell: top bar (product name, role badge, user menu with **Switch user**, theme toggle ☀/☾), left nav (Cases, Quality Center, Ops, Admin if role), main content, right **context panel** (evidence viewer / blockers).

---

## 3. Personas and journeys

All journeys start at `/signin` by selecting a role tile.

| Role | Primary journey | Screens |
|---|---|---|
| Product Owner | Create case → upload docs → watch pipeline → answer information requests → see decision | /cases/new, /cases/:id overview + facts |
| FCRM Analyst | Open case → clear blockers → challenge AI → set controls → override with rationale → finalize | /cases/:id all tabs |
| Risk Committee | Open packet → review evidence & overrides → decide with rationale/conditions | /cases/:id committee, history |
| FCRM Admin | Publish risk model version → view Quality Center | /admin/risk-model, /quality |

---

## 4. Screens

### 4.1 Sign in — role tiles (simulation, no password)

This is a simulation with synthetic users. Sign-in is a **user picker**, not an authentication challenge. Selecting a tile creates a server session for that user and role; all RBAC rules (Architecture §9.2) then apply exactly as they would after a real login. Password is not required and no password field is shown. The session-cookie mechanism is unchanged, so swapping in real authentication later is a change to this one screen and one route.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  FinSentinel                                                     ☀ / ☾ Theme │
│  Financial Crime Risk Assessment Workbench                                   │
│  Synthetic environment — no real data · Simulation sign-in (no password)     │
│                                                                              │
│  Choose who you are for this session                                         │
│                                                                              │
│  ┌──────────────────────┐  ┌──────────────────────┐                          │
│  │ 👤 Pat Owner          │  │ 🔎 Kim Analyst        │                          │
│  │ PRODUCT OWNER         │  │ FCRM ANALYST          │                          │
│  │ Submits changes,      │  │ Reviews and challenges│                          │
│  │ uploads documents,    │  │ AI output, overrides  │                          │
│  │ answers information   │  │ with rationale,       │                          │
│  │ requests.             │  │ finalizes assessment. │                          │
│  │ Cannot approve/reject.│  │ Cannot decide.        │                          │
│  │        [ Continue ]   │  │        [ Continue ]   │                          │
│  └──────────────────────┘  └──────────────────────┘                          │
│  ┌──────────────────────┐  ┌──────────────────────┐                          │
│  │ ⚖ Lee Committee       │  │ ⚙ Raj Admin           │                          │
│  │ RISK COMMITTEE        │  │ FCRM ADMINISTRATOR    │                          │
│  │ Reviews packet and    │  │ Publishes risk model  │                          │
│  │ overrides; approves,  │  │ versions, views       │                          │
│  │ approves w/ conditions│  │ Quality Center and    │                          │
│  │ defers or rejects.    │  │ Ops.                  │                          │
│  │ Cannot edit evidence. │  │ Cannot assess/decide. │                          │
│  │        [ Continue ]   │  │        [ Continue ]   │                          │
│  └──────────────────────┘  └──────────────────────┘                          │
│                                                                              │
│  Or pick from list: [ Select user ▾ ]                                        │
└──────────────────────────────────────────────────────────────────────────────┘
```

Behaviour:

- Tiles and the dropdown are two views of the same `GET /api/auth/users` list (display name, username, role, role description). The dropdown exists for narrow screens and keyboard users.
- Selecting a tile calls `POST /api/auth/login { username }` and redirects to `/cases`. No password field is rendered. The backend accepts an optional `password` for forward compatibility and ignores it when `AUTH_MODE=simulation` (the only mode in the hackathon).
- The role badge in the top bar shows the chosen role at all times, and a **Switch user** action in the user menu returns to this screen (ends the session, audited as `logout`).
- Every audit event still records the real selected user and role, so the History tab remains meaningful in the demo.

**Role access summary shown on tiles** (authoritative matrix is §7 and PRD §4.2):

| Role | Can | Cannot |
|---|---|---|
| Product Owner | Create case, upload documents, answer information requests, view status and history | Approve, reject, override, edit assessment, change risk model |
| FCRM Analyst | Review and challenge AI output, confirm facts, resolve contradictions, set controls, override with rationale, edit assessment, finalize | Record committee decision, change risk model, alter history |
| Risk Committee | Review packet, evidence and overrides; approve, approve with conditions, defer, reject | Edit facts/assessment/evidence, change risk model, alter history |
| FCRM Administrator | Publish risk model versions, view Quality Center and Ops | Assess, override, decide, alter history |

### 4.1a Theme — light and dark

The UI supports a light and a dark theme.

- Toggle in the top bar (☀ / ☾) and on the sign-in screen; choice persists in `localStorage` and follows `prefers-color-scheme` on first visit.
- Implemented with CSS custom properties on `:root[data-theme="light|dark"]`; components never hard-code colours.
- Semantic tokens (not raw colours) for everything that carries meaning: `--band-very-low … --band-very-high`, `--state-*`, `--verdict-supported / -unsupported / -weak`, `--warning`, `--danger`, `--success`. Each token has a light and a dark value that meets WCAG AA contrast (≥ 4.5:1 for text, ≥ 3:1 for chips) on its background.
- Wireframes and ASCII art in this document are theme-neutral; icons and words always accompany colour (§6), so both themes convey the same meaning.
- Playwright E2E runs the demo path in both themes (`colorScheme: 'light' | 'dark'` projects) and captures screenshots for the Quality Center.

### 4.2 Case list

```
┌ Cases ──────────────────────────────────────────────── [ + New case ] (PO) ┐
│ Filter: [All states ▾] [All types ▾]  Search [__________]                   │
│ Ref      Title                              Type     State            Residual │
│ RA-1028  International Instant Payments SMB product  ANALYST REVIEW   ● High   │
│ RA-1027  Domestic savings goal feature      feature  COMMITTEE REVIEW ● Low    │
│ RA-1026  New KYC vendor onboarding          vendor   ASSESSMENT  ⟳ step 7/10   │
│ RA-1025  Launch international payments      product  INFO REQUESTED  ⚠ 5 gaps  │
└──────────────────────────────────────────────────────────────────────────────┘
```

State chips use one hue per state; residual band chips use the five-band scale.

### 4.3 Create case (Product Owner)

Fields: Title*, Change type* (select), Description* (multiline, min 50 chars), Documents (drag-drop; PDF/DOCX/XLSX; each shows type check result immediately). Submit → case created in SUBMITTED, pipeline starts, redirect to overview. Validation errors inline under fields (FR-INT-02). Unsupported file → red row "Unsupported type (.exe). Allowed: PDF, DOCX, XLSX" (FR-INT-04).

### 4.4 Case workspace — Overview

```
┌ RA-1028  International Instant Payments for SMB              State: ANALYST REVIEW ┐
│ Product change · Submitted by owner.pat · Risk model v1.3 · Prompts ext v2 / asm v4 │
├────────────────────────────────────────────────┬─────────────────────────────────────┤
│ PIPELINE                                       │ BLOCKERS (4)                        │
│ ✓ Parse 2 docs        ✓ Extract 17 facts       │ ⚠ 3 missing facts   → Facts        │
│ ✓ Contradictions 1    ✓ Missing 3              │ ⚠ 1 contradiction   → Facts        │
│ ✓ Scope 6 dims        ✓ Retrieve 9 sections    │ ⚠ 1 unsupported claim → Assessment │
│ ✓ Assess              ✓ Ground 11/12 supported │ ⚠ 2 low-confidence facts → Facts   │
│ ✓ Score  Inherent 3.9 High → Residual 3.1 Mod  │                                     │
│ Tokens this case: 21,430 in · 3,880 out ·      │ [ Finalize → Committee ] (disabled) │
│ 14,200 cache read · $0.41                      │  "Clear 4 blockers to finalize"     │
├────────────────────────────────────────────────┴─────────────────────────────────────┤
│ ⚠ Document "vendor_questionnaire.xlsx" contains instruction-like text.               │
│   Treated as document content. Not used as an instruction.        [View]            │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

LLM failure variant of the pipeline card:

```
│ ✗ Assess — LLM service unavailable (HTTP 500 after 3 attempts, 14:02:11)            │
│   Case remains in ASSESSMENT. No decision has been made.                            │
│   [ Retry step ]   [ Continue manually → Analyst Review ]                           │
```

### 4.5 Facts tab

```
┌ FACTS ─────────────────────────────────────────────────────────────────────────────┐
│ Field               Value                 Conf  Status          Source              │
│ Customer segment    SMB                   0.96  ✓ extracted     proposal.docx §2  ↗ │
│ Geographies         Canada, Mexico        0.91  ⚠ conflicted    2 sources        ↗ │
│ Channel             API                   0.98  ✓ extracted     proposal.docx §4  ↗ │
│ Transaction volume  —                     —     ✗ missing       [Ask owner]        │
│ Third party         Yes — PayRail Inc.    0.88  ✓ extracted     vendor.xlsx r12   ↗ │
│ Monitoring coverage Partial               0.62  ⚠ low confidence [Confirm] [Edit]  │
├────────────────────────────────────────────────────────────────────────────────────┤
│ CONTRADICTION — Geographies                                                        │
│  Product proposal §3:      Canada, Mexico                     "…launch in CA & MX" │
│  Vendor questionnaire r8:  Canada, Mexico, Brazil             "…coverage incl BR"  │
│  Resolve as: (•) Canada, Mexico  ( ) Canada, Mexico, Brazil  ( ) Other [_______]   │
│  Rationale*: [__________________________________________________] [ Resolve ]       │
├────────────────────────────────────────────────────────────────────────────────────┤
│ INFORMATION REQUESTS (3 open)                                                      │
│  Transaction volume — "What is the expected monthly transaction volume…?"  open    │
│     [ Accept gap with rationale ]                                                  │
└────────────────────────────────────────────────────────────────────────────────────┘
```

Clicking ↗ opens the source chunk in the right panel with the quote highlighted. Confirm/Edit on low-confidence facts are audited. Product Owner sees the same tab read-only plus an **Answer** box on each open request.

### 4.6 Evidence tab

Two lists: **Policy evidence** (section ref, title, BM25 score, the query used, dimension) and **Document chunks** (per document, with injection flags marked). Each row opens full text in the context panel. Empty retrieval shows: "No policy sections matched. Assessment claims cannot be supported until evidence is attached."

### 4.7 Assessment tab

```
┌ AI ASSESSMENT  (claude-opus-5 · prompt v4 · 14:01:52)          [ Edit narrative ] ┐
│ Summary: The change introduces cross-border SMB payments via a third-party…        │
├────────────────────────────────────────────────────────────────────────────────────┤
│ CLAIMS                                                                             │
│ ✓ SUPPORTED   Cross-border SMB payments require enhanced transaction monitoring.    │
│               ↳ TM Standard §7  "…real-time monitoring for cross-border…"           │
│ ✓ SUPPORTED   Mexico is designated higher-risk in the AML Policy.                   │
│               ↳ AML Policy §5.3                                                     │
│ ⚠ UNSUPPORTED Vendor has strong sanctions controls.                                 │
│               No verifiable citation. Vendor self-assertion only (vendor.xlsx r20). │
│               [ Attach evidence ] [ Remove claim ]                                  │
│ ~ WEAK        Existing KYC controls cover the new segment.   ↳ KYC Std §2 (partial) │
└────────────────────────────────────────────────────────────────────────────────────┘
```

Verdict icons and words are always shown together (colour is not the only signal).

### 4.8 Risk tab — the demo centrepiece

```
┌ RISK  Risk model v1.3 · Calculation #3 (after override, 14:08:04)                  ┐
│ Dimension    Wt   AI rec.   Current   Control        Inherent  Residual            │
│ Geography    20%  4 High    3 Mod ✎   adequate (.6)  3.00      2.40                │
│              └ Overridden by analyst.kim 14:08:03 — "Comparable products have…"  ↗ │
│ Transaction  20%  4 High    4 High    weak (.3)      4.00      3.55                │
│ Third party  15%  4 High    4 High    unverified     4.00      4.00  ⚠ set control │
│ Channel      10%  3 Mod     3 Mod     strong (.9)    3.00      2.10                │
│ Customer     10%  3 Mod     3 Mod     adequate       3.00      2.40                │
│ Product      10%  3 Mod     3 Mod     none           3.00      3.00                │
│ Technology   10%  2 Low     2 Low     adequate       2.00      1.70                │
│ Process       5%  2 Low     2 Low     none           2.00      2.00                │
├────────────────────────────────────────────────────────────────────────────────────┤
│ INHERENT  3.35  ● High          →   RESIDUAL  2.93  ● Moderate                     │
│ Controls reduce but never eliminate risk (floor 1.0, max mitigation 50%).          │
│ [ Show formula ]                                                                    │
└────────────────────────────────────────────────────────────────────────────────────┘
```

Override dialog (opens from ✎):

```
┌ Override — Geography ─────────────────────────────┐
│ AI recommended: 4 High      Current: 4 High        │
│ New score:  (1) (2) (•3) (4) (5)                   │
│ Rationale* (min 20 chars)                          │
│ [Comparable existing products have established   ] │
│ [monitoring coverage and similar geographic…     ] │
│ Recorded: analyst.kim · Analyst · risk model v1.3  │
│                        [ Cancel ] [ Save override ] │
└────────────────────────────────────────────────────┘
```

Saving recalculates immediately; the RESIDUAL row animates from old to new value and a History entry appears. Control rating dialog is identical in shape (rating + rationale).

### 4.9 Committee tab

Read-only packet: header, final residual with band, dimension table (with override markers), overrides list with rationale, unsupported/weak claims (should be zero), evidence list, information gaps accepted with rationale, audit integrity status. Decision block (Committee only):

```
┌ DECISION ──────────────────────────────────────────────────────────────────┐
│ ( ) Approve   (•) Approve with conditions   ( ) Defer   ( ) Reject          │
│ Conditions*  1. [Complete vendor sanctions control testing before launch ] │
│              2. [Monthly TM tuning review for first 6 months            ] │
│              [ + condition ]                                               │
│ Rationale*   [__________________________________________________________] │
│ Deciding as committee.lee · Risk Committee                [ Record decision ] │
└────────────────────────────────────────────────────────────────────────────┘
```

Analysts and Product Owners see the packet but no decision block. Nothing in the UI, for any role, offers an "auto-approve".

### 4.10 History tab

```
14:12:41  committee.lee  Decision APPROVE_WITH_CONDITIONS (2 conditions)      ↗
14:08:04  system         Risk recalculated  3.35/High → 2.93/Moderate (model v1.3)
14:08:03  analyst.kim    Override Geography 4 → 3  "Comparable existing products…"
14:07:12  analyst.kim    Control set Channel = strong  "Existing API gateway…"
14:04:22  system         Risk calculated (pipeline)  3.9/High → 3.1/Moderate
14:04:21  system         Assessment drafted (claude-opus-5, prompt v4)
14:03:02  system         Risk scope: 6 dimensions
14:02:18  system         Documents processed (2)  ⚠ instruction-like content flagged
14:02:14  owner.pat      Case submitted
─────────────────────────────────────────────────────────────────────────────
Integrity: ✓ 9 events, hash chain verified 14:12:45     [ Verify again ]
```

Each row expands to previous/new JSON. There is no edit affordance anywhere on this tab.

### 4.11 FinSentinel Quality Center (`/quality`)

```
┌ FINSENTINEL QUALITY CENTER        last run 2026-09-28 13:40 · commit a1b2c3d ┐
│ SOFTWARE                                  AI QUALITY (golden set, 42 cases)   │
│ Unit          48/48   ● PASS              Fact extraction accuracy   96.2%    │
│ Integration    9/9    ● PASS              Retrieval precision        90.5%    │
│ Security      12/12   ● PASS              Evidence grounding         94.1%    │
│ Adversarial    7/7    ● PASS              Band agreement             88.1%    │
│ E2E           10/10   ● PASS              Unsupported claims          1.9%    │
│                                                                              │
│ ADVERSARIAL (live)                                                           │
│ Prompt injection        PASS  [Run now]   LLM failure handling  PASS [Run now]│
│ Contradiction detection PASS  [Run now]   Missing information    PASS [Run now]│
│                                                                              │
│ TOKENS  optimized 21.4K/case vs baseline 68.9K/case  (−69%)  cache hit 61%   │
│                                                                              │
│ RELEASE STATUS  ● PASS   (14/14 gates)                    [ Gate details ]   │
└──────────────────────────────────────────────────────────────────────────────┘
```

All numbers come from `/api/quality`; if no run exists the tiles show "No run yet", never a placeholder number (FR-QC-05). "Run now" executes the adversarial fixture against a sandbox case and streams the result.

### 4.12 Operations dashboard (`/ops`)

Tiles: API p50/p95 latency, error rate, DB status, LLM reachability, pipeline failures (24 h), tokens today, cost today, overrides (7 d), AI/analyst disagreement rate, cases by state, mean time to decision, health endpoints status.

### 4.13 Admin — Risk model (`/admin/risk-model`)

Left: active version JSON (read-only) with weights table. Right: editor for a new version with live validation ("Weights total 95% — must be 100%"). Publish requires a note; existing cases keep their frozen version (banner explains this).

---

## 5. Component inventory

| Component | Used in | Notes |
|---|---|---|
| `StateChip` | list, header | one hue per workflow state |
| `BandChip` | list, risk, packet | VeryLow…VeryHigh, icon + text |
| `VerdictBadge` | assessment | ✓ SUPPORTED / ⚠ UNSUPPORTED / ~ WEAK |
| `PipelineStepper` | overview | statuses, tokens, failure card |
| `BlockersRail` | overview, sticky | links to the tab that clears each blocker |
| `SourceLink` (↗) | facts, claims, evidence | opens `ContextPanel` |
| `ContextPanel` | right rail | chunk text with highlighted quote, flags |
| `RationaleDialog` | override, control, resolve, accept-gap, decision | shared form: fields + rationale (min 20) + actor line |
| `DimensionTable` | risk, packet | three-column truth |
| `AuditTimeline` | history | expandable rows |
| `StatTile` | quality, ops | label, value, trend, status |
| `InjectionBanner` | overview, evidence | fixed copy from FR-ADV-03 |
| `UserTile` | sign-in | name, role label, role description, Continue |
| `UserSelect` | sign-in | dropdown alternative to tiles |
| `ThemeToggle` | top bar, sign-in | ☀/☾, persists choice |

---

## 6. Interaction rules

- Mutating actions show an inline confirmation state, then an audit toast "Recorded in history".
- Disabled primary buttons always carry a reason string next to them.
- Long operations (pipeline) poll `/api/cases/:id/pipeline` every 2 s; no websockets.
- All dialogs are keyboard-navigable; focus returns to the trigger on close.
- Colour is never the sole carrier of meaning (icons + words everywhere); this also keeps light and dark themes equivalent.
- Theme switch applies instantly without reload and does not reset form state.
- Numbers: scores to 2 dp, percentages to 1 dp, tokens with thousands separators.

---

## 7. Role visibility matrix (UI)

| Element | PO | Analyst | Committee | Admin |
|---|---|---|---|---|
| New case button | ✓ | | | |
| Upload documents | ✓ (own cases) | | | |
| Answer information request | ✓ | | | |
| Confirm/edit facts, resolve contradictions | | ✓ | | |
| Override, control rating | | ✓ | | |
| Edit assessment / claims | | ✓ | | |
| Finalize | | ✓ | | |
| Decision block | | | ✓ | |
| Risk model editor | | | | ✓ |
| Quality Center, Ops | ✓ | ✓ | ✓ | ✓ |
| History tab | ✓ | ✓ | ✓ | ✓ |

---

## 8. Demo walkthrough mapping (PRD §13)

| Step | Screen / action |
|---|---|
| 0 Sign in | /signin: pick the **Pat Owner** tile (no password); optionally flip theme to show light/dark |
| 1 Submit | /cases/new as owner.pat, upload proposal + vendor questionnaire |
| 2 Extraction | Overview pipeline card: "17 facts · 3 missing · 6 dimensions" |
| 3 Missing info | Facts tab: information requests |
| 4 Evidence | Evidence tab |
| 5 AI assessment | Assessment tab, recommendation High |
| 6 Deterministic calc | Risk tab, "Show formula" |
| 7–9 Challenge | Risk tab ✎ Geography → RationaleDialog → live recalculation |
| 10 Audit | History tab + Verify |
| 11 To committee | Finalize (blockers cleared) |
| 12 Decision | Committee tab as committee.lee, Approve with conditions |
| 13 Quality Center | /quality |
| 14 Adversarial | Quality Center "Run now" on Prompt injection; then open the sandbox case to show the banner |
| 15 Metrics | Quality Center AI tiles + tokens tile |
| 16 Ops | /ops |

---

## 9. Traceability (UX → PRD)

| Screen / component | PRD IDs |
|---|---|
| Create case, uploads | FR-INT-01…06 |
| Overview pipeline + failure card | FR-ARC-04, FR-FAIL-02, UX-07 |
| InjectionBanner | FR-ADV-03 |
| Facts tab | FR-EXT-03…05, FR-MIS, FR-CON, UX-02 |
| Evidence tab | FR-RET-03/04 |
| Assessment tab | FR-ASM-02…05, UX-03 |
| Risk tab + RationaleDialog | FR-RSK-10, FR-OVR-01…07, UX-01, UX-04 |
| Committee tab | FR-WF-03…07, FR-OVR-07, UX-06 |
| History tab | FR-AUD-05/06, UX-05 |
| Quality Center | FR-QC-01…06, UX-08 |
| Ops dashboard | FR-OBS-04 |
| Admin risk model | FR-RSK-04/05, FR-RBAC-06 |
| Role visibility matrix | FR-RBAC-01…04 |
| Sign-in role tiles (simulation) | FR-RBAC-01, NFR-SEC-01 (simulation mode), NFR-SEC-10 |
| Light/dark theme | UX-01…08 (readability on projector and in both schemes) |
