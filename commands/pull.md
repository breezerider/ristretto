---
description: Pull one feature from the roadmap and implement it cleanly in auto mode against the current code, then commit on a feature branch and close it. Pass "nocommit" to skip committing, or "raw" for an ungated spike (no gates, no red-first, no review).
argument-hint: <feature ID, or "next"> [nocommit] [raw]
---

You are in the **PULL** phase of ristretto. You implement exactly one feature, directly, in auto mode — there is no approval gate. Closing the feature is **your** job at the end, never the user's.

Target: $ARGUMENTS  (a feature ID, or `next` = the top `planned` row in the roadmap; add `nocommit` to skip the commit at the end)

## `raw` — the ungated lane

`raw` executes the plan and nothing else: no gates armed, no planner subagent, no red-first tests, no review. It exists for spikes, prototypes, and throwaway branches where the ceremony costs more than it returns — **not** for code you intend to keep.

When `raw` is passed: skip step 3 (no marker, so the hooks stay disarmed — the format hook still runs), do step 5 inline in this context instead of dispatching a planner, skip step 7, and skip step 10 entirely. Everything else holds: the Contract is still the contract, you still verify the criteria yourself in step 9, and you still close properly in step 11.

**Raw work is labelled as raw, always.** The `## Evidence` section records `gates: skipped (raw)` and `review: skipped (raw)`, and the roadmap row is appended with `raw`. Ungated code that looks gated on the roadmap is worse than no fast lane at all — you must be able to tell, months later, which commits nothing ever checked. Say so in the final summary too.

Everything below assumes a normal pull unless it says otherwise.

## 0. Check the project's format version — before anything else

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/version.js" check
```

Exit 0 → continue. Exit 1 → **the project's files are in an older shape than this version reads.** Read `${CLAUDE_PLUGIN_ROOT}/docs/format-migration.md` and apply it — it tells the user what is happening, brings `docs/ristretto/` up to date, and hands back here to continue. It is plumbing, not an errand: the user asked for this command, not for a migration. Do not proceed on an unmigrated project — a status or field this version doesn't recognise gets read as something else, silently, and the first sign of it is a wrong decision much further down. Exit 2, or "PROJECT IS NEWER" → stop and report; that is a stale plugin install, not a stale project.

## 1. Read the roadmap first — trust it

Read `docs/ristretto/roadmap.md` before anything else. The roadmap is the source of truth; take it at its word. Don't scan the codebase to second-guess its status — keeping it honest is the developer's call.

- If the target is already **`done`** → **stop.** Tell the user it's already implemented (cite the Updated date / any recorded commit). Do not re-implement.
- Otherwise, proceed. The roadmap mostly stays honest on its own, because `pull` closes features automatically (step 11).

- If the target is **`blocked`**, surface the recorded reason and ask whether to proceed anyway — the block may have been resolved outside the roadmap.
- If the target is **`needs-human`**, its code is already built and committed; what's outstanding is a manual step. Read its section in `docs/ristretto/manual-checks.md`. If every `proves` check there is ticked `- [x]`, this run is a **check re-run**: skip to step 9, prove the criteria that were pending, and close it `done` (step 11). If checks are still unticked, print them and stop — nothing to build.
- If the target is **`needs-review`**, a `brew` built and committed it green but left review findings open after three rounds. This run is a **finding re-run**: read `## Open findings` in `docs/ristretto/plans/archived/<FEATURE-ID>.md`, and any `decision taken:` line in its `## Evidence` — that is a question `brew` answered on its own authority, and the first thing to confirm or overrule. Show them and ask which to fix; you are here and it is cheaper to ask than to guess. On your ruling, work them on a branch as an ordinary change, re-run the gates and the review, then rewrite `## Open findings` to only what remains — clearing it closes the row `done`. Findings you decide against are deleted with a one-line note saying so, never left to be rediscovered next month.

**Resolving `next`:** pick the top `planned` row *whose plan's `Depends:` are all satisfied* — skip any feature still waiting on an unfinished prerequisite. A `Depends:` is satisfied by `done`, `needs-human` **or** `needs-review`: in all three the prerequisite's code is built, committed and gated green, and its `Provides:` are present — what is outstanding is a step to run or an opinion to judge, so none of them may hold up the features behind it. Only `blocked` does that. If every `planned` feature is blocked, stop and say so, naming what each is waiting on. When a **specific feature ID** was named (not `next`) and its `Depends:` aren't satisfied, don't silently skip — warn that a prerequisite is unfinished and ask whether to proceed anyway.

## 2. Read the plan

Open `docs/ristretto/plans/<FEATURE-ID>.md`. **`## Contract` is binding** — acceptance criteria, `Provides:`/`Consumes:`, decisions, units. `## Approach` is guidance, not gospel; it was written before the code moved.

## 3. Arm the gates

The plugin ships deterministic gate hooks: while a pull is active, a Stop hook runs the repo's lint + typecheck + test and blocks you (exit 2) until they're green — enforced, not self-reported. (Skip this whole step under `raw`.)

1. **Read `.ristretto.json` — create it if missing, and complete it if it predates a key.**

   **If it is missing:** **read the repo's `CLAUDE.md` / `AGENTS.md` first** — a repo that documents its own commands has already answered this, and what's written there wins over anything you infer (`pnpm test:ci`, not `pnpm test`). Otherwise detect the stack (`angular.json` → Angular, `next.config.*` → Next.js, `pubspec.yaml` → Flutter; else read `package.json` scripts) and write the resolved commands — adopt whatever format/lint/typecheck/test tooling the repo already uses (read its existing config), never impose new tools. Leave a gate as `""` only if the repo genuinely has no such tool; empty gates are skipped.

   **If it already exists, do not just move on.** A config written by an older version is missing the keys that keep a real repo fast, and an existing file is exactly the case where that gets skipped — the repo looks configured, so nobody looks. Check these three and add whichever are absent, then say in your summary that you migrated it:

   | key | add it when | why it matters |
   |---|---|---|
   | `testChanged` | the full `test` gate takes more than a minute | without it every single subagent stop runs the whole suite — on a slow repo that is the difference between a batch and a batch that never finishes |
   | `formatPaths` | a `format` gate is set | an unscoped formatter rewrites documentation and generated files, and each fix re-triggers it |
   | `silence` / `timeouts` / `lockWait` | only when a default is actually wrong for this repo | leave them alone otherwise; the defaults are per gate kind and hold across stacks |

   **Then check the `testChanged` you already have, not just whether it exists.** A scoped command that dropped a flag the full `test` gate carries is the one misconfiguration that costs more than having no scoping at all, and it is invisible: both commands look right on their own, and only running them side by side shows that the fast path is the slow one. Run the gates once and the runner names any gap out loud (`the scoped gate '...' is missing a flag its full "test" gate has: -n auto`) — it compares the two commands structurally, so it catches flags nobody has heard of yet.

   When it names one, **fix `.ristretto.json` yourself and say so in your summary.** This file is the plugin's own bookkeeping and completing it is what this step is for — the user should not have to hand-edit JSON to stop a loop from stalling. Copy the flag across unless dropping it was plainly deliberate (`--coverage` on a scoped run is fine to leave out; anything that changes how many cores the runner uses is not).

   Adding a missing key is a **migration, not a preference** — do it without asking. Changing a command the user already wrote is the opposite: leave it alone and mention it instead.

   ```json
   {
     "gates": {
       "format": "npx prettier --write {file}",
       "formatPaths": ["src/**/*.{ts,tsx,js,jsx,css}"],
       "lint": "npx eslint .",
       "typecheck": "npx tsc --noEmit",
       "test": "npx vitest run",
       "testChanged": "npx vitest related --run {files}"
     }
   }
   ```

   That example is a JS/TS repo — **it is an illustration of the shape, not a template to copy.** Write the commands this repo actually uses: `ruff check .` / `mypy .` / `pytest`, `./gradlew spotlessApply check test`, `flutter analyze` / `flutter test`, `dotnet format` / `dotnet build` / `dotnet test`, `cargo fmt` / `cargo clippy` / `cargo test`, `go vet ./...` / `go test ./...`. A gate that names a tool the repo doesn't have is worse than an empty one.

   **Every gate command runs from the repo root, and every path substituted into one is repo-relative.** `{file}` (format only) is the touched file, `{files}` is the changed set, and `formatPaths` matches the same way — one path language across the whole file. So write `npx prettier --write {file}`, not a `cd sub && fmt ../{file}` that has to guess where the substitution lands. If a tool must run from a subdirectory, `cd sub && tool ../{file}` still resolves correctly, because `{file}` is relative to the root you started from.

   `.ristretto.json` belongs in git; also add `.ristretto/` (transient state) to `.gitignore` if it isn't there.

   **The format gate never blocks — but it does report.** It is a convenience, so it will not stop an agent over whitespace; a formatter that *fails* is still said out loud, once, and again if the failure changes or returns after a run that worked. A format command that silently did nothing on every edit is the kind of thing that survives for months.

   **Always set `formatPaths` — scope the formatter to the paths it actually owns.** Unscoped, the format hook rewrites every file anyone edits, including documentation and generated files it was never run over. A two-line edit to a README comes back as a hundred-line reflow, and because each attempted fix re-triggers it, the churn can eat entire review rounds before anyone works out that the *gate* is what keeps changing the file. List what your formatter is canonical for; everything else is left alone. Patterns are globs against repo-relative paths and support `**`, `*`, `?` and `{a,b}`:

   | stack | typical `formatPaths` |
   |---|---|
   | JS / TS / Angular / React | `["src/**/*.{ts,tsx,js,jsx,mjs,cjs,css,scss,html}"]` |
   | Python | `["**/*.py"]` |
   | Java / Kotlin | `["src/**/*.{java,kt,kts}"]` |
   | Dart / Flutter | `["lib/**/*.dart", "test/**/*.dart"]` |
   | Go | `["**/*.go"]` |
   | C# / .NET | `["**/*.{cs,csproj}"]` |
   | Rust | `["**/*.rs"]` |

   The risk scales with how promiscuous the formatter is: a language-scoped one (`black`, `gofmt`, `dart format`) only ever touches its own extension, so scoping it is cheap insurance. A general one (`prettier`, `dprint`) will happily reformat Markdown, YAML, and generated output — there, scoping is the difference between a working gate and a recurring trap. **Add it to an existing `.ristretto.json` that lacks it** — this is a config migration, not a preference.

   **Every command must be self-contained.** The hooks run in their own environment and **do not inherit a PATH you exported in your shell**. If a repo needs a specific toolchain — a second SDK install, a version manager shim, a workaround build — put that path in the command itself (`C:\flutter\bin\flutter test`, `./node_modules/.bin/vitest run`). A gate that only works because of a PATH tweak you made by hand will pass your pre-flight and fail in the hook, on a tree you never touched, and the red will look like a repo problem. `verify` records which binary it resolved and the hook says so out loud when it resolves a different one — but the fix is to not let them differ.

   For the same reason: **never run the gates by hand to check them.** Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" verify`, plainly, with no environment of your own. That's the only run that reproduces what the hook does.

   **Set `testChanged` when the full suite takes more than a minute** — it is what keeps the loop fast on a real repo. It runs only the tests affected by what this feature touched; the full suite is proven once at the end, by `verify`. `{files}` is replaced with every modified *and untracked* path:

   | runner | `testChanged` |
   |---|---|
   | vitest | `npx vitest related --run {files}` |
   | jest | `npx jest --findRelatedTests {files} --passWithNoTests` |
   | karma / Angular | `npx ng test --watch=false --include {files}` |
   | pytest | `python -m pytest {files}` *(only with a source→test route, see below; carry over `-n auto` if the full gate has it)* |
   | flutter / dart | `flutter test {files}` |
   | go | `go test ./...` *(usually fast enough — leave empty and let `test` run)* |
   | gradle | `./gradlew test --tests {files}` *(or leave empty; Gradle's own up-to-date checks already skip unaffected work)* |
   | maven | *(no reliable per-file selection — leave empty and rely on `test`)* |
   | dotnet | `dotnet test --filter FullyQualifiedName~{files}` *(needs class names, not paths — often better left empty)* |
   | rust | `cargo test` *(incremental by default — leave empty)* |

   **Give the scoped command every speed flag the full one has.** This is the mistake that looks most like correct config and hurts most: a `test` gate of `pytest -n auto` beside a `testChanged` of `pytest {files}` runs the *whole repo* on all cores and the *few files this feature touched* on one. Past a certain size that inverts — the scoped run becomes slower than the full suite it was added to avoid, and because it is the fast path nobody thinks to time it. The only symptom is a loop that feels slow, until a run goes quiet long enough to be killed. Carry the flags across, whatever they are: `-n auto` (pytest-xdist), `--maxWorkers` (jest), `--parallel` (Gradle), `--` thread settings for vitest. Then time it once: a scoped run should be seconds, not minutes. The gate runner will tell you if it isn't.

   **`{files}` is the files the feature CHANGED — which is not the same as the tests that cover them.** Some runners map one to the other for you: `vitest related`, `jest --findRelatedTests`, `flutter test`. Others just take paths and run whatever tests are *in* them, and a change that touched only implementation then hands them a list containing no tests at all. `pytest` is the one that bites, because "no tests collected" is exit 5, and exit 5 is a **failing gate**: the agent is blocked and told to fix a suite that never ran. It then goes looking for a broken test that does not exist. jest avoids this with `--passWithNoTests`; pytest has no equivalent, so either route source files to their tests (`{"match": ["backend/**/*.py"], "cmd": "python -m pytest backend/tests -n auto"}` — the whole backend suite, still skipped entirely for a frontend-only change) or leave the route empty and let the full `test` gate prove it. **Check this by running your scoped command by hand against a source file with no test in it.** Anything that isn't exit 0 on a healthy repo is a red the loop will hit at three in the morning.

   **Leave it empty whenever the runner can't scope honestly.** A `testChanged` that maps paths to the wrong tests is worse than no scoping at all: it reports green while proving nothing, and the loop is built on trusting that green. Maven, and any runner that selects by fully-qualified class name rather than file path, are exactly this case — an empty `testChanged` just falls back to the full `test` gate, which is always correct and sometimes slow. Slow is recoverable; a dishonest green is not.

   **On a repo with more than one stack, `testChanged` must be a list of routes, not one string.** A single command gets *every* changed path substituted into it, so a backend+frontend repo would hand `.tsx` files to pytest. Route them instead — each entry sees only its own files, and an entry with nothing to do never runs at all:

   ```json
   "testChanged": [
     { "name": "backend",  "match": ["backend/**/*.py"],           "cmd": "python -m pytest {files}" },
     { "name": "frontend", "match": ["frontend/**/*.{ts,tsx}"],    "cmd": "npx vitest related --run {files}" },
     { "name": "docs",     "match": ["docs/**", "**/*.md"],        "cmd": "" }
   ]
   ```

   That last entry is the point of `cmd: ""` — it claims files and runs nothing, the explicit way to say "changes here need no tests". **Anything matching no route at all falls back to the full suite**, and says so: an unrecognised path might be the one that breaks everything, and a green that quietly skipped it would be a lie. So the routes are worth completing — but an incomplete one is never unsafe, only slow.

   This is where the wall-clock actually goes on a big project. A frontend-only feature that never starts the backend suite turns a multi-minute gate at every subagent stop into a few seconds.

   **Prefer the `{files}` forms over a runner's own change detection.** `vitest --changed`, `jest -o` and friends read git's diff, which does not include untracked files — and a brand-new test file is exactly what red-first produces, so the tests that prove this feature would be the ones skipped. Leave `testChanged` as `""` when the suite is already quick; the loop then runs the full gate as it always did.

   **`testReport` — let the gate tell your breakage from breakage that was already there.** Point it at a machine-readable report your test command writes, and the gate stops asking "is the suite green" and starts asking "did this change break anything". Failures already present when the feature started are tolerated and counted; a failure that is new blocks, and the message names only the new ones. This is what lets ristretto work in a repo whose suite is not fully green — which it previously refused outright, so one unrelated broken test locked it out of the whole repository.

   ```json
   "test":       "pytest -q -n auto --junitxml=.ristretto/report.xml",
   "testReport": ".ristretto/report.xml"
   ```

   Routes carry their own: `{ "match": [...], "cmd": "...", "report": ".ristretto/rb.xml" }`. JUnit XML is read, and so is Dart/Flutter's own JSON reporter — which has no junit option at all. If your runner emits machine-readable results in some other shape, that is a reader worth adding to the plugin rather than a converter worth installing in your repo.

   **Work out the reporter from THIS project — never write one from memory.** Whatever you believe about a runner's flags may be wrong, out of date, or right for a version this repo is not on. And a `testReport` naming a file that never appears makes every gate announce a missing report, forever. So find out:

   1. **Read what the repo already does.** A CI workflow that uploads test results has solved this exact problem for this exact runner, and its flag is known to work here. `.github/workflows/`, `CLAUDE.md` / `AGENTS.md`, `package.json` scripts, `pyproject.toml` — the answer is usually already written down.
   2. **Run it**, against a small subset if the suite is slow.
   3. **Probe it:** `node "${CLAUDE_PLUGIN_ROOT}/scripts/testreport.js" --probe <the path>`. Exit 0 means the file exists and parses as something the gate can actually use.
   4. **Only then** write `test` / `testReport` into `.ristretto.json`.

   **If you cannot get a report, write nothing and say so.** Several runners need a package installed first — `jest-junit`, `rspec_junit_formatter`, `JunitXml.TestLogger`, `cargo2junit` — and installing one is the user's call, not yours. Name what it would take and move on. Gates then behave exactly as they always have, which is a perfectly good outcome. A `testReport` that does not work is strictly worse than none.

   **The tolerated set can only ever shrink.** A test that starts passing leaves it and cannot return without blocking; an unattended run can never add to it. If a feature legitimately makes an old test wrong, that is a decision for a person — the feature goes `blocked` and you refine it. Tests *permanently* expected to fail belong in the suite as `skip`/`xfail`, where every developer benefits, not in this config where only ristretto would know.

   Leave `testReport` out and everything behaves exactly as it always has.

   Four optional keys tune the runner, all in seconds:
   - **`silence`** — how long a gate may print *nothing* before it's killed as hung. Defaults: `lint` 600, `typecheck` 600, `test`/`testChanged` 300. Raise it for a tool that's quiet by nature.

     **You will rarely need to touch this.** The budget calibrates itself: every gate that finishes green has proven how long its own healthy silences are, and that measurement widens its budget from then on. It only ever loosens, never tightens, and it is capped — so a suite that grows past the default stops being killed for it, without a hang becoming unkillable. Nothing here is per tool, which is the point: the runner learns a .NET build that says nothing for four minutes exactly the way it learns a chatty one.

     **A gate that is killed having printed nothing at all also widens** — doubling each time, up to the same cap. Without that, the one shape of tool that most needs a longer rope was the only one that could never earn it: a green run was the sole evidence accepted, and a buffering tool is killed before it can produce one. It would then be killed identically forever. So a gate that produced not one byte is given twice the rope and tried again, while a gate that *spoke and then went quiet* — a real hang — is given nothing.

     **A tool that buffers looks exactly like a tool that hung.** Gates run piped, not attached to a terminal, and plenty of runners switch to block buffering when they notice — so a suite whose entire output is smaller than one buffer emits *nothing at all* until it exits. `pytest -q` over a thousand tests is about a kilobyte of dots: silent for its whole run, killed the moment it outgrows the budget, and it was healthy the entire time. The runner sets `PYTHONUNBUFFERED=1` for you, and says so when a gate produced not one byte from start to finish. If you hit this on another stack, make the tool stream (an unbuffered flag, a progress reporter, a per-test format) rather than raising `silence` — a budget over a tool that never speaks is not measuring anything.
   - **`timeouts`** — a hard cap on total runtime. **Off by default, and usually should stay off**: a slow gate is not a broken gate, and a cap kills a working suite at an arbitrary number.
   - **`lockWait`** — how long a gate run waits for the repo-wide gate lock before giving up (default 480). Only one gate run executes at a time: two suites sharing a database, a port, or a fixture produce failures that belong to neither, and a red you can't trust is worse than no red at all. A run that waits this out reports the work *unverified* — never green, never red — and asks to be run again, bounded by the retry budget. The default is deliberately shorter than it sounds: an agent that goes quiet for about ten minutes is killed, and a killed agent's result is lost entirely, so a wait that outlasts its own caller helps nobody. Raise it only on a repo where gate runs legitimately queue for longer and nothing is waiting on the result.

   - **`watchdog`** — how long the agent waiting on these gates may stay silent before its own harness kills it (default 600). You are not setting a policy here, you are telling the runner a fact about the environment it is running in, and it is the budget the *whole* stop is spending: the queue wait and the gate run come out of the same ten minutes. So the lock wait is sized against it — never more than what is left after the last measured run — and a pass that eats more than half of it says so, with numbers, while someone is still alive to read the message. A killed agent does not report a failure; it reports nothing at all, and the feature blocks for a reason that was never about the feature.

   A gate judged hung is **surfaced immediately, never retried** — retrying a hang just hangs again — and the work is reported *unverified*, which is neither green nor red.

2. **Create the marker file `.ristretto/pulling`** (empty), and `.ristretto/build/` if it doesn't exist. The marker arms the Stop gate for the duration of the pull. The gates are infrastructure, not suggestions: never weaken, skip, or delete gates or tests to get green — a red gate means the work is not done.

## 4. Check the working tree

Before spending a planner run, confirm there's somewhere safe to work:

- If the working tree is **dirty** or it's unclear what to branch from, **stop and ask** — never work over uncommitted work.
- If it's clean, or you're already on a branch for this feature, continue. The branch itself is created in step 6, once there's a plan worth putting on it.

## 5. Expand the plan against the current code

The plan holds the destination. This step writes the directions — **now**, against HEAD, so they cannot be stale.

Dispatch one **planner** subagent (fresh context, capable model) with this brief verbatim. Under `raw`, do this yourself in this context instead — no subagent, no `.ristretto/build/` file.

> You are the PLANNER for ristretto feature **<FEATURE-ID>**. You write no implementation code and modify no source file.
>
> 1. Read `docs/ristretto/plans/<FEATURE-ID>.md`. `## Contract` is binding; `## Approach` is guidance that may be stale.
> 2. For every ID in `Depends:`, read that feature's archived plan and take its `Provides:` as fact — those signatures exist, use them verbatim.
> 3. Read the current code in the touchpoint areas. Find the existing utilities, patterns, and test conventions this repo already uses. What you find beats what the Approach says.
> 4. Read the repo's house rules — `CLAUDE.md` / `AGENTS.md`, including any nested one near the files this will touch. They bind the plan even where the surrounding code doesn't demonstrate them yet; inferring conventions from code alone misses everything the repo decided but hasn't applied.
> 5. Write `.ristretto/build/<FEATURE-ID>.md`: for each unit in `Contract.Units` (or the whole feature if `Units` is `—`) — exact file paths to create or modify, the real function/type names and signatures each unit produces and consumes, and the test cases that prove each acceptance criterion, as actual test code in this repo's test style.
> 6. **No placeholders.** No "TBD", no "add error handling", no "similar to the above", no reference to a type or function no unit defines. Any of these means the plan is not finished.
> 7. **Manual checks — you are the one who decides these, and your default is that there are none.** A manual check exists for exactly one reason: **this repo gives you no path to the thing a criterion is about.** Not that the criterion involves a database, a screen, or an external service — those are subjects, and the subject decides nothing.
>
>    Take `Contract.Manual-Checks` as a *hypothesis written before anyone read the code*, and settle each line against HEAD. You are the first actor in the chain who can actually check, so check:
>    - **Is there a path?** Look for it in whatever form this stack takes: `docker-compose.yml`, a `Makefile` target, `package.json` scripts, Gradle/Maven tasks, Testcontainers, Alembic/Flyway/Liquibase, a `migrate`/`seed` command, a test harness that migrates on boot, fixtures, a `.env.example` carrying dev values, or a driver already in the dev dependencies — Playwright, Cypress, Selenium, `flutter_test`/`integration_test`, a snapshot harness. A prep line saying "apply the migration by hand" against a repo whose compose file runs migrations on boot is **wrong, and you delete it** — the criterion becomes `[auto]` and gets a real test.
>    - **Can a test judge it?** If the repo can drive the UI, "does the dropdown open" is an ordinary test. Where nothing can render it, reason about the markup and the component before deferring to a person.
>    - **Only what survives both** stays a check, and it names *what specifically* was out of reach — which credential, which console, which device. If you cannot name that, there is no check; there is a test you didn't write.
>
>    Adding a check prep didn't foresee is equally your job — the console this genuinely needs and nothing in the repo can reach. The direction doesn't matter; the evidence does. **Never write a check about production.** Rollout, prod backfill, key rotation, enabling a flag for real users: not yours, not the user's, not on the list.
>
>    For each surviving check record in the build plan: `proves`, **which acceptance criterion it proves**, what was out of reach, and **the exact command, SQL, or thing to look at**, written against the code as you are planning it.
>
>    A manual check is **not** a blocker. The code is still fully planned and built — plan the tests that need the unreachable thing as skipped-pending tests (this repo's idiom: `test.skip`, `@pytest.mark.skip`, `@Ignore`) each naming the check that unblocks it, so they exist and run the moment it lands.
> 8. If the Contract cannot be satisfied against the current code — a criterion contradicts what's there, a `Consumes:` signature doesn't exist, a decision was never made — do **not** guess. Write nothing and return `blocked`. A missing manual check is never a reason to return `blocked`; a missing *decision* is.
>
> Final message, exactly one of:
> `planned: <FEATURE-ID> — <n> units, <n> tests, <n> manual checks`
> `blocked: <FEATURE-ID> — <the spec gap, phrased as what the plan failed to decide>`
> Nothing else.

On `blocked:`, stop the pull and set the roadmap row to `blocked` with that reason (disarm the gates first — step 11.4). No branch was created, so there is nothing to clean up. On `planned:`, continue — steps 7 and 8 work from `.ristretto/build/<FEATURE-ID>.md`, not from the plan's `## Approach`.

**If the build plan carries manual checks, write them to `docs/ristretto/manual-checks.md` now** (create the file with the header below if missing), appending or replacing this feature's `##` section. Manual checks are the one place ristretto writes literal commands — they are for a human to run, not for the repo:

```markdown
# Manual Checks

Things ristretto had no way to reach. Do one, tick its box, then re-run
`/ristretto:pull <ID>` (or `/ristretto:brew`) to verify what was waiting on it.
A check blocks only its own feature's remaining criteria — never other features.
Every line names what was out of reach. Nothing here is ever about production.

## BREW-224 — user tiers
- [ ] **proves** · criterion 2 · hosted Supabase project — no service-role key in this
      environment, so the agent cannot apply this itself · add the column the code reads
      ```sql
      alter table profiles add column tier text not null default 'free';
      ```
      _criterion:_ "a free user sees the upgrade banner" · _test:_ `tier banner renders` (skipped)
```

Keep the shape exactly — `- [ ] **proves** · criterion · what was out of reach · what to do` — it's what later runs read to tell a done check from a pending one, and every line names the criterion it proves. **The third field is load-bearing**: it must name the specific thing that had no path from this repo — a missing credential, a hosted console, a physical device — and a line that can only say "a person should check this" is a test that didn't get written, so write the test instead. Never tick a box yourself; that is the user's signature that the step really happened.

**One example is shown because one is a realistic number.** Most features add no lines to this file at all. If a run is producing several per feature, the reach test is not being applied — the repo almost certainly has a path to most of them.

## 6. Branch

There's a build plan, so there's work to hold:

- If you're not already on a branch for this feature, create and switch to `feature/<FEATURE-ID>`.
- If you're already on a suitable branch, reuse it.

Never push, never set an upstream.

## 7. Write the contract as tests — red first

If the repo has a test gate, the build plan's test cases become tests **before any implementation** — they are already transcriptions of the acceptance criteria; do not re-derive them.

- **Transcribe, don't invent**: every assertion restates an acceptance criterion. If the AI decides what "correct" means, the loop is broken.
- **Run them and confirm they fail.** The red run is the proof that the tests actually test something. A test that passes before implementation proves nothing — rewrite it; if the criterion is genuinely already met by the current code, say so and investigate before continuing.
- Criteria that aren't test-checkable (measurements, binary observations) are exempt — they're proven in step 9. No test gate in `.ristretto.json` → skip this step entirely.
- **Criteria waiting on a `proves` manual check** are exempt from red-first too: their tests are written but skipped, each naming the check that unblocks it. They can't go red honestly — the environment they need doesn't exist yet — and a skipped test that names its reason is the honest form of that.

## 8. Implement the build plan

`.ristretto/build/<FEATURE-ID>.md` was written against the current code minutes ago; the `## Contract` behind it is the acceptance contract. Implement the plan; do not re-plan.

- Follow the build plan's file paths, names, and signatures. Reuse the existing patterns and utilities it identified.
- You're done implementing when the red tests from step 7 pass and every acceptance criterion in the Contract holds.

**Efficiency (the whole point of ristretto) — write it lean the first time:**
- **Reuse before writing**: before adding code, check the repo for an existing utility or pattern that already does the job. Reusing is the cheapest way to avoid duplication — `tamp` catching it later costs more than not writing it.
- **No waste in the code you write**: no N+1 or recomputation that could be hoisted, no copy-pasted logic, no scaffolding or abstraction nothing needs yet (YAGNI).
- **No waste in how you work**: don't re-read files already in context, don't restate the plan, targeted edits over rewrites — the smallest diff that meets the acceptance criteria.

## 9. Verify & record evidence

Check the result against each acceptance criterion. **Run the full suite once, now:**

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" verify
```

`verify` runs lint + typecheck + the *whole* test gate, ignoring both the scoped-test shortcut the loop uses and the green-tree cache. This is the run that proves nothing elsewhere in the repo broke; the scoped runs during implementation only ever proved the feature's own files. Fix until it's green — it exits 0 green, 1 red, and prints a `gates: lint ✓ typecheck ✓ test ✓` summary you'll reuse in the Evidence. Under `raw`, skip this and say so.

If a gate was killed as **hung** (it stopped printing) rather than failing, the work is unverified, not proven broken: don't commit on the strength of a hang. Find what it's waiting on — an open handle, a port, watch mode, a prompt — or raise that gate's `silence` budget if the tool is simply quiet for long stretches. Then verify again.

Then write down the **Evidence**: for each criterion, *how* it was proven — test names, command output, measurements — including **red→green**: which tests failed before implementation and pass now. "Implemented successfully" is not evidence. A criterion waiting on a `proves` manual check is recorded as `pending human: <the check>` with its skipped test named — never as proven.

## 10. Review gate — independent, before any commit

Gates prove the tests pass; they can't prove the code is right or lean. Before committing, the diff gets an **independent review** by a fresh subagent that never saw your implementation reasoning.

**Skip only when the diff is trivial**: roughly < 15 changed lines *and* no new logic (no new functions, branches, or loops — renames, copy, config tweaks). When in doubt, review. Under `raw`, skip this step entirely — that's what `raw` buys, and what the `review: skipped (raw)` label on the record costs.

Dispatch one subagent (general-purpose, fresh context) with this brief verbatim, filling in the ID and the diff scope:

> You are the independent REVIEW gate for ristretto feature **<FEATURE-ID>**. You did not write this code — judge it cold. Read `docs/ristretto/plans/<FEATURE-ID>.md` (`## Contract` is the contract), the repo's `CLAUDE.md` / `AGENTS.md` if present (the house rules — treat them as binding on the changed files), and the feature's diff: <files touched / branch vs merge-base>. You change no files. Do not run the gates: another run may hold the lock, and yours would either wait or measure a tree someone else is measuring.
>
> Three buckets, priority order:
> 1. **`block`** — the shipped product misbehaves: an acceptance criterion genuinely not satisfied, data loss or corruption, a security hole, a documented house rule the diff violates, an unhandled edge case a user can actually reach on a changed path.
> 2. **`note`** — the product is right, but the proof is weaker than it claims: a test that passes vacuously, a docblock that overstates what is proven, a criterion proven by proxy without saying so, a changed path with no coverage.
> 3. **`lean`** — tamp's facets: runtime waste (N+1, hoistable work), duplication vs utilities that already exist in this repo, dead/over-built code, readability drag.
>
> **The line between `block` and `note` is the one that decides what this costs.** A test you believe is vacuous is a **`note`**. A test that is vacuous **and** whose criterion you went and checked and found actually unmet is a **`block`** — name the criterion and say how you checked. Weak proof is a note; weak proof hiding a real defect is a block, and one read tells you which.
>
> **Every `note` states, in one clause, why a user cannot be harmed by it.** A note without that clause is not a note. This is deliberate: downgrading a real bug to a note is easy and invisible, but writing "cannot harm a user because…" next to something that can is not, and it leaves your reasoning where the next reader can catch it.
>
> Report **every `block` you can point at — that list is never truncated** — then at most **5 `note`** and at most **5 `lean`**, highest-value first; if more exist, add `+N minor omitted` and stop. Blocks first, each finding one line: `block|note|lean · file:line · what's wrong · the fix`, with a note's why-not-blocking clause in that same line. Flag only what you can point at — no hypotheticals, no style nits. **House-rule staleness is not a finding**: if `CLAUDE.md` / `AGENTS.md` has drifted out of date with the code, put that in one trailing line *after* the findings — nothing in this loop may edit those files, so a finding nobody is allowed to act on costs a fixer round and buys nothing. (A diff that *violates* a house rule is still a `block`.)
>
> Your final line is exactly one of these three, and nothing follows it:
> - `review: clean` — nothing at all.
> - `review: notes-only (n note, m lean)` — nothing blocking.
> - `review: blocking (n)` — n blocks, listed first above.

Then act on the verdict — **capped at 2 rounds, never a ping-pong**:

- **`review: clean`** → proceed to close.
- **`review: notes-only`** → **proceed to close.** Copy the notes and leans verbatim into the archived plan under `## Open findings` — the reviewer's own words, not your summary. Do not fix them and do not round for them. A note cannot harm a user by its own definition, and a round spent on one is exactly the cost this loop was built to stop paying.
- **`review: blocking (n)`** → fix **every `block`** (mandatory). A round is being paid for anyway, so clear the notes and leans in the same pass — unless a fix is riskier than the win, which you state in your summary. Re-run the gates.
- **Round 2** (only on `review: blocking`): dispatch a fresh reviewer to *verify the round-1 blocks, and any new **block** the fixes introduced in files the fixer touched* — not to open new fronts. A block in code the fixer never touched is reported and goes to `## Open findings`; it does not start another round. New notes and leans are not reportable in round 2 at all.
- **Blocks still open after round 2** → hard stop: do **not** commit. Surface the findings to the user, leave the branch as it is, and disarm the gates (step 11.4). **Leave the work in the tree — never `git restore` it.** The gates are green and the code works; what is unresolved is an opinion, and deleting a green tree over one is disproportionate. The branch is exactly where the user wants it while they decide.

  **`pull` stops here where `brew` closes `needs-review`, and the difference is you.** You are at the keyboard: a question asked now is answered in seconds, so asking beats both guessing and parking. `brew` has nobody to ask at 3am, so it commits, records the findings, and moves on rather than costing you the rest of the pot.

## 11. Close — mandatory, automatic

Once criteria are met:

1. **Commit** (unless `nocommit` was passed): stage only the files you touched — never `git add -A` — and commit with a conventional message: `feat(<FEATURE-ID>): <short summary>`. Record the commit hash. If `nocommit` was passed, leave the changes uncommitted in the working tree and say so; the user will commit themselves.

   **Writing the message safely — this is where closers get into trouble.** A subject passed inline through a shell is re-interpreted by that shell, and the characters that break it are ordinary in a summary: `@` (npm scopes, `@Override`, decorators, emails), backticks, `$`, `!`, and quotes. A mangled subject then tempts a repair with `--force` or `--amend`, which is forbidden — so the fix belongs *before* the commit, not after.

   - **Default: keep the subject plain.** ASCII, one line, no backticks, `@`, `$`, `!`, or quote characters. Almost every summary can be written this way, and then a plain `-m` is safe on every shell.
   - **If the summary genuinely needs those characters, or spans more than one line:** write the message to a file and commit with `git commit -F <path>`, then delete the file. Do **not** reach for a heredoc — it is unreliable in this environment.
   - **Never** repair a bad message with `--amend`. If a message came out wrong, that is worth reporting; rewriting history is not on the table.
   - **Never** push, set an upstream, `--force`, reset, or open a PR. Local and append-only. `--amend` has exactly one legal use: fixing the message of the commit you just made, when nothing has been committed since — say so when you use it. Never amend to change content, and never amend a commit you didn't just create.
2. **Correct `Provides:` to whatever was actually built**, then append an `## Evidence` section to the plan (the proof from step 9, a one-line gate summary like `gates: lint ✓ typecheck ✓ test ✓`, and the review verdict **with the rounds it took** — `review: clean (1 round)`, `review: notes-only — 3 open (1 round)`, `review: 4 blocks resolved in 2 rounds`, `review: skipped (trivial diff)`, or `review: skipped (raw)`), then move `docs/ristretto/plans/<FEATURE-ID>.md` → `docs/ristretto/plans/archived/<FEATURE-ID>.md`. A `Provides:` that drifted during implementation and was never corrected poisons every dependent feature — the archived plan is what the next feature's planner reads as fact.
3. Update the roadmap row: set Updated to today, append the files touched and the commit hash (or `uncommitted` if `nocommit`, plus `raw` if this was a raw pull), and set the status:
   - **`done`** — every acceptance criterion is proven.
   - **`needs-human`** — the code is built, committed, and gated, but at least one criterion is `pending human check`. The row's reason names the outstanding check and points at `manual-checks.md`. This is a *closing* status: the feature is finished as far as ristretto can take it, the plan is archived exactly as for `done`, and **it never holds up a dependent feature** — its `Provides:` exist in the code. Once you've run the check and ticked the box, `/ristretto:pull <ID>` re-checks the pending criteria and flips the row to `done`.
   - **`needs-review`** — built, committed and gated green, with review findings still open. **`pull` never writes this status**; only `brew` does, because only `brew` runs with nobody to ask. It is listed here because `pull` can be pointed at such a row to resolve it — see step 1.
   - Every check now proves a criterion, so there is no longer a class of check that closes `done` with lines outstanding. A feature with an unticked check is `needs-human`; a feature with none is `done`.
4. **Disarm the gates:** delete `.ristretto/pulling` (and `.ristretto/gate-retries` if present). Do this even when a pull is aborted midway — a stale marker keeps gating sessions that aren't pulls.
5. **Delete `.ristretto/build/<FEATURE-ID>.md`.** It was derived from (plan + HEAD) and is reproducible; keeping it would commit rot. Delete it on an aborted pull too.

The file's location is the status. Archiving **is** closing — so it always happens here, and the user never has to remember.

## When done

Print a short summary: what changed, which criteria are satisfied, the review verdict (including any `lean` findings deliberately left), the branch and commit (or that it's left uncommitted), and confirm the plan was archived and the roadmap updated. If this was `raw`, say plainly that nothing gated or reviewed it. If manual checks are outstanding, list them and point at `docs/ristretto/manual-checks.md`:

```
🔧 1 manual check waiting — docs/ristretto/manual-checks.md
   proves · criterion 2 · Supabase SQL editor (dev) · add profiles.tier
```

End with a little cup:

```
  ( (
   ) )
  c[__]  ☕ shot pulled
```

If closing this feature left **zero** open features on the roadmap, celebrate instead with the full milestone cup:

```
   ) )  ( (
.__________.
|          |]
|          |
`----------'
ALL BREWED — roadmap clear ☕
```
