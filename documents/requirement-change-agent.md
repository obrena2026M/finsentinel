# Requirement Change Agent for AI-Assisted Development

## Purpose

In AI-assisted or vibe-coded development, requirements will continue to change after implementation. For example, a project may have ten completed requirements, but new changes may later be introduced for `REQ-004` and `REQ-008`.

The AI should not reread the entire project, regenerate all ten features, or depend on a long conversation history. Instead, the project should use a **Requirement Change Agent** that maintains traceability, retrieves only relevant context, controls development scope, and records the result of every change.

The core principle is:

> A deterministic workflow controls the development process, while AI performs reasoning within each controlled step.

---

## Recommended Solution

Create a **Requirement Change Orchestrator** rather than starting with a fully autonomous coding agent.

Its primary responsibilities are to:

1. Understand a new requirement or change request.
2. Locate the affected requirement records.
3. Identify dependencies and possible regression areas.
4. Assemble the minimum context needed by the AI.
5. Control the coding agent's scope.
6. Trigger testing and validation.
7. Update requirement versions and implementation records.
8. Preserve traceability for future development sessions.

The orchestrator should not immediately modify code when it receives a change. It should first analyze the change, identify its impact, and prepare a bounded implementation package.

---

## High-Level Architecture

```text
New requirement or change request
              |
              v
     Requirement Tracker Agent
              |
              v
        Impact Analyzer
              |
              v
     Context Builder / Retriever
              |
              v
         Coding Agent
              |
              v
        Test / Review Agent
              |
              v
   Update requirement tracking
```

For the first implementation, these do not need to be separate autonomous agents. They can be capabilities or tools controlled by one orchestrator.

---

## Requirement Identification

Every requirement must have a permanent identifier that does not change when its description or priority changes.

```text
REQ-001
REQ-002
REQ-003
...
REQ-010
```

Do not rely only on positions such as "Requirement 4." Positions may change when requirements are inserted, reordered, or removed.

A requirement record should include:

```yaml
id: REQ-004
title: User session timeout
version: 1.0
status: completed
priority: high

description: >
  Automatically sign out an inactive user after 30 minutes.

acceptance_criteria:
  - Inactive users are signed out after 30 minutes
  - A warning appears 5 minutes before sign-out
  - Active users are not interrupted

dependencies:
  - REQ-002

implementation:
  files:
    - src/auth/session-manager.ts
    - src/components/SessionWarning.tsx

tests:
  - tests/auth/session-timeout.spec.ts

last_validated: 2026-10-13
```

---

## Suggested Project Structure

```text
project/
├── README.md
├── AI-INSTRUCTIONS.md
│
├── requirements/
│   ├── index.yaml
│   ├── REQ-001.md
│   ├── REQ-002.md
│   ├── REQ-003.md
│   ├── REQ-004.md
│   ├── REQ-005.md
│   ├── REQ-006.md
│   ├── REQ-007.md
│   ├── REQ-008.md
│   ├── REQ-009.md
│   └── REQ-010.md
│
├── changes/
│   ├── CR-001-REQ-004.md
│   └── CR-002-REQ-008.md
│
├── decisions/
│   └── ADR-001-session-storage.md
│
├── tracking/
│   ├── implementation-map.yaml
│   ├── dependency-map.yaml
│   ├── current-sprint.md
│   └── agent-runs/
│
├── src/
└── tests/
```

The files in this structure serve as persistent project memory. Chat history may provide temporary context, but it should not be the authoritative project record.

---

## Component Responsibilities

### 1. Requirement Tracker

The Requirement Tracker receives a natural-language request such as:

```text
Change Requirement 4 so that the session timeout is configurable.
Extend Requirement 8 to support PDF export.
```

It converts the request into a structured change record:

```yaml
change_id: CR-003
affected_requirements:
  - REQ-004
  - REQ-008
change_type: modification
status: impact-analysis
submitted_at: 2026-10-13
```

Its responsibilities are to:

- Identify affected requirement IDs.
- Compare existing and requested behavior.
- Record the requested change.
- Set the change status.
- Propose the appropriate requirement version increment.
- Trigger impact analysis.

It should not change application code at this stage.

---

### 2. Impact Analyzer

The Impact Analyzer determines the likely effect of the requested change.

```yaml
change_request: CR-003

primary_requirements:
  - REQ-004
  - REQ-008

dependent_requirements:
  - REQ-002
  - REQ-009

affected_files:
  - src/auth/session-manager.ts
  - src/reports/export-service.ts

affected_tests:
  - tests/auth/session-timeout.spec.ts
  - tests/reports/export.spec.ts

risk: medium
recommended_action: targeted-modification
```

Its responsibilities are to:

- Identify directly affected requirements.
- Identify dependent requirements.
- Find mapped source files and tests.
- Detect possible architectural effects.
- Estimate implementation and regression risk.
- Recommend a targeted implementation scope.

The Impact Analyzer should use both the dependency map and the actual code structure. A mapping file may be outdated, so detected inconsistencies must be reported.

---

### 3. Context Builder

The Context Builder is the main token-saving capability.

For a change involving `REQ-004` and `REQ-008`, it should retrieve only the relevant information:

```text
AI-INSTRUCTIONS.md
requirements/index.yaml
requirements/REQ-004.md
requirements/REQ-008.md
changes/CR-003.md
tracking/dependency-map.yaml
tracking/implementation-map.yaml
relevant architecture decisions
affected source files
affected test files
```

It should not automatically load:

- All completed requirements
- The complete conversation history
- The entire repository
- Unrelated architecture decisions
- Unrelated test suites
- Old agent outputs with no connection to the current change

The full repository should only be loaded when:

- Dependency records are missing or unreliable.
- A cross-cutting architectural change is requested.
- The application structure has changed significantly.
- Targeted tests expose unexpected regression.
- The affected implementation cannot be located reliably.

---

### 4. Coding Agent

The Coding Agent receives a restricted work package from the orchestrator.

```yaml
task: Implement CR-003

allowed_requirements:
  - REQ-004
  - REQ-008

allowed_files:
  - src/auth/session-manager.ts
  - src/reports/export-service.ts
  - tests/auth/session-timeout.spec.ts
  - tests/reports/export.spec.ts

protected_requirements:
  - REQ-001
  - REQ-003
  - REQ-005
  - REQ-006
  - REQ-007
  - REQ-010

instructions:
  - Do not refactor unrelated modules
  - Preserve existing CSV behavior
  - Add or update tests
  - Report additional impact before changing files outside the approved scope
```

If the Coding Agent discovers that another file must be changed, it should stop expanding its scope automatically and return a structured request:

```yaml
status: scope-expansion-required
additional_files:
  - src/config/security-settings.ts
reason: >
  The configurable session timeout is stored in the shared security settings.
related_requirement:
  - REQ-002
```

The orchestrator can then update the impact analysis and request human approval if needed.

---

### 5. Test and Review Agent

The Test and Review Agent verifies that the implementation satisfies the updated requirements without damaging existing behavior.

It should validate:

- Updated acceptance criteria
- Targeted unit tests
- Relevant integration tests
- Regression tests for dependent requirements
- Unexpected file modifications
- Security and configuration effects
- Requirement-to-code traceability
- Documentation and tracking updates

Example result:

```yaml
change_id: CR-003
validation_status: passed

requirements_validated:
  - REQ-004
  - REQ-008

dependent_requirements_validated:
  - REQ-002
  - REQ-009

tests:
  passed: 34
  failed: 0

unexpected_files_modified: []
known_issues: []
recommendation: ready-for-human-review
```

The agent should not mark a requirement completed unless validation evidence exists.

---

## One Agent or Multiple Agents?

For the first production version, use **one orchestrator with several controlled tools or workflow steps**.

```text
Requirement Change Orchestrator
├── parse_change()
├── retrieve_requirement()
├── analyze_dependencies()
├── build_context()
├── prepare_work_package()
├── invoke_coding_agent()
├── run_tests()
├── review_changes()
└── update_tracking()
```

This design is preferable initially because it is:

- Easier to debug
- Less expensive to run
- Easier to secure
- Easier to observe
- Less likely to create conflicting decisions
- Easier to stop when scope changes

As the workflow matures, responsibilities can be separated:

```text
Requirement Agent
Impact Analysis Agent
Developer Agent
QA Agent
Documentation Agent
```

Even in the multi-agent version, communication should follow an explicit workflow rather than allowing agents to make unrestricted decisions or modify the project independently.

---

## Change Request Example

Assume all ten requirements are complete:

```text
REQ-001 to REQ-010 = completed
```

New changes arrive for Requirements 4 and 8:

```text
REQ-004 v1.0 -> CR-001 -> REQ-004 v1.1
REQ-008 v1.0 -> CR-002 -> REQ-008 v2.0
```

A change record for `REQ-004` could be:

```markdown
# CR-001: Configurable Session Timeout

## Current behavior

Inactive users are signed out after 30 minutes.

## Requested behavior

Allow administrators to configure the timeout between 15 and 60 minutes.

## Reason

Different departments have different security policies.

## Affected requirement

- REQ-004, version 1.0

## Expected new version

- REQ-004, version 1.1

## Constraints

- The default remains 30 minutes.
- Existing users must not require data migration.
- Values below 15 or above 60 must be rejected.
```

A change record for `REQ-008` could be:

```markdown
# CR-002: Add PDF Report Export

## Current behavior

Reports can be exported as CSV.

## Requested behavior

Add PDF export while retaining CSV export.

## Affected requirement

- REQ-008, version 1.0

## Expected new version

- REQ-008, version 2.0

## Constraints

- Existing CSV behavior must remain unchanged.
- PDF output must use the active report filters.
- Export actions must be recorded in the audit log.
```

---

## Requirement Index

The requirement index gives the agent a small entry point into the project.

```yaml
project: Sentinel
updated: 2026-10-13

requirements:
  - id: REQ-001
    version: 1.0
    status: completed
    impact: none

  - id: REQ-002
    version: 1.0
    status: completed
    impact: regression-check

  - id: REQ-003
    version: 1.0
    status: completed
    impact: none

  - id: REQ-004
    version: 1.1
    status: change-requested
    impact: analysis-required

  - id: REQ-005
    version: 1.0
    status: completed
    impact: none

  - id: REQ-006
    version: 1.0
    status: completed
    impact: none

  - id: REQ-007
    version: 1.0
    status: completed
    impact: none

  - id: REQ-008
    version: 2.0
    status: change-requested
    impact: analysis-required

  - id: REQ-009
    version: 1.0
    status: regression-check
    impact: possible

  - id: REQ-010
    version: 1.0
    status: completed
    impact: none
```

---

## Requirement-to-Code Mapping

Maintain an implementation map so the agent does not have to search the full repository on every request.

```yaml
REQ-004:
  source:
    - src/auth/session-manager.ts
    - src/components/SessionWarning.tsx
  tests:
    - tests/auth/session-timeout.spec.ts
  configuration:
    - config/security.json
  dependencies:
    - REQ-002

REQ-008:
  source:
    - src/reports/export-service.ts
    - src/components/ExportButton.tsx
  tests:
    - tests/reports/export.spec.ts
  dependencies:
    - REQ-009
```

This map should be verified and updated after implementation. It is an optimization and traceability mechanism, not an unquestionable source of truth.

---

## Controlled Workflow

### Phase 1: Intake

- Receive the new change request.
- Assign a change ID.
- Identify likely affected requirements.
- Store the original request without rewriting its intent.

### Phase 2: Analysis

- Compare current and requested behavior.
- Load requirement dependencies.
- Locate mapped code and tests.
- Produce an impact analysis.
- Identify risks and possible scope expansion.

### Phase 3: Human Scope Approval

A developer, analyst, or product owner reviews:

- Requirement interpretation
- Proposed acceptance criteria
- Affected modules
- Dependencies
- Risk level
- Implementation approach

### Phase 4: Context Assembly

- Retrieve only relevant requirement records.
- Retrieve related change requests and decisions.
- Retrieve affected code and tests.
- Produce a bounded work package.

### Phase 5: Implementation

- Modify only the approved scope.
- Add or update tests.
- Preserve behavior not explicitly changed.
- Stop and report if additional scope is discovered.

### Phase 6: Validation

- Run targeted tests.
- Run regression tests for dependent requirements.
- Compare implementation against acceptance criteria.
- Detect unexpected file modifications.

### Phase 7: Completion

- Update the requirement version and status.
- Update the implementation and dependency maps.
- Update the change-request status.
- Save test evidence.
- Generate a concise completion record.
- Submit the change for human code review.

---

## Completion Contract

Every completed agent run should return a structured result that can be used by the next session.

```yaml
change_request: CR-003
status: completed

requirement_updates:
  - id: REQ-004
    previous_version: 1.0
    new_version: 1.1
    status: completed

  - id: REQ-008
    previous_version: 1.0
    new_version: 2.0
    status: completed

files_modified:
  - src/auth/session-manager.ts
  - src/reports/export-service.ts

files_created:
  - src/config/session-timeout.ts

tests:
  added:
    - rejects timeout below 15 minutes
    - rejects timeout above 60 minutes
    - uses configured timeout
    - exports filtered report as PDF
  passed: 34
  failed: 0

regression_scope:
  validated:
    - REQ-002
    - REQ-004
    - REQ-008
    - REQ-009

known_issues: []

documentation_updated:
  - requirements/REQ-004.md
  - requirements/REQ-008.md
  - requirements/index.yaml
  - tracking/implementation-map.yaml
```

---

## AI Operating Instructions

The project should include an `AI-INSTRUCTIONS.md` file containing rules such as:

```markdown
# AI Development Protocol

## Context loading

1. Read `requirements/index.yaml`.
2. Identify requirements marked as:
   - `change-requested`
   - `in-progress`
   - `failed-validation`
   - `regression-check`
3. Load only those requirement files.
4. Load their related change requests.
5. Use `tracking/implementation-map.yaml` to identify relevant code.
6. Load dependencies only when the dependency map or code analysis indicates possible impact.

## Scope control

- Do not refactor unrelated files.
- Do not rewrite completed requirements.
- Requirement IDs never change.
- Requirement versions must change when behavior changes.
- Preserve backward compatibility unless explicitly changed.
- Request scope expansion before modifying files outside the approved work package.

## Before implementation

Produce:

- Difference analysis
- Impact analysis
- Affected-file plan
- Test plan
- Risk assessment

## After implementation

Update:

- Requirement version and status
- Implementation map
- Dependency map when needed
- Tests and validation evidence
- Change-request status
- Completion summary

## Context budget

Do not request the entire repository unless:

- The dependency map is missing or unreliable
- The application structure has substantially changed
- A cross-cutting architectural change is requested
- Targeted tests reveal unexpected regression
- The implementation cannot be located through targeted retrieval
```

---

## Human Approval and Safety Controls

The recommended approval flow is:

```text
Change request submitted
        |
        v
AI produces impact analysis
        |
        v
Human approves scope
        |
        v
AI implements changes
        |
        v
AI runs validation
        |
        v
Human reviews pull request
        |
        v
Merge and update requirement status
```

The agent should not initially be permitted to:

- Merge directly into the main branch.
- Modify unrelated files without approval.
- Mark requirements completed without test evidence.
- Replace acceptance criteria silently.
- Delete requirements or change IDs automatically.
- Decide that dependencies are unaffected without recording its reasoning.
- Rely only on conversation history for project state.
- Conceal failed tests or incomplete validation.

---

## Persistent Storage

### Minimum File-Based Implementation

```text
Requirement records     -> Markdown or YAML
Change requests         -> Markdown or YAML
Source and tests        -> Git repository
Decisions               -> Architecture decision records
Execution history       -> Agent-run Markdown or JSON files
Approval                -> Pull request review
```

### Advanced Implementation

```text
Requirement records     -> SQL database or work management platform
Source and tests        -> Git repository
Semantic retrieval      -> Vector index
Execution history       -> Agent-run database
Observability           -> Logs, traces, token usage, cost and duration
Approval                -> Pull request and workflow approval
```

A vector index should help retrieve relevant context, but it should not become the authoritative record. Requirements, decisions, code, tests, and approved change records should remain the sources of truth.

---

## Observability Metrics

To confirm that the agent is reducing cost and development time, track:

- Input and output tokens per change request
- Number of files loaded into context
- Number of files modified
- Number of unexpected files modified
- Impact-analysis duration
- Implementation duration
- Test duration
- Failed-agent-run count
- Scope-expansion count
- Human rework count
- Defects linked to missed dependencies
- Requirement-to-test coverage
- Cost per completed change request

Recommended run log:

```yaml
run_id: RUN-2026-10-13-001
change_id: CR-003
requirements_loaded: 4
source_files_loaded: 6
test_files_loaded: 3
input_tokens: 18420
output_tokens: 5260
duration_seconds: 412
scope_expansions: 1
tests_passed: 34
tests_failed: 0
human_rework_required: false
```

---

## Implementation Roadmap

### Version 1: File-Based Tracker

Build the minimum process first:

- Requirements stored in Markdown or YAML
- Change requests stored in Markdown
- Requirement index in YAML
- Implementation and dependency maps in YAML
- One AI coding agent
- PowerShell or Python orchestration script
- Test execution through the terminal
- Git branch, commit, or patch for every change
- Human review before merge

### Version 2: Requirement Dashboard

Add a dashboard showing status and traceability:

```text
REQ-001  Completed         v1.0
REQ-002  Regression check  v1.0
REQ-003  Completed         v1.0
REQ-004  Change requested  v1.1
REQ-005  Completed         v1.0
REQ-006  Completed         v1.0
REQ-007  Completed         v1.0
REQ-008  In development    v2.0
REQ-009  Regression check  v1.0
REQ-010  Completed         v1.0
```

The dashboard can also display:

- Requirement owner
- Current version
- Active change request
- Affected files
- Test status
- Approval status
- Last agent run
- Tokens used
- Development duration

### Version 3: Agent Orchestration

Add controlled automation for:

- Requirement parsing
- Dependency analysis
- Context retrieval
- Coding-agent invocation
- Automated validation
- Human approval gates
- Pull-request creation
- Token, cost, and duration monitoring
- Run resumption after interruption

### Version 4: Continuous Improvement

Use historical agent-run information to improve:

- Context selection
- Dependency mappings
- Risk scoring
- Test selection
- Prompt templates
- Agent model selection
- Token budgets
- Detection of recurring change patterns

---

## Recommended First Implementation

Start with one **Requirement Change Orchestrator** that manages a file-based source of truth.

The initial workflow should be:

```text
1. Read the requirement index.
2. Record the new change request.
3. Identify affected requirement IDs.
4. Retrieve mapped source files and tests.
5. Produce an impact-analysis report.
6. Wait for human scope approval.
7. Build a restricted coding work package.
8. Invoke the coding agent.
9. Run targeted and dependency-based regression tests.
10. Review modified files against the approved scope.
11. Update requirement and tracking records.
12. Create a completion report and pull request.
```

This implementation provides useful control and token reduction without introducing the operational complexity of a large multi-agent system.

---

## Expected Benefits

This approach reduces:

- Repeated reading of completed requirements
- Re-explanation of project history
- Full-repository context loading
- Unnecessary code inspection
- Accidental modification of unrelated features
- Duplicate implementation work
- Missed requirement dependencies
- Long prompts carrying obsolete context
- Development time spent reconstructing previous decisions

It improves:

- Requirement traceability
- Change impact visibility
- Context efficiency
- Test targeting
- Regression awareness
- Human review quality
- Agent run resumability
- Development auditability

---

## Final Recommendation

Create the agent, but define it as a **Requirement Change Orchestrator**, not merely as an autonomous developer.

Its most important function is not generating code. Its most important function is controlling context and scope:

```text
Understand the change
        |
        v
Find affected requirements
        |
        v
Analyze dependencies
        |
        v
Build minimal context
        |
        v
Constrain implementation
        |
        v
Validate the result
        |
        v
Save traceability records
```

The project should give the AI a reliable map of the application rather than sending the entire application for every change. That provides the speed of vibe coding while retaining disciplined requirements management, test evidence, auditability, and token efficiency.
