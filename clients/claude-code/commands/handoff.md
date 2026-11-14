---

description: Hand the current task to another engineer with Strata Relay (drafts a checkpoint for you to review and approve)
argument-hint: "[who it's for, or anything to stress]"
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(git rev-parse:*), mcp__plugin_strata_strata__strata_handoff_create
---

Draft a Strata Relay handoff of the task we've been working on, so another engineer's fresh Claude Code session can
pick it up. The user said: $ARGUMENTS

1. Look at where the work stands: `git status`, `git log --oneline -10`, and `git diff` against the branch's base.
2. If there are uncommitted changes, tell the user plainly that **uncommitted changes don't travel with a handoff**, and
   ask whether to commit and push them first. Don't commit or push without their go-ahead. If the branch isn't pushed,
   say so too: the recipient can only check out what's on the remote.
3. Work out the test commands that prove the task is done (a currently failing test is the best evidence of what's
   left). Prefer narrow commands that run in under a minute.
4. Call `strata_handoff_create` with what is true and checkable from this session:
   - `title`, `summary`: the task and where it stands.
   - `completed`, `remaining` (in order), `blockers`.
   - `failedApproaches`: what was tried and didn't work, and why.
   - `decisions`: technical decisions and their reasons.
   - `nextAction`: the single next step, concrete enough to act on.
   - `testCommands`: the commands from step 3. They're run now and recorded as verified evidence.
     No secrets, no credentials, nothing personal, and no raw transcript. The repository URL, branch, commit and pushed
     state are read from git by the tool, so don't type them.
5. Show the user the tool's result: the test evidence, any warnings, and the review link. Tell them the draft is
   theirs alone until they open the link, check it, choose the recipient and any memories to share, and approve it.
