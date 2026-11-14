# Strata

A platform that gives everyone in a software organization shared, sourced context about what is being built, by whom, and why, so people stop chasing each other for updates.

This document collects the ideas, design decisions, and open questions so far. Items marked **(suggestion)** are options to evaluate, not decisions.

---

## 1. The problem

Context about software work lives in people's heads and scattered tools.

- **Vertical gap (leaders and teams).** Managers and product managers can't see status, ownership, or progress without asking. Quiet or less communicative people get less visibility than loud ones, even when they ship good work.
- **Horizontal gap (peer to peer).** Engineers don't know what teammates are working on, who is blocked, or who has capacity. Busy and idle look the same from outside.
- **Knowledge reuse.** Teams solve the same problem twice (for example document processing) because nobody knows someone already did it, or who to ask.
- **Problem discovery.** When a team builds software for a group in a domain it doesn't know (for example an operations team in biotech or supply chain), weeks go into meetings learning their workflow, terminology, and use case before design can start.
- **Lost context.** When people rotate or leave, the reasoning behind decisions leaves with them.

Origin: these gaps were experienced first-hand at a previous company, including a project to automate an operations team's workflow.

---

## 2. The idea in one paragraph

A platform (not just a plugin) that captures short, engineer-reviewed summaries of what was built during AI-assisted coding sessions, links them to the Jira tickets and GitHub pull requests behind them, adds opt-in meeting context, and organizes everything in a knowledge graph. Managers, PMs, and engineers ask questions in plain language and get answers that cite their sources. The same layer helps analysts learn a new team's workflow and domain.

Guiding line: **visibility into the work, not the worker.**

---

## 3. Who uses it and what they get

| User            | What they get                                                                                                                      |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Engineer        | Notes on their own work, a way to find who already solved a problem, awareness of teammates' work and capacity, onboarding context |
| Manager         | Status, ownership, and overview without chasing people or waiting for weekly calls; pre-meeting context                            |
| Product manager | Progress by feature or project, who owns what, what is blocked                                                                     |
| Analyst / BA    | Help learning a new team's workflow and domain, draft questions, workflow notes, domain primers, feeding ticket creation           |
| Leadership      | Cross-project overview, AI usage and spend by team                                                                                 |
| New joiner      | Fast context on a system: what it is, why it was built this way, who knows it                                                      |

---

## 4. Core capabilities

### 4.1 Vertical visibility

Ask: "What is the status of this project, and who owns each part?" Answers come from Jira (owner, status, dates) and the summaries linked to each ticket and PR. Facts come from systems of record, the model only writes the narrative.

### 4.2 Horizontal awareness

Ask: "Who is working near my code, and who has capacity?" Based on assigned work and linked PRs, not activity tracking. Capacity is a suggestion to a human, never an automatic assignment.

### 4.3 Knowledge reuse and expert discovery

Ask: "Has anyone here solved document processing?" Returns who built it, their team, how to contact them (from the org directory), what was implemented, and why, with links to the ticket, PR, and repo.

### 4.4 Problem discovery

For teams building for a group they don't know yet:

- Draft interview questions before stakeholder calls.
- Capture notes from meetings (opt-in) and turn them into a workflow map.
- Play the workflow back to stakeholders for confirmation.
- Provide domain primers (terminology, background) that cite internal sources.
- Feed the confirmed understanding into ticket creation.
- The AI drafts; people run the conversations and approve what becomes a ticket.

### 4.5 Meeting context

Pre-meeting briefings so everyone arrives knowing the background, and post-meeting decisions and action items linked to tickets. Opt-in, scoped to project channels.

### 4.6 Further ideas (later)

- **Onboarding and handover:** searchable history when people move teams.
- **Decision memory:** why a choice was made, so it isn't relitigated.
- **Audit trail:** change, reason, approver, ticket, useful for change management and showing human oversight of AI-assisted work.
- **Blocker and dependency detection** across teams.
- **Auto-drafted** status reports, sprint reviews, release notes.
- **Estimation** from similar past tickets.
- **AI usage and spend reporting** by team, project, and ticket.

---

## 5. How it works

```
Sources                    Platform                       Experiences
-------                    --------                       -----------
AI coding plugin   --->    Redaction                 ---> Web view and chat (managers, PMs)
Jira               --->    Knowledge graph           ---> Engineer view with notes
GitHub             --->    Search and retrieval      ---> Search inside the coding tool
Teams (opt-in)     --->    AI assistant              ---> Analyst discovery workspace
Org directory      --->    Access control, audit
```

### 5.1 Capture (the plugin)

- A hook runs after each AI output in the coding tool and writes a short, high-level summary of what was implemented. The mechanism is a coding-tool hook, but the purpose here is shared visibility, not token savings.
- Summaries roll up in layers: per-output notes, session summary, ticket or PR summary, project overview.
- Secrets and sensitive data are redacted before anything leaves the engineer's machine. Summaries only; raw code and full prompts are not stored.
- The engineer can see, edit, and add notes before or after sync.
- The plugin is one input. The platform is the product.

### 5.2 Integrations

- **Jira:** what was assigned, status, ownership.
- **GitHub:** repos, PRs, commits created by the engineer.
- **Teams (opt-in):** meeting transcripts for chosen project channels only.
- **Org directory:** team and contact details. No new personal data collected.
- Read-only scopes wherever possible.

### 5.3 Knowledge graph

- Nodes: people, teams, tickets, PRs, services, repos, decisions, meetings, domain terms.
- Edges: assigned to, implemented in, discussed in, depends on, similar to.
- Organized by team and domain (for example department categories) so retrieval is fast, with cross-category search allowed within permissions so you can still find that another department solved your problem.

### 5.4 The assistant

- Retrieves a small relevant slice per question; it does not put everything in a prompt.
- Every claim links to a source; if there is no source, it says it doesn't know.
- Shows freshness (when sources were last updated) and confidence.
- Answers only what the asker could already access.

---

## 6. Trust: the hard problems

### 6.1 Hallucination

- Structured facts (owner, status, dates) come from Jira and GitHub, not the model.
- Source links on every claim; "unknown" when evidence is missing.
- Engineer reviews their own summaries.
- Known-answer test set; track wrong-answer and "I don't know" rates before expanding.
- For audit, compliance, and performance questions, point to the source records. Strata is not the authority.
- Honest limit: it will sometimes be wrong. The goal is that wrong answers are visible and checkable and never drive decisions on their own.

### 6.2 Scale (years of data, org-wide)

- Retrieval, not giant prompts. The context window is not the bottleneck; retrieval quality is.
- Tiered roll-ups (output, session, ticket, project, quarter). Most questions are answered from the top layers; detail is fetched on demand.
- Metadata filters first (team, domain, date, permissions).
- Retention: keep decisions, architecture notes, and incidents in full; compress old low-value detail; deduplicate.
- Cost: cheaper models for capture and roll-ups, stronger model for final answers, caching, spend reported by team.
- Trade-off: roll-ups lose detail, so very specific old questions may need drill-down.

### 6.3 Surveillance perception

- Work-centric, not person-centric. No keystroke, idle-time, or prompt-by-prompt logs.
- Person views show assigned work, status, and approved summaries.
- The engineer sees what managers see about them.
- Not used for performance ratings. Cost reporting at team and ticket level, not per individual.
- Benefit to frame: visibility becomes a function of the work, which is fairer to quiet contributors, remote teams, and overloaded people whose load is invisible today.

### 6.4 Security and privacy

- Redaction and secret scanning at source; summaries only.
- Signed, centrally distributed plugin; approved-plugin list.
- Permissions inherited from Jira, GitHub, and Teams and enforced at query time in the index.
- SSO, MFA, role and team access; restricted categories for sensitive projects.
- Prompt-injection defence: retrieved text (tickets, PR comments, transcripts) is treated as data, never as instructions. Read-only design limits what an injection can do.
- Encryption in transit and at rest, least-privilege integrations, anomaly monitoring, audit logs.
- Enterprise AI terms: no training on company data, data residency where required.
- Retention limits, deletion on request, consent and scoping for meeting transcripts.

### 6.5 Human accountability

- Strata only reads and summarizes. It does not decide, assign, or approve.
- Engineers approve their summaries; people decide using cited sources; people assign, escalate, and sign off.
- Sensitive uses require source records and a named approver.
- Named platform owner, governance group, stage-gates between rollout waves, a kill switch.

---

## 7. Rollout (suggested)

| Wave          | Scope                                                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1. Pilot      | 1-2 teams, about 10 weeks. Read-only status visibility and expert discovery. Engineer-reviewed summaries. Cost and usage reporting. |
| 2. Expand     | More teams. Peer awareness, onboarding, discovery support for analysts, opt-in meeting context. Team champions and a feedback loop. |
| 3. Enterprise | Audit trail, blocker detection, auto-drafted reports. Run by a governance-owned platform team.                                      |

Gate between waves: accuracy, security and privacy sign-off, adoption, cost.

Possible success measures (targets to be set after baselines):

- Hours per week on status updates and status meetings.
- Time for someone to understand an unfamiliar ticket.
- Share of sampled answers verified correct against sources.

---

## 8. Landscape

The problem space is common and parts of it are served today:

- **Engineering intelligence platforms** (Jellyfish, LinearB, Swarmia, DX and others) mostly show leaders delivery metrics and where time and money go, and are adding AI coding tool impact measurement.
- **Atlassian Rovo** is a knowledge discovery tool across Jira, Confluence and connected apps, can find people who worked on a project, and cites sources.

Likely differentiators for this idea:

- Engineer-reviewed summaries of AI coding sessions as an input, capturing intent and reasoning, not just activity.
- Work-centric framing instead of a management observation layer.
- Problem discovery support for teams learning a new domain.

Open question: build, buy, or integrate? Evaluate integrating with existing tools and focusing on the part that is unique (the capture layer and discovery).

---

## 9. Implementation options (suggestions)

- **Plugin:** hook in the AI coding tool, local redaction pass, signed distribution.
- **Backend:** ingestion workers for Jira, GitHub, Teams; a graph store plus a vector and keyword search index; permission model mirrored from source systems.
- **AI layer:** small models for summarization and roll-ups, stronger model for answers; retrieval with metadata filters; citation enforcement.
- **Frontend:** web app with chat and project views; in-tool search; engineer notes editor.
- **Evaluation:** known-answer question set, wrong-answer tracking, red-teaming for injection and leakage.

---

## 10. Open questions

- Which AI coding tools to support first, and how stable are their hook APIs?
- What does the summary schema look like, and how much does the engineer have to edit?
- How to handle contractors, multiple orgs, and cross-company repos?
- How to do consent and scoping for meeting transcripts in different jurisdictions?
- How to measure value without turning the platform into a productivity scoreboard?
- What is the minimum useful pilot, and what would make a team stop using it?
- Pricing and positioning if built as a product: internal tool, plugin plus SaaS, or open-core?

---

## 11. Risks

| Risk                      | Mitigation                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------ |
| Seen as surveillance      | Work-centric design, engineer sees and edits, no activity logs, not used for ratings |
| Wrong answers             | Sourced claims, systems of record for facts, "unknown", evaluation                   |
| Privacy or secret leakage | Redaction at source, summaries only, permission-aware retrieval                      |
| Low adoption              | Engineer-first value (own notes, expert search), champions, light plugin             |
| Data and cost growth      | Tiered roll-ups, retention, model tiering, budgets                                   |
| Overbuilding              | Start with status visibility and expert discovery, add the rest by wave              |
| Competing tools           | Integrate where possible, focus on the unique capture and discovery layers           |
