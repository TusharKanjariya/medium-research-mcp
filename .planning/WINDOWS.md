---
schema_version: 1
open_count: 1
waived_count: 0
fixed_count: 0
total_count: 1
last_updated: 2026-07-24T07:13:49.989Z
---

# Broken Windows Ledger

> Cross-phase defect register. `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 10 | unmet-truth | .planning/HANDOFF.json |  | Real Product Hunt token in git history (commits b2071b9/de63eb6/9613e25) — secret scan FAIL, blocks 10-02 public flip until rotated+scrubbed | open |  | 2026-07-24T07:13:49.989Z |  |

````json
[
  {
    "id": 1,
    "kind": "unmet-truth",
    "phase": "10",
    "file": ".planning/HANDOFF.json",
    "line": null,
    "description": "Real Product Hunt token in git history (commits b2071b9/de63eb6/9613e25) — secret scan FAIL, blocks 10-02 public flip until rotated+scrubbed",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-07-24T07:13:49.989Z",
    "resolved_at": null
  }
]
````
