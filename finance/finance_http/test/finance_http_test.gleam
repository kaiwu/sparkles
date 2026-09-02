import finance_core/time
import finance_http
import finance_http/binary_response
import finance_http/cache
import finance_http/cassette
import finance_http/client
import finance_http/limiter
import finance_http/pool
import finance_http/queue
import finance_http/rate_limit
import finance_http/request
import finance_http/response
import finance_http/retry
import finance_http/retry_after
import finance_http/scheduler
import finance_http/transport
import finance_http/workflow
import gleam/javascript/promise
import gleam/list
import gleam/option.{type Option, None, Some}
import gleeunit
import gleeunit/should

pub fn main() -> Nil {
  gleeunit.main()
}

pub fn package_is_experimental_test() {
  finance_http.status()
  |> should.equal(finance_http.Experimental)
}

pub fn pool_validates_limits_before_allocating_effect_state_test() {
  let client =
    client.new(
      retry_policy(),
      fn(_, _) { promise.resolve(Error(transport.NetworkFailure)) },
      fn(_, _) { promise.resolve(True) },
      fn() { instant(0) },
    )

  pool.new(
    client,
    maximum_in_flight: 0,
    maximum_per_origin: 1,
    maximum_waiting: 1,
  )
  |> should.equal(Error(scheduler.NonPositiveGlobalLimit))
}

pub fn request_rejects_credential_bearing_origin_test() {
  request.new(
    method: request.Get,
    origin: "https://token@example.test",
    path: "/quotes",
    idempotency_key: None,
  )
  |> should.equal(Error(request.InvalidOrigin))
  request.new(
    method: request.Get,
    origin: "https://example.test",
    path: "/quotes?api_key=secret",
    idempotency_key: None,
  )
  |> should.equal(Error(request.InvalidPath))
  request.new(
    method: request.Get,
    origin: "https://example.test/path",
    path: "/quotes",
    idempotency_key: None,
  )
  |> should.equal(Error(request.InvalidOrigin))
}

pub fn request_rejects_paths_that_can_escape_the_validated_origin_test() {
  [
    "//attacker.example.test/quotes",
    "/\\attacker.example.test/quotes",
    "/quotes\r\nx-injected: true",
    "/quotes\u{0}suffix",
  ]
  |> list.each(fn(path) {
    request.new(
      method: request.Get,
      origin: "https://data.example.test",
      path: path,
      idempotency_key: None,
    )
    |> should.equal(Error(request.InvalidPath))
  })
}

pub fn request_limits_require_a_positive_timeout_and_response_budget_test() {
  let assert Ok(value) =
    request.new(
      method: request.Get,
      origin: "https://data.example.test",
      path: "/quotes",
      idempotency_key: None,
    )
  let assert Ok(zero) = time.duration(0)

  request.with_limits(value, zero, 100)
  |> should.equal(Error(request.NonPositiveTimeout))
  request.with_limits(value, duration(1), 0)
  |> should.equal(Error(request.NonPositiveResponseLimit))
}

pub fn request_keys_redact_secrets_and_distinguish_body_variants_test() {
  let assert Ok(base) =
    request.new(
      method: request.Post,
      origin: "https://data.example.test",
      path: "/query",
      idempotency_key: None,
    )
  let assert Ok(with_secret) =
    request.with_query(
      base,
      name: "api_key",
      value: "very-secret",
      sensitivity: request.Secret,
    )
  let assert Ok(with_body) =
    request.with_text_body(
      with_secret,
      content_type: "application/json",
      value: "{\"symbol\":\"GLEAM\"}",
      safe_variant: "symbol-query-v1",
    )

  request.safe_key(with_body)
  |> should.equal(
    "POST https://data.example.test/query?api_key=[REDACTED] variant=symbol-query-v1",
  )
}

pub fn request_safe_keys_escape_public_query_delimiters_without_collisions_test() {
  let assert Ok(base) =
    request.new(
      method: request.Get,
      origin: "https://data.example.test",
      path: "/quotes",
      idempotency_key: None,
    )
  let assert Ok(single) = request.with_query(base, "x", "a&y=b", request.Public)
  let assert Ok(first) = request.with_query(base, "x", "a", request.Public)
  let assert Ok(split) = request.with_query(first, "y", "b", request.Public)

  request.safe_key(single)
  |> should.equal("GET https://data.example.test/quotes?x=a%26y%3Db")
  request.safe_key(single)
  |> should.not_equal(request.safe_key(split))
  request.with_query(base, "symbol", "AAPL\r\ninjected", request.Public)
  |> should.equal(Error(request.InvalidQueryValue))
}

pub fn response_redacts_sensitive_headers_from_its_typed_boundary_test() {
  let assert Ok(value) =
    response.new(
      status: 200,
      headers: [
        response.Header("Content-Type", "application/json"),
        response.Header("Set-Cookie", "session=secret"),
      ],
      body: "private provider body",
      byte_length: 21,
      elapsed: duration(12),
    )

  response.headers(value)
  |> should.equal([
    response.Header("content-type", "application/json"),
    response.Header("set-cookie", "[REDACTED]"),
  ])
  response.safe_summary(value)
  |> should.equal(response.SafeSummary(200, 21, duration(12)))
}

pub fn response_rejects_declared_utf8_byte_length_drift_test() {
  response.new(
    status: 200,
    headers: [],
    body: "贵州",
    byte_length: 2,
    elapsed: duration(1),
  )
  |> should.equal(Error(response.ByteLengthMismatch(2, 6)))
}

pub fn binary_response_validates_integrity_metadata_and_redacts_headers_test() {
  let assert Ok(value) =
    binary_response.new(
      status: 200,
      headers: [
        response.Header("Content-Type", "application/pdf"),
        response.Header("Set-Cookie", "session=secret"),
      ],
      body_base64: "JVBERi0=",
      byte_length: 5,
      content_sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      prefix_hex: "255044462d",
      elapsed: duration(12),
    )

  binary_response.headers(value)
  |> should.equal([
    response.Header("content-type", "application/pdf"),
    response.Header("set-cookie", "[REDACTED]"),
  ])
  binary_response.safe_summary(value)
  |> should.equal(response.SafeSummary(200, 5, duration(12)))
}

pub fn binary_response_rejects_malformed_base64_hash_and_prefix_test() {
  binary_response.new(
    200,
    [],
    "not base64",
    5,
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "255044462d",
    duration(1),
  )
  |> should.equal(Error(binary_response.InvalidBase64))

  binary_response.new(
    200,
    [],
    "JVBERi0=",
    5,
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "255044462d",
    duration(1),
  )
  |> should.equal(Error(binary_response.InvalidSha256))

  binary_response.new(
    200,
    [],
    "JVBERi0=",
    5,
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "25504446",
    duration(1),
  )
  |> should.equal(Error(binary_response.InvalidPrefixHex))
}

pub fn retry_after_parsing_is_pure_bounded_and_clock_explicit_test() {
  let now = instant(1_445_412_480_000)

  retry_after.parse("120", now)
  |> should.equal(Some(duration(120_000)))
  retry_after.parse("Wed, 21 Oct 2015 07:30:00 GMT", now)
  |> should.equal(Some(duration(120_000)))
  retry_after.parse("Wed, 21 Oct 2015 07:27:00 GMT", now)
  |> should.equal(Some(duration(0)))
  retry_after.parse("Thu, 21 Oct 2015 07:30:00 GMT", now)
  |> should.equal(None)
  retry_after.parse("-1", now)
  |> should.equal(None)
}

pub fn bounded_queue_is_persistent_fifo_test() {
  let assert Ok(empty) = queue.new(capacity: 2)
  let assert Ok(one) = queue.enqueue(empty, "first")
  let assert Ok(two) = queue.enqueue(one, "second")
  let #(after_first, first) = queue.dequeue(two)
  let #(after_second, second) = queue.dequeue(after_first)

  first |> should.equal(Some("first"))
  second |> should.equal(Some("second"))
  queue.size(empty) |> should.equal(0)
  queue.size(two) |> should.equal(2)
  queue.is_empty(after_second) |> should.be_true
  queue.enqueue(two, "third") |> should.equal(Error(queue.Full))
}

pub fn queue_can_take_first_match_without_reordering_or_mutating_test() {
  let assert Ok(empty) = queue.new(capacity: 4)
  let assert Ok(one) = queue.enqueue(empty, 1)
  let assert Ok(two) = queue.enqueue(one, 2)
  let assert Ok(three) = queue.enqueue(two, 3)
  let assert Ok(four) = queue.enqueue(three, 4)
  let #(without_even, taken) =
    queue.take_first(four, fn(value) { value % 2 == 0 })

  taken |> should.equal(Some(2))
  queue.to_list(without_even) |> should.equal([1, 3, 4])
  queue.to_list(four) |> should.equal([1, 2, 3, 4])
}

pub fn queue_reuses_capacity_across_interleaved_operations_test() {
  let assert Ok(empty) = queue.new(capacity: 3)
  let assert Ok(one) = queue.enqueue(empty, "first")
  let assert Ok(two) = queue.enqueue(one, "second")
  let #(after_first, first) = queue.dequeue(two)
  let assert Ok(with_third) = queue.enqueue(after_first, "third")
  let assert Ok(full) = queue.enqueue(with_third, "fourth")
  let #(without_third, third) =
    queue.take_first(full, fn(value) { value == "third" })

  first |> should.equal(Some("first"))
  third |> should.equal(Some("third"))
  queue.size(full) |> should.equal(3)
  queue.size(without_third) |> should.equal(2)
  queue.to_list(full) |> should.equal(["second", "third", "fourth"])
  queue.to_list(without_third) |> should.equal(["second", "fourth"])
}

pub fn scheduler_bypasses_a_blocked_origin_without_losing_fifo_fairness_test() {
  let assert Ok(empty) =
    scheduler.new(
      maximum_in_flight: 2,
      maximum_per_origin: 1,
      maximum_waiting: 4,
    )
  let a1 = scheduled_job("a-1", "provider-a", "A1")
  let a2 = scheduled_job("a-2", "provider-a", "A2")
  let b1 = scheduled_job("b-1", "provider-b", "B1")
  let c1 = scheduled_job("c-1", "provider-c", "C1")
  let assert Ok(#(with_a1, scheduler.Started(_))) = scheduler.submit(empty, a1)
  let assert Ok(#(with_a2, scheduler.Queued(1))) = scheduler.submit(with_a1, a2)
  let assert Ok(#(with_b1, scheduler.Started(_))) =
    scheduler.submit(with_a2, b1)
  let assert Ok(#(full, scheduler.Queued(2))) = scheduler.submit(with_b1, c1)
  let assert Ok(#(after_b, [started_c])) = scheduler.complete(full, id: "b-1")
  let assert Ok(#(after_a, [started_a2])) =
    scheduler.complete(after_b, id: "a-1")

  started_c |> should.equal(c1)
  scheduler.waiting(after_b) |> should.equal([a2])
  started_a2 |> should.equal(a2)
  scheduler.active(after_a) |> should.equal([c1, a2])
  scheduler.in_flight(empty) |> should.equal(0)
  scheduler.in_flight(full) |> should.equal(2)
}

pub fn scheduler_queue_overflow_and_duplicate_ids_are_typed_test() {
  let assert Ok(empty) =
    scheduler.new(
      maximum_in_flight: 1,
      maximum_per_origin: 1,
      maximum_waiting: 1,
    )
  let active = scheduled_job("one", "provider-a", Nil)
  let waiting = scheduled_job("two", "provider-a", Nil)
  let overflow = scheduled_job("three", "provider-b", Nil)
  let assert Ok(#(one, _)) = scheduler.submit(empty, active)
  let assert Ok(#(two, _)) = scheduler.submit(one, waiting)

  scheduler.submit(two, active)
  |> should.equal(Error(scheduler.DuplicateJobId))
  scheduler.submit(two, waiting)
  |> should.equal(Error(scheduler.DuplicateJobId))
  scheduler.submit(two, overflow)
  |> should.equal(Error(scheduler.QueueFull))
}

pub fn scheduler_jobs_can_derive_their_namespace_from_validated_requests_test() {
  let request_value = get_request()
  let assert Ok(job) =
    scheduler.for_request(id: "quote-1", request: request_value, value: Nil)

  scheduler.id(job) |> should.equal("quote-1")
  scheduler.origin(job) |> should.equal("https://data.example.test")
  scheduler.value(job) |> should.equal(Nil)
  scheduler.job(id: " bad", origin: "provider", value: Nil)
  |> should.equal(Error(scheduler.InvalidJobId))
  scheduler.new(maximum_in_flight: 0, maximum_per_origin: 1, maximum_waiting: 1)
  |> should.equal(Error(scheduler.NonPositiveGlobalLimit))
}

pub fn scheduler_cancellation_removes_waiting_or_releases_active_capacity_test() {
  let assert Ok(empty) =
    scheduler.new(
      maximum_in_flight: 1,
      maximum_per_origin: 1,
      maximum_waiting: 3,
    )
  let active = scheduled_job("active", "provider-a", "A")
  let waiting = scheduled_job("waiting", "provider-b", "B")
  let removed = scheduled_job("removed", "provider-c", "C")
  let assert Ok(#(one, _)) = scheduler.submit(empty, active)
  let assert Ok(#(two, _)) = scheduler.submit(one, waiting)
  let assert Ok(#(three, _)) = scheduler.submit(two, removed)
  let assert Ok(#(without_waiter, scheduler.CancelledWaiting(cancelled))) =
    scheduler.cancel(three, id: "removed")
  let assert Ok(#(aborting, scheduler.CancelledActive(aborted))) =
    scheduler.cancel(without_waiter, id: "active")
  let assert Ok(#(released, [started])) =
    scheduler.complete(aborting, id: "active")

  cancelled |> should.equal(removed)
  aborted |> should.equal(active)
  started |> should.equal(waiting)
  scheduler.active(released) |> should.equal([waiting])
  scheduler.waiting_count(released) |> should.equal(0)
  scheduler.active(without_waiter) |> should.equal([active])
  scheduler.active(aborting) |> should.equal([active])
  scheduler.cancel(released, id: "missing")
  |> should.equal(Error(scheduler.UnknownJob))
}

pub fn post_requires_idempotency_key_to_retry_test() {
  let post = post_request(None)

  retry.decide(
    retry_policy(),
    post,
    1,
    duration(0),
    retry.Transport(retry.Timeout),
  )
  |> should.equal(retry.Stop(retry.NonIdempotentRequest))
}

pub fn keyed_post_can_retry_test() {
  let post = post_request(Some("order-123"))

  retry.decide(
    retry_policy(),
    post,
    1,
    duration(0),
    retry.Transport(retry.ConnectionReset),
  )
  |> should.equal(retry.RetryAfter(duration(100), 2))
}

pub fn read_only_post_retries_without_inventing_an_idempotency_header_test() {
  let assert Ok(post) = request.as_repeatable_read(post_request(None))
  request.can_retry(post) |> should.be_true
  request.idempotency_key(post) |> should.equal(None)
  request.as_repeatable_read(get_request())
  |> should.equal(Error(request.RepeatableReadRequiresPost))
}

pub fn retry_after_is_respected_and_bounded_test() {
  retry.decide(
    retry_policy(),
    get_request(),
    1,
    duration(0),
    retry.Status(429, Some(duration(10_000))),
  )
  |> should.equal(retry.RetryAfter(duration(1000), 2))
}

pub fn exponential_backoff_is_pure_and_capped_test() {
  let policy = retry_policy()
  let request = get_request()

  retry.decide(
    policy,
    request,
    2,
    duration(50),
    retry.Transport(retry.NetworkUnavailable),
  )
  |> should.equal(retry.RetryAfter(duration(200), 3))
  retry.decide(
    policy,
    request,
    4,
    duration(50),
    retry.Transport(retry.NetworkUnavailable),
  )
  |> should.equal(retry.RetryAfter(duration(800), 5))
}

pub fn retry_stops_for_permanent_and_exhausted_failures_test() {
  let policy = retry_policy()
  let request = get_request()

  retry.decide(
    policy,
    request,
    1,
    duration(0),
    retry.Transport(retry.CertificateFailure),
  )
  |> should.equal(retry.Stop(retry.PermanentFailure))
  retry.decide(policy, request, 5, duration(100), retry.Status(503, None))
  |> should.equal(retry.Stop(retry.AttemptsExhausted))
}

pub fn retry_does_not_schedule_past_elapsed_budget_test() {
  retry.decide(
    retry_policy(),
    get_request(),
    1,
    duration(4950),
    retry.Transport(retry.Timeout),
  )
  |> should.equal(retry.Stop(retry.ElapsedBudgetExhausted))
}

pub fn workflow_describes_retry_effects_as_data_test() {
  let initial = workflow.new(get_request(), retry_policy(), duration(0))
  let #(waiting, start_effects) = workflow.update(initial, workflow.Start)
  let #(sleeping, retry_effects) =
    workflow.update(
      waiting,
      workflow.TransportFailed(1, retry.Transport(retry.Timeout), duration(50)),
    )
  let #(second_attempt, send_effects) =
    workflow.update(sleeping, workflow.SleepFinished(2))
  let #(succeeded, final_effects) =
    workflow.update(
      second_attempt,
      workflow.TransportSucceeded(2, 200, duration(180)),
    )

  start_effects
  |> should.equal([workflow.Send(1, get_request())])
  retry_effects
  |> should.equal([workflow.Sleep(duration(100), 2)])
  send_effects
  |> should.equal([workflow.Send(2, get_request())])
  workflow.phase(succeeded)
  |> should.equal(workflow.Succeeded(200))
  final_effects
  |> should.equal([])
}

pub fn workflow_ignores_stale_and_duplicate_completions_test() {
  let initial = workflow.new(get_request(), retry_policy(), duration(0))
  let #(waiting, _) = workflow.update(initial, workflow.Start)
  let #(unchanged, effects) =
    workflow.update(waiting, workflow.TransportSucceeded(2, 200, duration(10)))
  let #(succeeded, _) =
    workflow.update(waiting, workflow.TransportSucceeded(1, 200, duration(10)))
  let #(still_succeeded, duplicate_effects) =
    workflow.update(
      succeeded,
      workflow.TransportFailed(1, retry.Transport(retry.Timeout), duration(20)),
    )

  unchanged
  |> should.equal(waiting)
  effects
  |> should.equal([])
  still_succeeded
  |> should.equal(succeeded)
  duplicate_effects
  |> should.equal([])
}

pub fn workflow_cancellation_is_terminal_test() {
  let initial = workflow.new(get_request(), retry_policy(), duration(0))
  let #(waiting, _) = workflow.update(initial, workflow.Start)
  let #(cancelled, effects) = workflow.update(waiting, workflow.Cancel)
  let #(unchanged, late_effects) =
    workflow.update(
      cancelled,
      workflow.TransportSucceeded(1, 200, duration(10)),
    )

  workflow.phase(cancelled)
  |> should.equal(workflow.Cancelled)
  effects
  |> should.equal([])
  unchanged
  |> should.equal(cancelled)
  late_effects
  |> should.equal([])
}

pub fn rate_limit_acquisition_is_an_immutable_state_transition_test() {
  let assert Ok(state) =
    rate_limit.new(
      limit: 2,
      remaining: 1,
      reset_at: instant(1000),
      window: duration(100),
    )
  let assert Ok(#(last_token, rate_limit.Permit)) =
    rate_limit.acquire(state, instant(900))
  let assert Ok(#(waiting, rate_limit.WaitUntil(reset))) =
    rate_limit.acquire(last_token, instant(901))
  let assert Ok(#(refilled, rate_limit.Permit)) =
    rate_limit.acquire(waiting, instant(1000))

  rate_limit.remaining(state)
  |> should.equal(1)
  rate_limit.remaining(last_token)
  |> should.equal(0)
  reset
  |> time.unix_milliseconds
  |> should.equal(1000)
  rate_limit.remaining(refilled)
  |> should.equal(1)
  refilled
  |> rate_limit.reset_at
  |> time.unix_milliseconds
  |> should.equal(1100)
}

pub fn rate_limit_rejects_a_zero_window_that_would_bypass_pacing_test() {
  rate_limit.new(
    limit: 2,
    remaining: 2,
    reset_at: instant(1000),
    window: duration(0),
  )
  |> should.equal(Error(rate_limit.NonPositiveWindow))
}

pub fn shared_limiter_coordinates_independent_provider_runtimes_test() {
  let now = instant(1000)
  let assert Ok(state) =
    rate_limit.new(
      limit: 1,
      remaining: 1,
      reset_at: instant(3000),
      window: duration(2000),
    )
  let first = limiter.shared("test:shared-provider-limit:v1", state)
  let second = limiter.shared("test:shared-provider-limit:v1", state)
  let sleeper = fn(wait, _) {
    time.duration_milliseconds(wait) |> should.equal(2000)
    promise.resolve(False)
  }
  let clock = fn() { now }

  use admitted_first <- promise.await(limiter.admit(
    first,
    transport.new_cancellation(),
    sleeper,
    clock,
  ))
  use admitted_second <- promise.await(limiter.admit(
    second,
    transport.new_cancellation(),
    sleeper,
    clock,
  ))
  admitted_first |> should.be_ok
  admitted_second |> should.equal(Error(transport.Cancelled))
  promise.resolve(Nil)
}

pub fn isolated_limiters_do_not_share_injected_test_quota_test() {
  let assert Ok(state) = rate_limit.new(1, 1, instant(3000), duration(2000))
  let first = limiter.isolated(state)
  let second = limiter.isolated(state)
  let sleeper = fn(_, _) {
    should.fail()
    promise.resolve(False)
  }
  let clock = fn() { instant(1000) }

  use admitted_first <- promise.await(limiter.admit(
    first,
    transport.new_cancellation(),
    sleeper,
    clock,
  ))
  use admitted_second <- promise.await(limiter.admit(
    second,
    transport.new_cancellation(),
    sleeper,
    clock,
  ))
  admitted_first |> should.be_ok
  admitted_second |> should.be_ok
  promise.resolve(Nil)
}

pub fn provider_scopes_do_not_spend_each_others_quota_test() {
  let assert Ok(state) = rate_limit.new(1, 1, instant(3000), duration(2000))
  let first = limiter.shared("test:provider-a:v1", state)
  let second = limiter.shared("test:provider-b:v1", state)
  let sleeper = fn(_, _) {
    should.fail()
    promise.resolve(False)
  }
  let clock = fn() { instant(1000) }

  use admitted_first <- promise.await(limiter.admit(
    first,
    transport.new_cancellation(),
    sleeper,
    clock,
  ))
  use admitted_second <- promise.await(limiter.admit(
    second,
    transport.new_cancellation(),
    sleeper,
    clock,
  ))
  admitted_first |> should.be_ok
  admitted_second |> should.be_ok
  promise.resolve(Nil)
}

pub fn limiter_observes_cancellation_before_spending_quota_test() {
  let assert Ok(state) = rate_limit.new(1, 1, instant(3000), duration(2000))
  let admission = limiter.isolated(state)
  let cancellation = transport.new_cancellation()
  transport.cancel(cancellation)

  use outcome <- promise.await(
    limiter.admit(
      admission,
      cancellation,
      fn(_, _) {
        should.fail()
        promise.resolve(False)
      },
      fn() { instant(1000) },
    ),
  )
  outcome |> should.equal(Error(transport.Cancelled))
  promise.resolve(Nil)
}

pub fn cache_never_hides_stale_state_test() {
  let assert Ok(entry) =
    cache.entry(
      value: "cached quote",
      stored_at: instant(100),
      expires_at: instant(200),
    )

  cache.decide(cache.ReadThrough, Some(entry), instant(150))
  |> should.equal(cache.UseFresh("cached quote", duration(50)))
  cache.decide(cache.ReadThrough, Some(entry), instant(250))
  |> should.equal(cache.Fetch)
  cache.decide(cache.Revalidate, Some(entry), instant(250))
  |> should.equal(cache.RevalidateStale("cached quote", duration(150)))
  cache.decide(cache.OfflineOnly, Some(entry), instant(250))
  |> should.equal(cache.UseStaleOffline("cached quote", duration(150)))
  cache.decide(cache.OfflineOnly, None, instant(250))
  |> should.equal(cache.OfflineMiss)
}

pub fn cassette_replay_is_strict_ordered_and_immutable_test() {
  let first_request = get_request()
  let second_request = request_at("/bars")
  let original =
    cassette.new([
      cassette.interaction(
        first_request,
        cassette.Responded(cassette.Response(200, "quote")),
      ),
      cassette.interaction(
        second_request,
        cassette.Failed(retry.Transport(retry.Timeout)),
      ),
    ])
  let assert Ok(#(after_first, first_outcome)) =
    cassette.replay(original, first_request)

  first_outcome
  |> should.equal(cassette.Responded(cassette.Response(200, "quote")))
  cassette.consumed(original)
  |> should.equal(0)
  cassette.consumed(after_first)
  |> should.equal(1)
  cassette.replay(original, second_request)
  |> should.equal(
    Error(cassette.RequestMismatch(
      request.safe_key(first_request),
      request.safe_key(second_request),
    )),
  )
  cassette.replay(after_first, second_request)
  |> should.be_ok
}

fn retry_policy() -> retry.Policy {
  let assert Ok(policy) =
    retry.policy(
      maximum_attempts: 5,
      maximum_elapsed: duration(5000),
      base_delay: duration(100),
      maximum_delay: duration(1000),
    )
  policy
}

fn get_request() -> request.Request {
  request_at("/quotes")
}

fn request_at(path: String) -> request.Request {
  let assert Ok(value) =
    request.new(
      method: request.Get,
      origin: "https://data.example.test",
      path: path,
      idempotency_key: None,
    )
  value
}

fn post_request(key: Option(String)) -> request.Request {
  let assert Ok(value) =
    request.new(
      method: request.Post,
      origin: "https://data.example.test",
      path: "/query",
      idempotency_key: key,
    )
  value
}

fn duration(milliseconds: Int) -> time.Duration {
  let assert Ok(value) = time.duration(milliseconds)
  value
}

fn instant(milliseconds: Int) -> time.Instant {
  let assert Ok(value) = time.instant(milliseconds)
  value
}

fn scheduled_job(
  id: String,
  origin: String,
  value: value,
) -> scheduler.Job(value) {
  let assert Ok(job) = scheduler.job(id: id, origin: origin, value: value)
  job
}
