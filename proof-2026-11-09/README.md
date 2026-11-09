# Patched-Gateway proof for openclaw/openclaw#155860

Every file here comes from a real Gateway built from the PR head **5c7facacab3** (branch `pr/155860-update`, `pnpm build:runtime`, then the Control UI rebuilt after `write-build-info`). The Gateway ran in an isolated sandbox: its own HOME/state dir, loopback port 28795, its own token, no channels, no cron jobs copied in, no model API keys. Captured on 2026-11-09.

RPCs were made with `openclaw gateway call doctor.memory.status --params '{"agentId":"main"}' --json`. Screenshots are headless Chrome (playwright-core driving `/usr/bin/google-chrome`, 1400x1000), signed in with the sandbox token in the URL fragment. Sandbox paths appear as `<SANDBOX>`. The token is not in any file.

## The memory slot owner is a fixture

`acme-memory-fixture` (source in `fixture/`) holds the memory slot and registers `dreaming.getStatus` exactly as the PR's `MemoryPluginDreamingProvider` contract describes. All of its data is fake and labelled as such:

- REM `15 1 * * *` and deep `0 4 * * *` (Europe/Berlin). The light phase is event-driven (`cron: ""`, last run 42 min ago).
- `stats`: `promotedToday 4`, `promotedTotal 139`, `shortTermCount 9`.
- `nextRunAtMs` is computed by the fixture. It is not read from a scheduler.
- A scenario file chooses the report on each call: `full`, `none` (returns `null`) or `throw`. Plugin config `runtimeMode` chooses whether the fixture registers a search `runtime` or a `providerRuntime`, which takes a restart.

memory-core's own short-term store in the sandbox was seeded with 1 entry waiting for promotion and 2 promoted today (`fixture/seed.cjs`). That gives memory-core figures that differ from the owner's (2 vs 4 promoted today, 1 vs 9 waiting), so the separation shows on screen.

The real PLUR1BUS v7.19.3 provider was not used. It reports `phases` only, with no `stats`, and it registers `runtime` rather than `providerRuntime`, so it cannot exercise either of the two paths the review asks about.

## Files by scenario

| # | Scenario | RPC | Screenshots | Review checklist wording |
|---|---|---|---|---|
| 01 | Owner reports, host sweep **off** | `01-owner-reports-host-off.rpc.txt` | `01-…dreams.png`, `01-…dreams-review.png`, `01-…overview.png` | "revised `reportedStats` separation with Memory Core's Review data" + "the Review comparison" |
| 02 | Owner reports, host sweep **on** | `02-owner-reports-host-on.rpc.txt`, `02-…cron-list.txt` | `02-…dreams.png`, `02-…off-confirmation.png`, `02-…overview.png` | owner lock (one direction) and the updated Off warning (commit 9dbe8519769) |
| 03 | Slot owner answers through `providerRuntime` | `03-provider-runtime.rpc.txt`, `03-…cron-list-after-host-off-restart.txt` | `03-…dreams.png`, `03-…overview.png` | "the added provider-runtime branch through a patched Gateway" |
| 04 | Fallback: no report / provider throws | `04a`, `04b` (provider runtime), `04c`, `04d` (search runtime), `04-fallback.gateway-log-excerpt.txt` | `04c-…dreams.png`, `04c-…overview.png` | no-provider fallback, re-shown on this head |

### 01: reportedStats separation and the Review comparison
- RPC: `dreaming.enabled: false` is the host config. Alongside it are `reportedByProvider: true`, `reportedEnabled: true` and `reportedStats {shortTermCount 9, promotedTotal 139, promotedToday 4}`. memory-core's own figures stay in place: `shortTermCount 1`, `promotedToday 2`, `promotedTotal 2`, with matching `shortTermEntries` and `promotedEntries`. Per-phase cron, `managedCronPresent: true` and the owner's `nextRunAtMs` are present. Light reports `cron: ""` and `lastRunAtMs`.
- Dreams: the status line reads "Next sweep 1:15 AM · Europe/Berlin · **4 promoted today**", which is the owner's count. Below it is the hint "acme-memory-fixture runs its own dreaming…". The switch is off and **disabled**. The scene shows the lit state (compare the idle scene in 04c).
- Dreams › Review: the note reads "These lists, counts and actions belong to memory-core's short-term store…". The lists show memory-core's **1** waiting and **2** recent promotions, not the owner's 9 and 4.
- Overview › Activity: "4 today · 139 total", waiting 9, with the note "Reported by acme-memory-fixture…". The Sleep schedule shows each phase separately: light n/a (event-driven, last 42m ago), REM `15 1 * * *`, deep `0 4 * * *`.
- The disabled switch comes from the owner lock, not from missing permissions. The same token gets an enabled switch in 02 and 04c.

### 02: host sweep on beside an owner
- RPC: `dreaming.enabled: true` and `reportedByProvider: true`. `cron.list` shows the memory-core promotion job that the host sweep scheduled.
- Dreams: the switch is on and **enabled**, so turning it off stays possible. The hint is `ownerManagedHostOn`.
- `off-confirmation.png` is the result of clicking the switch. It shows "acme-memory-fixture keeps running its own dreaming; this switch does not reach it… the orphan-cron cleanup removes the promotion job memory-core already scheduled."
- `03-…cron-list-after-host-off-restart.txt`: after the host sweep was set back to off in config (not via the dialog) and the Gateway restarted, `total: 0`. The job was present with the host sweep on and gone after that restart, which fits the orphan-cron cleanup the Off text refers to. No log line for the removal was captured.

### 03: provider-runtime branch
- RPC: the reply carries `provider: "acme-memory-fixture"` and `health {status: "ready"}` from the provider handle, which was opened and closed under operator authority. It also carries the composed `dreaming` section with `reportedByProvider`, `reportedEnabled`, `reportedStats {promotedToday 4…}` and the owner's per-phase crons. memory-core's figures are 0 because no search manager runs on this path.
- The Dreams and Overview pages show the owner's schedule and counters with the switch locked, the same as in 01.

### 04: fallback
- 04a/04b (provider runtime): with `null` or a throw from `getStatus`, the reply has **no** `dreaming` key. This is the pre-PR shape.
- 04c/04d (search runtime): no `reported*` fields. All phases use the host's `0 3 * * *` with `managedCronPresent: false`, plus memory-core's own figures (1 waiting, 2 promoted today). 04d is byte-identical to 04c apart from the header. The log excerpt shows `ignoring dreaming status from plugin "acme-memory-fixture": Error: fixture: simulated provider failure`.
- Screenshots: the switch is unlocked, there is no owner hint, Overview shows a single "Sweep 0 3 * * *" with phases Disabled, and Activity shows memory-core's 2 today / 1 waiting.
