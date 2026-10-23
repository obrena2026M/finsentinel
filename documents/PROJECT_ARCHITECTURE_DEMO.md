# FinSentinel — The Architecture Behind the Decision

*A 2–2.5 minute demo narrative · Stages 01–06*

> **AI prepares. Rules calculate. Humans decide.**

FinSentinel is a financial-crime risk assessment workbench. It turns a change proposal and its supporting documents into a traceable, evidence-backed committee packet—without allowing AI to make the decision.

## The story in one view

```text
01 Understand       02 Design             03 Build
Requirements   →    Governed architecture → Working product
                                              │
                                              ▼
06 Operate      ←  05 Release          ←  04 Prove
Observe & improve   Stage, approve, recover  Test & evaluate

Inside the product:
Documents → Parse → Extract → Reconcile → Find policy → Draft → Verify → Calculate → Packet
                                                                     │
                           Analyst review & clearance ────────────────┤
                                                                     ▼
                                                         Committee decision
```

## The architecture, plainly

- **One deployable workbench:** a React interface backed by a Fastify API, one Node.js process, and SQLite. The Anthropic API is the only external runtime dependency; a fixture-backed mock gateway makes demos and automated checks repeatable.
- **A fixed, inspectable workflow:** parsing and rules prepare structured facts; focused AI tasks extract, scope, reconcile and draft; SQLite FTS5 retrieves relevant policy; deterministic grounding checks cited evidence; the risk engine calculates the score; the pipeline assembles the packet.
- **Three separate kinds of responsibility:** AI prepares recommendations; deterministic code enforces workflow, access, evidence checks and risk calculations; authorized people resolve blockers, challenge recommendations and decide.
- **A durable record:** every case keeps its supporting sources and applicable versions. Human changes require rationale; audit events are append-only and hash-chained.
- **A safe path to release:** automated checks lead to staging and smoke tests, then a human production approval. Deployment takes a backup and can roll back if the new release fails its checks.

## 2–2.5 minute speaker script

**[0:00–0:20 | The problem and promise]**

FinSentinel helps teams assess the financial-crime risk of a new product or change. The goal is not to let AI approve a launch. The goal is to turn scattered documents into a reviewable, evidence-backed assessment. Our design principle is simple: **AI prepares. Rules calculate. Humans decide.**

**[0:20–0:42 | Stages 01 and 02: define before building]**

We started by translating the brief into requirements, roles, safeguards and measurable acceptance criteria. Then we designed the system around those constraints: one Node process, a React workbench, a Fastify API and SQLite. We chose a fixed workflow—not an autonomous agent loop—so each step, boundary and failure is visible.

**[0:42–1:20 | Stage 03: follow the evidence]**

When a case arrives, documents are parsed into source-linked facts. The pipeline extracts information, flags contradictions and missing details, scopes the relevant risk dimensions, and searches the policy library. AI drafts an assessment, but a grounding check verifies its citations against the evidence. Unsupported claims remain visible and block finalization. Then deterministic rules calculate inherent and residual risk: controls can reduce risk, never erase it. The result is a committee-ready packet, not an AI decision.

**[1:20–1:48 | People stay in control]**

The analyst resolves contradictions, requests missing information and can override a recommendation—but must explain why. Only after blockers are cleared can the analyst send the case forward. The committee alone can approve, approve with conditions, defer or reject. Each material action is recorded in the case history.

**[1:48–2:12 | Stages 04 and 05: prove and release safely]**

We test deterministic behavior with automated unit, integration, security and browser tests, and evaluate AI quality with a golden set and adversarial checks. Releases run through CI, staging and smoke tests. A human approves production; the database is backed up first, and a failed smoke test triggers rollback.

**[2:12–2:25 | Stage 06: learn and improve]**

Operations completes the loop: monitor system health, model usage, cost, latency and case outcomes; use quality and adversarial results to guide controlled improvements. The result is a system that makes decisions easier to inspect—not easier to automate away.

## Stage-by-stage arc

| Stage | What we did | What it contributes to the demo |
|---|---|---|
| **01 — Requirements** | Turned the brief into traceable requirements, roles, risks and acceptance criteria. | A clear problem and explicit boundaries. |
| **02 — Design** | Defined the architecture, data model, workflow, risk calculation and human gates. | A reasoned design, not a collection of AI prompts. |
| **03 — Development** | Built the web workbench, API, SQLite-backed pipeline, policy retrieval, scoring and audit history. | A real, end-to-end case journey. |
| **04 — Testing** | Added automated test layers, AI evaluation, adversarial checks and a quality gate. | Evidence that the system is tested—not just plausible in a demo. |
| **05 — Deployment** | Created a versioned release path with CI, staging, human approval, backup, smoke checks and rollback. | A controlled route from code to a running release. |
| **06 — Operations** | Use health, quality, usage and business metrics to monitor the workbench and inform future improvement. | A feedback loop beyond launch. Stage 06 is the ongoing operating phase. |

## Architectural guardrails worth saying aloud

1. **No autonomous decisions:** the pipeline cannot write committee decisions.
2. **No unsupported certainty:** facts retain sources; claims need verifiable evidence; missing facts stay missing.
3. **No invisible overrides:** analyst changes require rationale and become part of the audit history.
4. **No risk-to-zero shortcut:** deterministic scoring enforces a non-zero floor and residual risk cannot exceed inherent risk.
5. **No silent release failure:** production promotion is human-gated, smoke-tested and recoverable.

*Traceability: PR-01…PR-08, AD-01…AD-15, FR-WF, FR-ASM, FR-RSK, FR-AUD, QG-01…QG-14 and DEP-01…DEP-14. Architecture and implementation details: `STAGE02_Design_Architecture.md`, `STAGE04_Testing_Report.md`, and `STAGE05_Deployment.md`.*
