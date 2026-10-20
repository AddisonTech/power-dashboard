# Changelog

Releases before 1.3.0 are recorded in the git history and their merge
commits.

## 1.3.0 - 2026-10-20

- **Triage agent 0.3.0.** `backend/requirements.txt` pins the agent to
  the commit its 0.3.0 release was merged as (`cc5f707`). 0.3.0 adds an
  eval suite that grades what the agent's writers put on each card, and ships the
  latest pass rates in the package.
- **How this agent is graded.** A small panel at the foot of the Triage
  tab: the template writer's pass rate on each of the agent's six graders
  (grounding, root cause, escalation, uncertainty, next step, format),
  how many of the agent's synthetic cases passed every grader, and a link
  to the Evals section of the agent's showcase page. Collapsed until
  opened.
- **`GET /api/triage/grading`.** Returns those numbers, read from the
  installed agent with `bms_triage_service.eval_scorecard()`. Nothing is
  hard-coded in the dashboard; a 503 if the installed agent has no
  scorecard.
- **The template's wording is tighter in the agent.** Unexplained
  electrical alarms now say "no confirmed" cause, as the evidence does,
  and times past the limit stay in seconds. The live outage card is
  unchanged: the utility failure first, the other 5 alarms collapsed
  under it, and the frequency dip measured from the load step (58.88 Hz,
  1.12 Hz below 60, back within 0.5 Hz in 2 s).
- **Fixtures.** The Triage tab's fixtures were rebuilt from the simulator
  with the new agent by `backend/scripts/make_triage_fixtures.py`, which
  is now in the repository. Apart from the agent version and run timings
  they are identical to 1.2.2's.

Verification: backend 85 tests, front end 44 tests, production build.
