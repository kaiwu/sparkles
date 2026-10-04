# pi_sparkles_watchlist

Status: **Tier 3 ProductUseful** · session-branch collection state

`watchlist` is the session-branch persistent workflow-state slice. It
registers `/watch`, `watchlist_add`, `watchlist_remove`, and
`watchlist_snapshot`.

Every member is keyed by the complete caller-supplied tuple:

```text
track | MIC | symbol | namespaced instrument ID
```

The only track values are `cn`, `hk`, and `us`. Instrument IDs must be
namespaced, for example `figi:BBG000B9XRY4`, `cninfo:000001`, or
`hkex:00700`. Symbols and MICs are stored exactly after strict uppercase
validation. The plugin never resolves a symbol, infers a venue, moves a member
between tracks, or presents caller-supplied identity as authoritative.
Mainland entries are limited to six-digit `XSHG`/`XSHE`/`XBSE` keys, Hong Kong
entries to five-digit `XHKG` keys, and US entries to the explicitly supported
US exchange MIC set. A syntactically valid but cross-track MIC fails closed.

`watchlist_add` creates a lowercase named watchlist when needed and adds or
updates its exact listing member. A member may carry one compact note, one
HTTPS thesis link, and bounded lowercase tags. Repeating the identical input is
idempotent and does not append another persistence event. `watchlist_remove`
requires the same complete listing key; removal by symbol alone is unavailable.

Persistence uses versioned mutation entries on Pi's active session branch.
State is restored by replaying every matching entry in branch order with
strictly contiguous revisions. Resume and inherited fork history work; moving
to another branch immediately restores that branch's state. Malformed,
missing-payload, non-contiguous, or invalid events lock mutation instead of
being ignored or overwritten.

The ordinary collection remains branch-scoped: a fresh session starts empty.
`watchlist_snapshot` also returns exact `snapshotJson` and `snapshotSha256`
fields for an explicit content-bound handoff. The digest validates content;
it does not authenticate listing identity or a provider.

## Optional Pi Durable storage and reviews

The Pi sibling offers a conversational opt-in through `watchlist_durable`.
Its model hint asks the LLM to check status and offer to remember personal picks
when relevant, then wait for the user's acceptance. Nothing creates storage,
loads Pi Durable, or polls a source until acceptance. Saving alone starts no
polling. An LLM hint makes the option available; it cannot guarantee that every
model will offer it.

After acceptance, `watchlist_durable(action="enable", userAccepted=true)` opens
`~/.pi-sparkles-watchlist`. An optional exact absolute `directory` selects a
private user-owned empty directory or a compatible existing store. The default
store reopens on later Pi sessions/processes after opt-in. Custom paths reopen
within that Pi process; after restart, select the same custom path again through
conversation. No Pi settings or credentials are written.

Use this explicit handoff:

1. Inspect `watchlist_durable_snapshot` for `storeRevision`.
2. Export `watchlist_snapshot`, retaining its exact serialized snapshot and hash.
3. Call `watchlist_durable_save` with those fields, `expectedRevision`, and a
   unique `requestId`. A changed revision or content hash fails closed.
4. In another chat, inspect `watchlist_durable_snapshot` to use the saved picks.
   This does not replace that chat's branch collection or merge it implicitly.

`watchlist_review_run` performs one review. `watchlist_review_schedule` requires
an explicit watchlist, provider `eastmoney`, share class `a_share`, request
budget, first due Unix milliseconds, interval and review count. Plans pin the
saved snapshot; subsequent edits/saves do not change an existing schedule.
CN listings use the existing `cn_stock_quote` tool and shared `finance_http`
adapter, with caller-owned runtime `AGENT_CONTACT`. Identity remains unverified.
HK/US picks return `track_partial`; no provider or track fallback is attempted.
Source receipts preserve exact prices, retrieval/date, freshness and rights.
Price comparisons belong to the pure Gleam core; investment interpretation
belongs to the LLM and user.

Review tasks checkpoint source intent before calling the tool. A completed
source receipt is reused after restart. An interrupted attempt becomes
`cannot_check` with `change="unknown"`, even if it may not have reached the
provider. It is never refetched under that attempt identity. A fresh explicitly
requested review may obtain a new observation. Receipts are atomic with task
progress, content-bound, and not provider-authenticated. Tool invocations are
counted when known; transport request counts and interrupted invocation counts
remain unknown where the underlying capability cannot prove them.

`watchlist_review_status` exposes jobs, next due time and latest receipts.
`watchlist_review_cancel(requestId)` cancels that task and its owned source
calls. `watchlist_durable(action="close")` pauses the current connection;
`action="disable"` also stops automatic reopening. Saved data is retained.
Default stores reenable through conversation. Read the receipts before claiming
that nothing changed: silence means unknown. No external notification channel
or model generation is configured in the durable harness.

Scheduling uses fixed wall-clock intervals while Pi owns the store, with no
market-calendar or real-time guarantee. An overdue review resumes once and
skips missed interval boundaries, reporting them instead of bursting requests.
Limits: ten picks per review, at most ten admitted review jobs per store,
1–30 reviews per job, intervals 1 hour–30 days, 500 admitted mutations/jobs,
32 KiB per source receipt, and a 100 MiB local store. Create another explicitly
selected store when its lifetime budgets are exhausted. Branch collection
limits remain 20 lists, 200 members per list, 1,000 members total, 20 tags per
member, and 10,000 mutations per branch.

The Pi sibling lazily bundles Pi Durable 1.0.2, Chord 1.0.2 and Pi AI 1.0.2
from exact build pins, because compiled Pi does not resolve arbitrary external
SDK packages. SDK initialization still waits for opt-in. Installed Pi 1.0.2
is tested. The adapter uses JSONL storage with fsync and an OS-released
SQLite exclusive writer lease. Node 22.19+ or Bun is required. Only one Pi
process can own a directory; competing writers fail explicitly. Local private
files contain user-owned picks and receipts. Storage is never a distribution
asset. Lifecycle shutdown closes the harness; pending tasks remain resumable.

DSH mounts the original scoped watchlist root per agent, with isolation and
session-log resume. It shares snapshot/listing laws but has no equivalent
Durable scheduler; these opt-in tools and bundled SDK initialization belong to Pi.

```sh
bun run check -- watchlist
bun run test:unit -- watchlist
bun run build -- watchlist
bun run test:aggregate:pi
```
