# finance_http

Status: **Experimental** · version: `0.1.0` · target: JavaScript/Bun

`finance_http` is an asynchronous, provider-safe transport layer for finance
adapters. It centralizes retry, pacing, bounded concurrency, cache hooks,
redaction, cancellation, response limits, and deterministic cassette replay.
It does not understand quotes, filings, calendars, or any particular provider.

The implemented base keeps policy pure and effects narrow. It includes safe
HTTPS request construction, public/secret headers and query parameters, body
variants, explicit idempotency, finite response/time limits, a persistent
bounded FIFO queue, and response values that redact sensitive headers and expose
a body-free diagnostic summary. Retry classification, capped backoff,
`Retry-After`, immutable rate-limit/cache decisions, strict cassette replay,
and the event/effect workflow reducer are deterministic transformations.

The Bun interpreter is the deliberate effect boundary. It performs encoded URL
construction, timeout and caller cancellation, redirect refusal, bounded stream
reading, strict UTF-8 decoding or original-byte base64/SHA-256 capture, and typed result conversion. Provider exception text
does not cross that boundary. Direct Bun contracts cover outgoing request
shape, limits, cancellation, timeout, and non-leaking failures. Policy
composition now executes through injected transport, clock, sleeper, and status
acceptor capabilities. It retries only eligible methods/failures, parses both
standard `Retry-After` forms without reading a global clock, and keeps response
bodies out of errors. A pure scheduler enforces global and per-origin
concurrency, bounded waiting, duplicate IDs, fair first-eligible admission, and
two-phase active cancellation. An explicit asynchronous `Pool` now owns that
state and launches admitted client calls without moving scheduling policy into
the effect layer. A named process-local `Limiter` coordinates one provider
quota across independently loaded Pi and DSH shells; injected runtimes retain
isolated state for deterministic tests. A separate binary client/pool reuses the same retry and
scheduler laws without weakening the UTF-8 response contract. Cache interfaces,
cassette recorder persistence, and jitter remain post-foundation extensions.
Cassette bodies are currently required to be pre-redacted by the caller.

## Reuse audit

This package deliberately uses the host's global standards-based `fetch`; it
does not ship Undici, Axios, or another connection pool. Pi configures its
global fetch with an Undici dispatcher that supplies environment proxy support,
connection reuse, and header/body idle timeouts. Pi also tells extensions to
pass the callback `AbortSignal` to nested fetch work. A plugin adapts that
host-owned signal without giving this library ownership of Pi's controller:

```gleam
import finance_http/transport
import pi/raw

let cancellation =
  signal
  |> raw.dynamic
  |> transport.from_abort_signal
```

Calling `transport.cancel` on an adapted host token is a no-op; cancellation
flows from Pi. Standalone callers use `new_cancellation` and may cancel that
library-owned token. An absent Pi signal becomes an independent non-cancelled
token. The adapter therefore works in both active tool calls and idle extension
contexts.

The reuse decision was checked against:

- [Pi's HTTP dispatcher](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/http-dispatcher.ts), which is host bootstrap infrastructure rather than a public extension client;
- [Pi's extension cancellation guidance](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#ctxsignal);
- the official [Gleam Fetch](https://hexdocs.pm/gleam_fetch/gleam/fetch.html) package, which provides good generic Gleam HTTP types, fetch calls, and chunk reads but does not currently expose the combined host-signal/timeout and reader-cancellation contract required by the hard body limit;
- [Bun's Fetch implementation](https://bun.sh/docs/runtime/networking/fetch), whose standard `AbortSignal` and `ReadableStream` behavior is used by the boundary tests; and
- the ecosystem [Pi fetch extension](https://github.com/rytswd/pi-agent-extensions/tree/main/fetch), a useful general LLM web/API tool with HTML extraction and file downloads, but not a provider transport with credential-safe keys, deterministic retry policy, provenance, or streaming hard limits.

Pi's LLM-provider retry helpers are also intentionally not imported. They
operate on assistant-message failures and use host/provider policy; finance
requests need method/idempotency classification, provider rate-limit state,
explicit stale-cache results, and deterministic injected jitter. Importing Pi
internals would couple this standalone Hex library to one Pi release while
still leaving those rules unimplemented.

The remaining JavaScript FFI is consequently narrow: create/adapt cancellation,
construct one fetch request, refuse redirects, stop a response stream at the
byte limit, return a bounded structural result, store one scheduler value, and
attach/remove abort listeners. Request policy, retry, admission, fairness,
queueing, caching, cassettes, and error classification remain typed Gleam.

## User stories

- An adapter issues a request through one policy-enforced client and receives a
  typed response or typed failure.
- Tests replay the same normalized request without live network access, sleeps,
  credentials, or nondeterministic clocks.
- Rate-limit headers and retry delays are visible to callers and never hidden
  behind unbounded retries.
- Errors and cassettes are safe to inspect because authentication material was
  removed before recording.

## Non-goals

- No provider endpoint paths, JSON decoders, credentials discovery, finance
  domain conversion, entitlement negotiation, or Pi APIs.
- No global disk cache, background refresh, or cross-process rate limiter in
  0.1. The process-local limiter is explicit provider policy and never stores
  credentials or response data.
- No silent stale-cache fallback. A provider adapter may explicitly request and
  label cached data after a transport failure.
- No attempt to make a credential-free public API immune to provider terms or
  operational limits.

## Module surface

| Module | Responsibility |
| --- | --- |
| `finance_http/request` | safe method, URL, headers, body, idempotency, and normalized key types |
| `finance_http/response` | bounded bytes/text, status, safe headers, timings, and cache metadata |
| `finance_http/binary_response` | bounded base64 body, original byte length/SHA-256/prefix, status, safe headers, and timings |
| `finance_http/transport` | cancellable Bun fetch interpreter with timeout, redirect, and body limits |
| `finance_http/queue` | pure persistent bounded FIFO with first-match extraction |
| `finance_http/scheduler` | pure global/per-origin admission, completion, overflow, and cancellation transitions |
| `finance_http/pool` | explicit async owner that interprets scheduler transitions and launches clients |
| `finance_http/client` | policy composition and promise-returning request execution |
| `finance_http/binary_client` | the same retry/status laws over byte-preserving responses |
| `finance_http/binary_pool` | the same scheduler interpreter over byte-preserving responses |
| `finance_http/retry` | retry classification, backoff, jitter, attempt budget, and `Retry-After` |
| `finance_http/rate_limit` | per-origin/token-bucket state and provider header observations |
| `finance_http/limiter` | explicit process-shared provider admission state; isolated under injected effects |
| `finance_http/cache` | injected async cache interface and explicit hit/miss/stale records |
| `finance_http/cassette` | canonical request/response format, recorder, replay transport, and redaction |
| `finance_http/error` | bounded, redacted transport/policy/status/decode-adjacent errors |

## Functional design

Only the final transport, cache, and sleep operations are effectful. Request
normalization, retry classification, backoff calculation, rate-limit state,
queue selection, cache eligibility, cassette matching, redaction, and error
construction are pure functions over immutable policy/state values. The narrow
limiter interpreter stores only the latest typed rate state under a non-secret
provider scope so separately bundled shells cannot multiply quota.

The retry workflow is modeled as a reducer from `(State, Event)` to
`#(State, List(Effect))`; its current effects describe transport attempts and
sleeps. The policy client supplies a concrete interpreter through injected
`Sender`, `Sleeper`, `Clock`, and `StatusAcceptor` functions. This makes attempt
sequences, budgets, cancellation races, and stale-result rejection testable
without networking or wall-clock sleeps. Cache and observer effects will extend
the reducer rather than becoming hidden globals. No module-level client is
allowed; production adapters opt into a named process-local limiter while
tests inject isolated clocks, sleeps, transports, and limiter state.

The current low-level `finance_http/transport.send` accepts an explicit
cancellation value and returns `Promise(Result(Response, TransportError))`.
Callers create independent cancellation values with `new_cancellation`; no
global abort state exists. The interpreter returns only typed timeout,
cancellation, size, network, response-validation, or FFI-contract failures. It
never includes thrown JavaScript messages.

## Core API shape

Every real request is asynchronous:

```gleam
pub type Sender =
  fn(Request, Cancellation) -> Promise(Result(Response, TransportError))

pub fn send(
  client: Client,
  request: Request,
  cancellation: Cancellation,
) -> Promise(Result(Response, ClientError))

pub fn send(
  pool: Pool,
  id: String,
  request: Request,
  cancellation: Cancellation,
) -> Promise(Result(Response, PoolError))
```

`ClientError` is deliberately safe to inspect. It records cancellation or the
typed stop reason, attempt count, and either a transport-error variant or
`SafeSummary(status, byte_length, elapsed)`. It never retains the response body
or arbitrary JavaScript exception text. A network, retry sleep, or future
file-backed cache operation is never exposed as a synchronous `Result`.
Cancellation currently propagates through retry sleep, transport, and body
reading. The pool also removes waiting work immediately and prevents cancelled
active work from releasing its slot before the client promise settles. Cache
and cassette cancellation arrive with those interpreters.

`Client` is currently constructed with explicit sender, clock, sleeper, retry
policy, and successful-status predicate. Tests replace all of them. Concurrency
is composed by wrapping it in a `Pool`; rate-limit, cache, redactor, jitter, and
observer capabilities will be composed as their interpreters land rather than
read from process globals.

## Concurrency scheduling

`scheduler.for_request` derives a job's concurrency namespace from the
validated request origin, preventing an adapter from accidentally placing a
request in the wrong provider bucket. Submission either starts immediately or
returns a bounded queue position. Duplicate IDs, invalid limits, overflow, and
unknown completion/cancellation are typed errors.

When capacity opens, the scheduler selects the oldest eligible waiting job. It
may pass an older job whose origin is still saturated, so that origin cannot
head-of-line block unrelated providers; ordering within each eligible set is
preserved. Every transition returns a new scheduler and leaves the old value
unchanged.

Cancelling a waiting job removes it immediately. Cancelling an active job emits
`CancelledActive` but deliberately keeps the slot occupied. The effect shell
aborts its transport and calls `complete` only after termination is observed;
only then may a queued job start. This two-phase rule prevents cancellation
races from temporarily exceeding the configured limit.

`pool.new` allocates one scheduler owner; it is passed explicitly and is never
a process singleton. Each `pool.send` performs its read/reduce/write transition
synchronously before returning a promise, which makes batches of submissions
atomic with respect to the JavaScript event loop. The tiny FFI cell contains
only the latest immutable scheduler. A second FFI registry subscribes to the
already-explicit cancellation tokens and removes listeners on completion.

The pool resolves queue admission failures without launching the client,
converts client failures to `PoolError`, and contains a rejected injected
client promise as the body-free `UnexpectedClientFailure`. The default client
and transport observe cancellation. A custom injected `Sender` is likewise
required to settle after its cancellation token aborts; the pool intentionally
does not forge completion for an effect it cannot prove has stopped.

## Request normalization

A request has method, validated HTTPS origin/path, ordered multi-value headers
and query parameters, optional text body, timeout, response-byte limit, and
idempotency classification. Its current safe key includes method, origin/path,
sorted query parameters with secret values replaced, and an explicit body
variant supplied by the adapter.

Authorization, cookies, signed parameters, timestamps/nonces, and configured
secret fields must be marked `Secret`; those values are replaced before a key
or cassette is emitted. Text bodies require a non-empty `safe_variant` so raw
provider data never enters matching metadata. Selected representation-header
keys, a safe body hash, entitlement namespaces, and typed collision detection
remain client-layer work.

## Retry and rate-limit policy

- Default retryable failures are transient transport errors, `408`, `425`,
  `429`, and selected `5xx` statuses. Provider adapters may narrow the set.
- Non-idempotent requests are never retried unless the adapter supplies a
  stable idempotency key and explicitly opts in.
- `Retry-After` and supported provider reset headers override exponential
  backoff within a configured maximum delay.
- Attempts, elapsed time, total sleep, and response-body work all share finite
  budgets. Defaults never retry forever.
- Jitter is injected and deterministic in tests.
- Per-origin concurrency and rate limits are independent. Queues are bounded,
  waiting cancellation removes the job, and active cancellation retains its
  slot until interpreter acknowledgement.

When a limit is exhausted, `HttpError` reports the safe origin, attempts,
observed limit state, and next retry time when known. It does not return an old
response as if it were current.

## Cache contract

The client accepts an asynchronous cache interface. Cache records carry stored
time, expiry, validators, normalized request key, safe response metadata, and
body. Modes distinguish bypass, read-through, revalidate, offline-only, and
write-disabled operation. A stale record is returned only through an explicit
result state requested by the caller; freshness is never inferred away.

Provider adapters own TTL, redistribution, and whether an endpoint may be
cached at all. `finance_http` enforces the supplied policy but does not invent
one.

## Cassette ownership

This package exclusively owns cassette formats and replay matching. A cassette
stores schema version, normalized request, redacted response, deterministic
timing/rate-limit metadata, and optional failure. Recording is opt-in. Binary
bodies are size-limited and encoded explicitly; streaming/unbounded responses
cannot be recorded.

`finance_testkit` will provide convenient cassette builders and provider
fixtures by using these types. It must not define a second `Cassette` model.
File loading/saving is promise-returning FFI and lives here if included in 0.1.

## Errors and observability

`HttpError` distinguishes invalid request, queue full, timeout, cancelled,
transport, TLS/DNS where observable, rate limited, retry exhausted, response
too large, unacceptable status, cache, cassette mismatch, and internal FFI
contract violation. Provider response bodies are truncated and redacted before
being attached. Full thrown objects, request headers, and bodies are not
retained.

An optional observer receives structured attempt/queue/cache/rate-limit events.
It cannot mutate requests or receive secrets. The library emits no logs by
default.

## Test design

- Retry matrices by method, idempotency, status, transport error, retry header,
  budget, and cancellation point.
- Frozen-clock and injected-sleeper tests with no wall-clock delay.
- Reducer-law tests proving exhausted/cancelled workflows emit no later network
  effect and duplicate/stale completion events cannot revive a request.
- Queue fairness, per-origin isolation, bounded concurrency, overflow, and
  cancellation races.
- Cache hit/miss/revalidation/stale/offline tests proving stale state stays
  visible.
- Redaction tests for headers, queries, bodies, errors, redirects, keys, and
  cassettes.
- Cassette record/replay tests for canonical matching, mismatch diagnostics,
  schema versions, body limits, and deterministic failures.
- Bun FFI contracts for fetch errors, aborts, duplicate headers, binary bodies,
  redirects, timeouts, and response limits.

No unit or contract test calls a public provider.

## Distribution and compatibility

The Hex package includes Gleam and small reviewed JavaScript FFI sources. It
contains no credentials or recorded provider data. Runtime behavior is tested
on Bun; another JavaScript runtime is unsupported until it passes the same FFI
matrix. Cassette schema and normalized-key changes are versioned independently
so old fixtures fail clearly rather than replay incorrectly.

## Acceptance criteria

- All I/O and waiting are represented by `Promise` and support cancellation.
- Retry, queue, body, and elapsed-time budgets are finite and test-covered.
- Recorded requests, errors, and cache keys contain no configured secrets.
- Rate-limit exhaustion cannot masquerade as a fresh successful response.
- One cassette type is shared by transport and testkit.
- Deterministic tests cover retry, pacing, cache, cassette, and failure paths.
- Formatting, warnings-as-errors build, unit tests, Bun FFI tests, and Hex
  tarball audit pass.

## Post-foundation decisions

- Whether rate-limit state needs an optional cross-process adapter later.
- Default response-size, retry-attempt, and elapsed-time limits.
