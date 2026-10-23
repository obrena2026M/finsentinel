# FinSentinel — Building the Workbench with AI

*Version 2 · Stage 03: Development · 3–3.5 minute presentation*

> **AI accelerated implementation. Engineering decisions stayed human-owned.**

This version focuses on how FinSentinel was built: how requirements and architecture constrained AI-assisted development, how teams could work in parallel against contracts, and how tests and evaluation turned generated code into a system we could inspect.

## The key distinction

FinSentinel uses AI in **two different ways**:

1. **AI-assisted engineering:** Claude Code helped produce the application from the requirements and design, including code, tests, evaluation tooling and documentation. A separate agent built the React web app against the API contract.
2. **AI inside the application:** narrowly scoped model calls extract and reconcile facts, scope risks and draft assessments. These are runtime capabilities—not the application’s workflow engine, risk calculator or decision-maker.

In both cases, the human role is to set constraints, inspect the work and verify the result.

## Development story

```text
Requirements + design
        │  Traceable PR / FR / AD decisions
        ▼
Architecture contracts ───────────────► API contract
        │                                  │
        ▼                                  ▼
AI-assisted implementation          Parallel web app work
        │                                  │
        └────────────── integrate ─────────┘
                           │
                           ▼
         Tests + evaluation + quality gate
                           │
               defect / metric feedback
                           └──────────► refine
```

## 3–3.5 minute speaker script

**[0:00–0:25 | Set the frame]**

This is version two of our architecture story, focused on development. We used AI to help build FinSentinel, and the product itself also uses AI—but those are not the same thing. During development, AI helped us implement and iterate. At runtime, AI performs bounded assessment tasks. In neither case did we hand over engineering accountability or financial-crime decisions.

**[0:25–1:00 | Start with constraints, not a blank prompt]**

We began with a requirements document and architecture decisions, not an open-ended instruction to “build an AI risk tool.” Requirements carried traceable IDs into design, code and tests. The architecture established the contracts: a React interface, Fastify API, Node process and SQLite; a fixed ten-step workflow; validated structured outputs; deterministic scoring; and human-only decision rights. Those choices made the work easier to divide—and made incorrect shortcuts easier to spot.

**[1:00–1:40 | AI-assisted implementation, with boundaries]**

AI coding assistance helped implement the scaffold and major layers: domain rules, persistence and audit, API services, the LLM gateway, pipeline, test harness and evaluation tooling. The web app could be developed separately because the API was its contract. That parallel handoff reduced coupling: the UI did not need to guess the backend shape, and the backend did not need to depend on UI internals. People still chose the architecture, defined interfaces, reviewed the trade-offs and integrated the result.

**[1:40–2:25 | Separate product AI from deterministic code]**

Inside the application, the same discipline continues. The pipeline is code-orchestrated in a fixed order—not an autonomous agent loop. AI handles bounded tasks such as extraction, risk scoping, semantic contradiction analysis and assessment drafting. Zod schemas constrain outputs. Source links come from application context, and grounding checks verify citations. Workflow transitions, access control, audit behavior and risk math stay in ordinary code and database constraints. Only the committee role can write a decision.

**[2:25–3:00 | Use evidence to improve the implementation]**

We did not treat generated code—or plausible demo output—as proof. Playwright tests exercise domain logic, HTTP journeys, role boundaries, failure paths and browser workflows. A golden-set evaluation measures extraction, retrieval, grounding, risk-band agreement and adversarial behavior. One evaluation exposed a fixture-keying defect: a case could receive the wrong mock response. We changed fixture selection to use document content and headings, then reran the evaluation. That is the loop: observe, diagnose, fix, verify.

**[3:00–3:25 | The engineering lesson]**

The result is a working, testable workbench built under real environment constraints, with decisions and limitations made visible. The lesson for us is not “let AI write more code.” It is: give AI bounded tasks, provide stable contracts, preserve deterministic controls, and make tests and evaluation the acceptance criteria. Mock fixtures prove the harness is repeatable; they do not by themselves prove real-model quality. Human review remains essential.

## What each audience should notice

| Audience | Development signal |
|---|---|
| **Project managers** | Traceable requirements, staged scope, parallel work with an explicit handoff, and visible acceptance evidence. |
| **Architects** | Clear boundaries between UI, API, orchestration, domain rules and persistence; fixed workflows; explicit failure paths. |
| **Senior developers** | Schemas at boundaries, source provenance, deterministic domain logic, injected/mock gateways, automated tests and regression evaluation. |

## Decisions that made AI-assisted development safer

- **Requirements before generation:** AI work is directed by named outcomes and constraints, not vague feature prompts.
- **Contracts before parallelism:** the React app was delegated against the API as its interface.
- **Deterministic core:** workflow, RBAC, grounding checks, audit integrity and scoring stay in testable code and database controls.
- **Repeatable AI boundary:** a shared gateway supports real calls and fixture-backed tests, including deliberate failure injection.
- **Evidence-based iteration:** tests and evaluation expose defects; fixes are followed by reruns.
- **Honest scope:** three golden cases and fixture-backed evaluation are useful regression evidence, not a substitute for broader expert review and real-model validation.

## Architecture in one sentence

**AI-assisted engineering built a contract-driven workbench; inside it, a fixed pipeline uses AI for bounded analysis, deterministic code for controls and calculations, and authorized people for decisions.**

*Traceability: PR-01…PR-08, AD-01…AD-15, FR-ARC, FR-FAIL, FR-RSK, FR-WF, EV-01…EV-10 and QG-01…QG-14. Sources: `STAGE02_Design_Architecture.md`, `CRITERIA_ALIGNMENT.md`, `logs/criteria/STAGE03.json`, `STAGE04_Testing_Report.md`, `README.md`, and `logs/token_log.md`.*
