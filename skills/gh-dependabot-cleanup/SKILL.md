---
name: gh-dependabot-cleanup
description: Use when a user asks to check or remediate GitHub Dependabot alerts and deliver one closed-loop PR, including alert triage, dependency updates, verification, and PR creation with unresolved items clearly documented.
---

# GH Dependabot Cleanup

## Overview
Use this skill to complete a Dependabot remediation loop with minimal manual input. Rely on `gh` directly, fix all patchable alerts in scope, and document unpatched alerts without auto-dismiss.

## Closed Loop Workflow
1. Confirm target and scope in one sentence.
2. Fetch open alerts with `gh api`.
3. Classify alerts into:
   - patchable: has `first_patched_version`
   - unpatched: no `first_patched_version`
   - direct vs transitive
4. Announce remediation plan before edits.
5. Apply dependency changes (prefer overrides/resolutions for transitive alerts).
6. Refresh lockfile.
7. Run required project verification commands.
8. Commit, push, and open exactly one PR.
9. Report residual risk (unpatched alerts) in PR and final reply.

## Default Commands
```bash
# 1) Fetch open alerts JSON
gh api -H 'Accept: application/vnd.github+json' \
  '/repos/OWNER/REPO/dependabot/alerts?state=open&per_page=100'

# 2) Tabular triage view
gh api -H 'Accept: application/vnd.github+json' \
  '/repos/OWNER/REPO/dependabot/alerts?state=open&per_page=100' \
  | jq -r '.[] | [.number, .security_vulnerability.package.name, .dependency.relationship, .security_advisory.severity, (.security_vulnerability.first_patched_version.identifier // "none"), .security_vulnerability.vulnerable_version_range, .html_url] | @tsv'

# 3) Typical lock refresh (adapt to repo)
pnpm install --lockfile-only
```

## Decision Rules
- Keep unpatched alerts open by default; do not dismiss unless explicitly requested.
- If one package maps to multiple alerts, upgrade once to the highest required safe version.
- Keep the PR focused on security dependency remediation only.
- If repo has branch/issue conventions, follow them strictly.

## PR Requirements
Include these sections:
1. Fixed alerts: alert id, package, target version
2. Remaining alerts: alert id, reason (for example, no upstream patch)
3. Verification: exact commands run and outcomes
4. Risk note: what is deferred and why

## Fast Trigger
修复安全警告
