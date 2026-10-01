# Criteria log

One JSON file per delivery stage (`STAGE01.json` … `STAGE06.json`), recording for each judging criterion in `documents/criteria.txt` what was done, the evidence, the decisions and their reasons, gaps, and a self-score (0–5).

Append a file at the end of every stage. Then run:

```powershell
npm run criteria:report      # renders documents/FINAL_REPORT.md from logs/criteria/*.json + logs/token_log.md
```

Schema (`scripts/criteria-report.ts` validates it):

```json
{
  "stage": "03",
  "name": "Development",
  "date": "2026-09-28",
  "ai_usage": "How AI was applied in this stage (one paragraph).",
  "criteria": {
    "<key>": {
      "done": ["..."],
      "evidence": ["path or test name"],
      "decisions": [{ "decision": "...", "reason": "..." }],
      "gaps": ["..."],
      "self_score": 0
    }
  },
  "tokens": { "task_ids": [12], "output": 0, "cache_read": 0, "cache_write": 0, "subagents": 0 }
}
```

Keys and weights: `ai_harness` 30, `sdlc_automation` 20, `human_in_loop` 15, `evaluation` 10, `context_engineering` 10, `production_readiness` 5, `token_efficiency` 5, `engineering_judgement` 5.
