# FinSentinel — STAGE04 User Manual

*FinSentinel — Financial Crime Risk Assessment Workbench*

> AI prepares. Rules calculate. Humans decide.

| Field | Value |
|---|---|
| Stage | **STAGE04 — Testing** (validation, quality assurance, test automation) |
| Date | 2026-09-30 |
| Audience | Product Owners, FCRM Analysts, Risk Committee members, FCRM Administrators, and the judging panel |
| How it was produced | Every screenshot comes from one scripted walkthrough of the real application in Chromium (`npm run manual:capture`, `tests/manual/capture.spec.ts`). The diagrams are generated from the workflow and RBAC source (`scripts/manual/diagrams.ts`). Nothing is mocked up by hand. |
| Data | Synthetic only. Four seeded simulation users, two seeded demo cases (RA-1001, RA-1002), sample documents per change type. |
| Companion documents | `STAGE04_Testing_Report.md` (what was tested), `STAGE02_Design_UX.md` (screen design), `STAGE02_Design_Architecture.md` (behaviour) |

---

## 1. What FinSentinel does

FinSentinel prepares evidence-backed financial-crime risk assessments for new products, features, vendors, geographies, channels, customer segments, processes and transaction changes. A code-orchestrated AI pipeline reads the submitted documents, extracts facts with their sources, retrieves the applicable policy sections and drafts an assessment in which every claim cites a quote. A deterministic risk engine calculates inherent and residual risk from a versioned risk model. People then do the parts that matter: the analyst challenges and corrects, the committee decides, and every action lands in an append-only, hash-chained audit trail.

Three rules shape every screen in this manual:

- **AI prepares.** AI output is labelled *AI prepared* and is advisory. Unsupported claims are flagged, never hidden (FR-ASM-02, FR-ASM-03).
- **Rules calculate.** Risk scores come from the risk engine, not the model. Controls reduce risk but never eliminate it (FR-RSK-01, FR-RSK-08).
- **Humans decide.** Only a Risk Committee user can record a decision, and only after the analyst has finalized (FR-WF-07, FR-WF-09). An AI failure leaves the case pending; it never approves or rejects (FR-FAIL-04).

## 2. Getting started

### 2.1 Install and start

On Windows with Node 24, run the installer once from the repository root. It checks the toolchain, sets the proxy trust variable, creates `.env` with a generated secret, installs dependencies, migrates and seeds the database and builds the web app.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1
npm start        # http://localhost:3000
```

The default configuration uses the mock LLM gateway, which replays recorded fixtures, so no API key is needed. Set `LLM_GATEWAY=anthropic` and `ANTHROPIC_API_KEY` in `.env` to use the real model. The rest of this manual is identical either way.

### 2.2 Sign in

Sign-in is **simulation mode**: pick a role tile, no password. Each tile is a seeded synthetic user. The header always shows the active role badge and user, and the "Synthetic data · simulation sign-in" pill reminds you that nothing here is real.

| Tile | Role | What they do |
|---|---|---|
| Pat Owner | Product Owner | Creates cases, attaches documents, answers information requests, follows the decision |
| Kim Analyst | FCRM Analyst | Reviews the AI's work, clears blockers, sets controls, overrides with rationale, finalizes |
| Lee Committee | Risk Committee | Reviews the packet and records the decision |
| Raj Admin | FCRM Administrator | Publishes risk model versions, watches the Quality Center and Ops |

![Sign in — role tiles](manual/screenshots/00-signin-light.png)

*Figure 2.1 — Sign-in with role tiles (UX §4.1). The theme toggle in the header switches between light and dark and the choice persists across reloads.*

![Case list in dark theme](manual/screenshots/01-cases-dark-theme.png)

*Figure 2.2 — The same application in dark theme (UX §4.1a).*

### 2.3 Navigation

The left rail has **Cases**, **Quality Center** and **Ops** for every role, and **Admin** for the administrator only. A case opens as a workspace with seven tabs: Overview, Facts, Evidence, Assessment, Risk, Committee and History. Tabs show a count badge when they contain something that needs attention. Actions a role cannot perform are absent from its screens rather than greyed out (UX §7).

## 3. The workflow at a glance

### 3.1 Case lifecycle

![Case lifecycle by role](manual/diagrams/case-lifecycle.png)

*Figure 3.1 — Case states and transitions, one swim lane per actor. Generated from the workflow state machine in `src/domain/workflow.ts` (FR-WF-01..09).*

| State | Meaning | Who moves it on |
|---|---|---|
| SUBMITTED | Case created with documents | Product Owner or Analyst starts the AI review |
| ASSESSMENT | The pipeline is running | The pipeline finishes, or the analyst uses *manual continue* after a failed LLM step |
| ANALYST_REVIEW | Analyst clears blockers, challenges and overrides | Analyst requests information or finalizes |
| INFO_REQUESTED | Waiting on the Product Owner | Owner answers, or the analyst accepts the gap with rationale |
| COMMITTEE_REVIEW | Packet is ready for decision | Committee approves, approves with conditions, rejects, or defers back to the analyst |
| DECIDED | Decision recorded with rationale and conditions | Committee closes the case |
| CLOSED | Read-only; audit chain verifiable | Nobody. Closed cases cannot change. |

An invalid transition is rejected by the server (FR-WF-02). A case cannot skip a state, and no code path exists for the system to record a decision itself.

### 3.2 The AI assessment pipeline

![AI assessment pipeline](manual/diagrams/pipeline.png)

*Figure 3.2 — Ten fixed steps. Purple steps call the model; green steps are deterministic code. Each step persists its result, and a failed model step stops the run in ASSESSMENT (AD-05, FR-FAIL-02).*

You see this pipeline twice in the UI: as the animated **AI Review In Progress** dialog while it runs, and as the **Pipeline** card on the case Overview afterwards, with per-step counts, token usage and cost for the case.

### 3.3 Journey per role

![Journey per role](manual/diagrams/role-journeys.png)

*Figure 3.3 — What each role does, in order. The four sections that follow walk through each row with screenshots.*

## 4. Product Owner journey

Sign in as **Pat Owner**. The Product Owner can create cases, attach documents, run the AI review on their own cases and answer information requests. They can read everything on a case but see no analyst or committee controls.

### 4.1 Case list

![Owner case list](manual/screenshots/10-owner-case-list.png)

*Figure 4.1 — The case list with status pills. Only the Product Owner sees the **New case** button (FR-INT-01).*

### 4.2 Create a case

Choose a change type, give the case a title and description, then attach documents. You can upload PDF, DOCX or XLSX files (FR-INT-03), or select **Use sample documents** to attach the synthetic document set for that change type. Sample titles are fixed because the mock gateway keys its fixtures on them.

![New case form, empty](manual/screenshots/11-owner-new-case-empty.png)

*Figure 4.2 — The empty New Case form. Mandatory fields are validated before the case is created (FR-INT-02).*

![New case form filled from sample documents](manual/screenshots/12-owner-new-case-filled-from-sample.png)

*Figure 4.3 — Vendor change type selected and the sample document set attached. The **Create case** button enables once the form is valid.*

### 4.3 Watch the AI review

Creating the case starts the pipeline and opens the **AI Review In Progress** dialog. Each bullet is checked as the server completes that step; the dialog never runs ahead of the server. You can close it and continue in the background at any time.

![AI review in progress](manual/screenshots/13-owner-ai-review-in-progress.png)

*Figure 4.4 — Parse is done and Extract is checking. The percentage and progress bar follow the persisted pipeline steps.*

![AI review complete](manual/screenshots/14-owner-ai-review-complete.png)

*Figure 4.5 — All ten steps checked. The dialog hands over to the case; nothing has been decided.*

### 4.4 Read the Overview

![New case overview](manual/screenshots/15-owner-new-case-overview.png)

*Figure 4.6 — Overview of the newly created case. Top to bottom: an **instruction-like content** banner because the vendor questionnaire contains text that reads like an instruction to the AI (it was treated as content, FR-ADV-01, FR-ADV-03); the Pipeline card with per-step results and token usage for the case; Blockers that the analyst must clear; the Current Calculation from the risk engine; and the Frozen Versions of the risk model, policies, prompts and models used (FR-VER-02, FR-VER-03).*

### 4.5 What the owner cannot do

![Owner sees the Committee tab read-only](manual/screenshots/16-owner-committee-tab-read-only.png)

*Figure 4.7 — The Committee tab as the Product Owner. The packet notice is visible but there is no decision block. Decision controls exist only for the Risk Committee (FR-WF-07, FR-RBAC).*

### 4.6 Answer an information request

When the analyst requests information, the case moves to INFO_REQUESTED and the owner sees an answer box against each open request on the Facts tab.

![Owner answering an information request](manual/screenshots/30-owner-answer-information-request.png)

*Figure 4.8 — Answering the transaction-volume request (FR-INT-08). The value was missing from the documents; the system asked rather than guessing (FR-MIS-02, FR-MIS-03).*

![Request answered, case back in analyst review](manual/screenshots/31-owner-request-answered.png)

*Figure 4.9 — Once every open request is answered the case returns to ANALYST_REVIEW automatically.*

### 4.7 Follow the decision

![Final case list](manual/screenshots/80-owner-case-list-final.png)

*Figure 4.10 — The case list at the end of the walkthrough. RA-1001 is CLOSED; the new vendor case waits in analyst review.*

![Owner sees the recorded decision](manual/screenshots/81-owner-sees-decision.png)

*Figure 4.11 — The owner opens the Committee tab of the closed case and reads the decision, rationale and conditions.*

## 5. FCRM Analyst journey

Sign in as **Kim Analyst**. The analyst owns everything between the AI's draft and the committee's decision: confirming facts, resolving contradictions, requesting information, challenging claims, rating controls, overriding scores with rationale and finalizing.

### 5.1 Read the blockers

![Analyst overview with blockers](manual/screenshots/20-analyst-overview-blockers.png)

*Figure 5.1 — RA-1001 straight after the pipeline. Four blockers hold the **Finalize → Committee** button disabled: an unsupported claim, unresolved contradictions, an open information request and an unconfirmed low-confidence fact. Each blocker links to the tab where it is cleared (FR-MIS-04, FR-ASM-03, FR-CON-02).*

### 5.2 Facts: confirm, resolve, request

![Facts tab](manual/screenshots/21-analyst-facts-tab.png)

*Figure 5.2 — Every fact shows its value, confidence and the document quote it came from (FR-EXT-03). Missing values stay empty with a reason; nothing is invented (FR-EXT-04). Low-confidence facts carry a **Confirm** action.*

![Resolve contradiction dialog](manual/screenshots/22-analyst-resolve-contradiction-dialog.png)

*Figure 5.3 — A contradiction between the product proposal and the vendor questionnaire on geographies. Both values are shown side by side; the analyst picks one and must give a rationale of at least 20 characters. The system never silently chooses (FR-CON-02, FR-CON-03).*

![Information requested](manual/screenshots/23-analyst-info-requested.png)

*Figure 5.4 — After **Request information** the case is INFO_REQUESTED and the owner is asked for the missing transaction volume. The analyst may instead **Accept gap** with a rationale, which documents the missing value as a known gap (FR-MIS-04).*

### 5.3 Evidence and claims

![Evidence tab](manual/screenshots/40-analyst-evidence-tab.png)

*Figure 5.5 — The policy sections retrieved for this case, each tagged with the dimension it supports and its policy version (FR-RET-01, FR-RET-03).*

![Assessment claims with verdicts](manual/screenshots/41-analyst-assessment-claims.png)

*Figure 5.6 — The AI assessment. The narrative is labelled **AI prepared** with the model and prompt version. Every claim carries a verdict: SUPPORTED when the cited quote was found in the evidence chunk, WEAK when only some citations verify, UNSUPPORTED when none do (FR-ASM-02). Verdict counts sit top right.*

![Attach evidence dialog](manual/screenshots/42-analyst-attach-evidence-dialog.png)

*Figure 5.7 — For an unsupported claim the analyst can attach an evidence chunk that supports it, or remove the claim. Both are audited (FR-OVR-08).*

![Remove claim dialog](manual/screenshots/43-analyst-remove-claim-dialog.png)

*Figure 5.8 — Removing the claim "Vendor has strong sanctions controls", an unsupported self-assertion from the vendor document (FR-ADV-04), with rationale.*

### 5.4 Risk: the calculation, controls and overrides

![Risk tab with formula shown](manual/screenshots/44-analyst-risk-tab-formula.png)

*Figure 5.9 — The Risk tab. Per dimension: weight, the AI's recommended score (purple, advisory), the current score, the control rating and the inherent and residual values. The three chips separate **AI prepared**, **Human decided** and **Rules calculated**. **Show formula** reveals the exact arithmetic (FR-RSK-03, FR-ASM-05).*

![Control rating dialog](manual/screenshots/45-analyst-control-rating-dialog.png)

*Figure 5.10 — Rating the geography control as **adequate** with rationale. Unverified controls count as none; strong controls mitigate more than weak ones (FR-RSK-07).*

![Override dialog](manual/screenshots/46-analyst-override-dialog.png)

*Figure 5.11 — Overriding geography from 4 High to 3 Moderate. The submit button stays disabled until the rationale reaches 20 characters (FR-OVR-01, FR-OVR-02).*

![Risk after override](manual/screenshots/47-analyst-risk-after-override.png)

*Figure 5.12 — The engine recalculates immediately (FR-OVR-04, FR-RSK-10). The row shows the override and control with their rationales; residual stays at or above the configured floor and never exceeds inherent (FR-RSK-08).*

### 5.5 History

![History with verified hash chain](manual/screenshots/48-analyst-history-verified.png)

*Figure 5.13 — The audit timeline for the case, newest first. **Verify** walks the SHA-256 hash chain and reports the result. Events cannot be edited or deleted; the previous value of every override stays visible (FR-AUD-03, FR-AUD-05, FR-AUD-06, FR-OVR-06).*

### 5.6 Finalize

![Overview ready to finalize](manual/screenshots/49-analyst-overview-ready-to-finalize.png)

*Figure 5.14 — All blockers cleared, so **Finalize → Committee** is enabled.*

![Finalized to committee](manual/screenshots/50-analyst-finalized-to-committee.png)

*Figure 5.15 — The case is now COMMITTEE_REVIEW. The analyst's work is frozen into the packet (FR-WF-09, FR-ASM-07).*

## 6. Risk Committee journey

Sign in as **Lee Committee**. The committee reads the packet and records the decision. It cannot edit facts, claims or scores.

![Committee packet and decision block](manual/screenshots/60-committee-packet-and-decision-block.png)

*Figure 6.1 — The Committee tab. The packet header confirms audit integrity, no blockers and all claims supported. The dimension table shows every analyst override and control rating with its rationale (FR-OVR-07). Below the packet is the decision block, visible only to this role.*

![Decision filled in](manual/screenshots/61-committee-decision-filled.png)

*Figure 6.2 — Choosing **Approve with conditions**, adding a condition and a rationale. The permitted decisions are Approve, Approve with conditions, Defer and Reject (FR-WF-03). Defer sends the case back to analyst review without recording a decision (FR-WF-05).*

![Decision recorded](manual/screenshots/62-committee-decision-recorded.png)

*Figure 6.3 — The decision is recorded with type, timestamp, rationale and conditions (FR-WF-04, FR-WF-06). A database trigger and the RBAC layer both refuse a decision from any non-committee actor.*

![Case closed](manual/screenshots/63-committee-case-closed.png)

*Figure 6.4 — **Close case** archives the case as CLOSED. The audit trail is preserved.*

![Committee verifies history](manual/screenshots/64-committee-history-verified.png)

*Figure 6.5 — The committee verifies the hash chain on the closed case.*

## 7. FCRM Administrator journey

Sign in as **Raj Admin**. The administrator owns the risk model and watches quality and operations.

### 7.1 Quality Center

![Quality Center](manual/screenshots/70-admin-quality-center.png)

*Figure 7.1 — FinSentinel Quality Center. Release status is derived from the quality gates; software tiles come from the latest Playwright results and AI tiles from the latest golden-dataset evaluation. No value is hard-coded (FR-QC-01..05).*

![Live adversarial test result](manual/screenshots/71-admin-adversarial-prompt-injection-result.png)

*Figure 7.2 — **Run now** on the prompt-injection test creates a sandbox case with a hostile document and shows the result live (FR-QC-06, FR-ADV-01, FR-ADV-02).*

### 7.2 Ops

![Ops dashboard](manual/screenshots/72-admin-ops-dashboard.png)

*Figure 7.3 — Operations dashboard: health, throughput, latency, LLM failures, tokens and cost, cases by state (FR-OBS-01..04).*

### 7.3 Risk model editor

![Risk model editor](manual/screenshots/73-admin-risk-model-editor.png)

*Figure 7.4 — Editing weights, control effectiveness, floor and maximum band drop. The weights hint must total 100 before publishing is allowed; the preview applies the engine's own formula to a High score so the effect is visible before publishing (FR-RSK-04, FR-RSK-05).*

![Risk model published](manual/screenshots/74-admin-risk-model-published.png)

*Figure 7.5 — Version 1.1 published with notes. Existing cases keep the version they were assessed with (FR-VER-03); new calculations use the new version.*

## 8. Who can do what

Derived from the RBAC matrix in `src/domain/rbac.ts`. The server enforces it on every route and the UI hides what a role cannot do.

| Action | Product Owner | FCRM Analyst | Risk Committee | FCRM Admin |
|---|---|---|---|---|
| Create case, upload documents | ✓ | | | |
| Answer information request | ✓ | | | |
| Run / re-run AI review | ✓ | ✓ | | |
| Manual continue after a failed LLM step | | ✓ | | |
| Confirm or enter facts, resolve contradictions, accept gaps | | ✓ | | |
| Edit assessment, remove claims, attach evidence | | ✓ | | |
| Set control ratings, override scores | | ✓ | | |
| Finalize to committee | | ✓ | | |
| View committee packet | | ✓ | ✓ | |
| Record decision, close case | | | ✓ | |
| Publish risk model | | | | ✓ |
| Run adversarial test live | | ✓ | | ✓ |
| View cases, history, risk model, Quality Center, Ops | ✓ | ✓ | ✓ | ✓ |

## 9. Rules the application enforces

These hold regardless of role or screen. They are tested in `tests/unit`, `tests/security` and `tests/adversarial`.

- **Rationale is mandatory.** Overrides, contradiction resolutions, accepted gaps, control ratings, claim removals and decisions all need at least 20 characters. Overrides are also checked by a database constraint.
- **Finalize is guarded.** Any unsupported claim, unresolved contradiction, open required information request or unconfirmed low-confidence fact blocks finalization, as does a missing current calculation.
- **Controls mitigate, never eliminate.** Residual risk is at most inherent and at least the configured floor, which is above zero. Unverified controls count as none.
- **Claims cite quotes.** A claim with no verifiable citation is UNSUPPORTED and blocks finalization until the analyst attaches evidence or removes it.
- **Missing stays missing.** A fact the documents do not contain has no value and a missing reason. It becomes an information request, never a guess.
- **Audit is append-only.** Database triggers reject updates and deletes; a SHA-256 hash chain makes tampering detectable from the History tab.
- **Only the committee decides.** The decisions table accepts writes only from a committee-role actor, enforced by a trigger as well as by RBAC.
- **AI failure is safe.** A model timeout, HTTP error, invalid JSON, empty response or refusal marks the step failed and leaves the case in ASSESSMENT. The analyst sees the failure and can continue manually. No decision is ever produced by the failure path.
- **Documents are data.** Text inside documents is wrapped as evidence in prompts. Instruction-like text is flagged with a banner and treated as content.

## 10. Troubleshooting

| Symptom | Cause | What to do |
|---|---|---|
| **Finalize → Committee** is disabled | Blockers remain | Follow the links on each blocker; clear them on the Facts and Assessment tabs |
| Pipeline card shows a failed step | The model call failed or returned unusable output | Read the step error, fix the input if relevant, then **Re-run**, or as analyst use **manual continue** to proceed with the rule-based results |
| No decision block on the Committee tab | You are not signed in as Risk Committee, or the case is not in COMMITTEE_REVIEW | Sign in as Lee Committee; ask the analyst to finalize |
| **Publish** is disabled in the risk model editor | Weights do not total 100, or notes are empty | Adjust weights until the hint reads 100; add publish notes |
| Sample documents do not appear on New Case | No change type selected | Select a change type first; each type has its own sample set |
| `npm install` fails with a TLS error | Node does not trust the corporate proxy certificate | Run `scripts/install.ps1`, or set `NODE_USE_SYSTEM_CA=1` and open a new terminal |
| History **Verify** reports a break | An audit row was altered outside the application | Treat the case as compromised; the chain identifies the first broken event |

## 11. Regenerating this manual

```powershell
npm run manual:capture      # regenerates diagrams (SVG), then drives Chromium and rewrites every screenshot and PNG
npm run manual:pdf          # renders this document to documents/STAGE04_User_Manual.pdf (A4, page numbers, one section per page)
```

The capture starts a fresh in-memory server from `.env.test` on port 3100, so seeded cases are always in their initial state and the walkthrough is repeatable. Screenshots land in `documents/manual/screenshots/`, diagrams in `documents/manual/diagrams/`. The run is not part of `npm test` or `npm run test:e2e`.

A local MCP server was considered for driving the simulation. None is configured in this project, so the walkthrough uses Playwright, the same mechanism as the e2e suite. That keeps the manual reproducible in CI with no extra dependency.

## 12. Traceability

| Section | Screens | Requirements shown | Acceptance criteria |
|---|---|---|---|
| 2 Getting started | Sign-in, theme | FR-RBAC, NFR-SEC (simulation mode), UX §4.1, §4.1a | AC-15 |
| 4 Product Owner | Case list, New Case, AI review, Overview, Facts (answer) | FR-INT-01..03, FR-INT-08, FR-EXT-05, FR-MIS-02, FR-ADV-03, FR-VER-02/03 | AC-01, AC-02 |
| 5 Analyst | Facts, Evidence, Assessment, Risk, History, Finalize | FR-EXT-03/04, FR-CON-02/03, FR-MIS-04, FR-RET-01/03, FR-ASM-02/03/05, FR-RSK-03/07/08/10, FR-OVR-01..06/08, FR-AUD-03/05/06, FR-WF-09 | AC-03..AC-08, AC-10 |
| 6 Committee | Committee tab, History | FR-WF-03..07, FR-OVR-07, FR-ASM-07 | AC-01, AC-09 |
| 7 Administrator | Quality Center, Ops, Risk model | FR-QC-01..06, FR-OBS-01..04, FR-RSK-04/05, FR-VER-03, FR-ADV-01/02 | AC-11..AC-13, AC-16 |
| 9 Rules | All | FR-FAIL-02/04, FR-RSK-08, FR-AUD-03, FR-WF-07, FR-ADV-01 | AC-06, AC-08, AC-10, AC-14 |
