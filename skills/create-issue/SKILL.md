---
name: create-issue
description: 仅在用户显式调用 /create-issue 或明确要求使用 create-issue 技能时使用；不要通过关键词自动触发。用于把已收敛的设计对照 / 缺陷调查 / 需求讨论落成开发者可快速定位、可客观验收的 GitHub issue。
---

# Create Issue

## Overview

Turn a converged discussion into issue(s) that read like **an architect handing a spec to a programmer**: the programmer can locate the work, understand the plan without asking back, and verify done objectively — without the user re-issuing instructions each time.

**Core principle — write it as a task dispatch, not a bug note.** Every issue must let a programmer execute end-to-end on first read. That means three things per finding:
1. **Stable location** — anchor to a durable identifier (`file` + function/class/symbol/section name, or a short quoted snippet). Line numbers are a *navigation hint only*, always approximate, never the anchor — code shifts and a hard line pin rots immediately and over-constrains the fix.
2. **An unambiguous plan** — what to change and why, with no decision left dangling that forces the programmer to come back and ask.
3. **An objective acceptance check** — verifiable by behavior/text/data-state plus a runnable command where applicable.

An issue that says "the button is wrong" forces the developer to re-investigate what you already know. An issue pinned to `Button.tsx:42` sends them to the wrong line after one edit. Anchor by symbol, plan the work, define done.

**Manual-only:** this skill NEVER auto-triggers on keywords (提issue / file an issue / etc.). Run it only when the user explicitly invokes `/create-issue` or names the skill.

## When to Use

Only on explicit invocation. Appropriate when a review/investigation has converged — you've already located code and compared against a source of truth, and actionable items emerged.

**Not for:** still-exploring discussions, trivial one-line fixes the user is about to do themselves, or vague ideas with no verifiable outcome.

## Workflow

1. **Probe the repo's issue conventions first.** Read `CONTRIBUTING`, issue templates (`.github/`), or any `git-workflow`/ruler docs; skim a recent `gh issue list`. Match their template, labels, title style. Never hardcode another repo's format.
2. **Group issues:**
   - **3+ issues → always auto-create one parent/umbrella tracking issue + child issues. Do NOT ask, do NOT discuss.** Children link back with `Refs: #<parent>`; the parent lists children as a checklist and holds the cross-issue map.
   - **Fewer than 3 → apply the Merge vs. Split table.** Confirm via AskUserQuestion only when genuinely ambiguous; otherwise state the default and proceed.
3. **Anchor every finding to a stable location.** Anchor by `file` + durable identifier (function/class/method/symbol name, or a short quoted snippet), NOT by a hard line number. A line number may ride along as an approximate hint (`Button.tsx · onSubmit() (~L42)`), but the symbol is the anchor — it survives edits, a line pin doesn't. Pair each with its source-of-truth location (design section, spec criterion). Present as a table: `维度 | 期望(真源) | 现状(代码) | 位置(符号/锚点)`.
4. **Plan the work like an architect.** State the intended approach so a programmer can execute without coming back to ask. Resolve the decisions you can already resolve; for genuinely open ones, say so explicitly and give the constraint/tradeoff rather than leaving a silent gap. Name the shared root cause once. Avoid ambiguity: if a phrasing could be read two ways, rewrite it.
5. **Draw the boundary.** Explicitly list what's OUT of scope, what stays unchanged, and any knock-on effects on other files/modules — so the developer doesn't "fix" intentional things or miss a ripple. Call out adjacent code the change must NOT break.
6. **Make acceptance criteria objective.** Each checkbox judges ONE thing, verifiable by behavior/text/data-state PLUS a runnable command (lint/build/test) where applicable. No "code is cleaner" subjective items.
7. **Create via heredoc**, not `-m`/`--body` single-line (literal `\n` won't become newlines). Title in Conventional Commits style. For plain ordinals use `A1`/`第1项`/`` `#1` `` — never bare `#1`/`#2` (GitHub resolves them to issue links).
8. **Review created issues — both plan AND code (MANDATORY).** After ALL issues are created, dispatch a subagent to audit them (see section below). The audit has TWO jobs: (a) verify claims match the codebase, and (b) read each issue as the programmer who'll execute it and flag any plan-level defect — ambiguity, missing decision, wrong/risky approach, undefined scope. Fix EVERY problem it reports via `gh issue edit` before reporting done.
9. **Report back** the created URL(s) + one-line grouping/boundary summary + what the review found and fixed.

## Post-Creation Review (mandatory)

After creating every issue, dispatch a subagent (Explore or general-purpose). Hand it the issue numbers/URLs and have it run BOTH passes below per issue. Reading code consistency alone is not enough — a factually-correct issue can still be unexecutable.

**Pass A — Code consistency (does it match reality?):**
- Every location anchor (file + symbol) actually exists and points at the claimed code. (Don't fail an issue over a stale line-number hint — anchors are symbols; line numbers are approximate by design.)
- Each acceptance criterion is objectively verifiable (a real command / path / behavior), not aspirational.
- Claims about current state (bugs, missing permissions/config, signatures) are true in the code TODAY.
- No finding contradicts the codebase or describes work already done.

**Pass B — Plan soundness (read it as the assigned programmer):** Ask "could I execute this start-to-finish without coming back to ask a question?"
- **Ambiguity:** any sentence open to two readings; vague pronouns; "fix the handling" with no defined target behavior.
- **Missing decision:** the issue defers a choice it should have made (which API, which file, which pattern) and leaves the programmer guessing.
- **Wrong/risky approach:** the proposed plan would break adjacent code, fight an existing convention (check ruler/CLAUDE.md), or pick a clearly worse path.
- **Undefined scope/boundary:** no out-of-scope statement, or knock-on effects on other modules not called out.
- **Acceptance ≠ goal:** the checkboxes, even if objective, don't actually prove the stated goal is met.
- **Structural:** `Refs:`/parent links correct; no bare `#n` ordinal mis-links; 3+ issues have an umbrella.

The subagent returns a per-issue defect list spanning both passes. **You MUST fix ALL reported problems** via `gh issue edit` (heredoc), then re-verify. Do not report the task complete while any reported problem stands unfixed.

## Merge vs. Split (only when <3 issues)

| Signal | Action |
|--------|--------|
| Same component / source-of-truth target / change cycle, mutually non-blocking | One issue, internal groups (A/B/C) |
| Different host (e.g. web vs. mobile/Flutter), independent tracking/rollback, one item far heavier | Split, link with `Refs:` |
| User explicitly asks to split/merge | Follow user, link related ones |

## Common Mistakes

- **Pinning to a hard line number** → after one edit the anchor points at the wrong code and over-constrains the fix. Anchor by file + symbol; line numbers are an approximate hint only.
- **Filename with no symbol anchor at all** → developer re-hunts. Always name the function/class/section.
- **Writing a bug note, not a task spec** → "X is wrong" with no plan leaves the programmer to redesign. State the intended approach.
- **Leaving a decision dangling** → "handle this better" forces a round-trip question. Resolve it, or state the constraint explicitly if genuinely open.
- **Acceptance criteria all subjective/visual** → not verifiable. Attach a command or observable behavior.
- **Acceptance that doesn't prove the goal** → objective but checks the wrong thing. Tie each checkbox to the stated goal.
- **Asking about grouping for 3+ issues** → don't. Auto-create umbrella + children.
- **Post-creation review only checks code, not the plan** → ships factually-correct but unexecutable/ambiguous issues. Run BOTH passes (code consistency + plan soundness).
- **No out-of-scope section** → developer changes intentional things or misses a ripple. Always state the boundary and knock-on effects.
- **`-m "...\n..."`** → literal `\n` in the issue body. Use heredoc `--body-file -`.
- **Bare `#1`/`#2` for ordinals** → GitHub mis-links them. Use `A1` / backticks.

## Red Flags — stop and fix before reporting done

- About to anchor a finding to a bare line number, or with no symbol/source-of-truth reference at all.
- The issue describes what's wrong but not what to do about it — a programmer would have to design the fix from scratch.
- A sentence in the issue could be read two ways, or defers a decision the issue should have made.
- An acceptance checkbox you can't verify by running something or observing a concrete state — or that doesn't actually prove the goal.
- 3+ issues created without an umbrella, or related issues without `Refs:`.
- Reported done without running BOTH review passes (code + plan) and fixing every finding.
