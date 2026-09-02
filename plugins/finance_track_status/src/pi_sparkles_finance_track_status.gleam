import finance_core/currency
import finance_core/time
import finance_provider_strategy/coverage
import finance_provider_strategy/credibility
import finance_track
import finance_track/context as track_context
import finance_track/json as track_json
import finance_track/profile
import gleam/dynamic/decode
import gleam/int
import gleam/javascript/promise.{type Promise}
import gleam/json
import gleam/list
import gleam/option.{None, Some}
import gleam/string
import pi
import pi/context
import pi/event
import pi/event_bus
import pi/raw
import pi/schema
import pi/session
import pi/tool
import pi/ui
import pi_sparkles_finance_track_status/effect/environment
import pi_sparkles_finance_track_status/effect/store
import pi_sparkles_finance_track_status/readiness
import pi_sparkles_finance_track_status/state

const state_entry_type = "pi_sparkles_finance_track_status.active_track"

const status_key = "finance-track"

pub type StatusInput {
  StatusInput
}

pub type SwitchInput {
  SwitchInput(track: finance_track.Track)
}

pub fn extension(api: pi.ExtensionApi) -> Promise(Nil) {
  pi.register_string_flag(
    api,
    "finance-track",
    "Initial active finance track: cn, hk, or us",
    "us",
  )
  let runtime = store.new(state.new(configured_track(api)))

  event.respond(api, event.before_agent_start, fn(_event, ctx) {
    let prompt = context.get_system_prompt(ctx) <> "\n\n" <> routing_prompt()
    prompt
    |> event.system_prompt
    |> Some
    |> promise.resolve
  })

  event.on_session_start(api, fn(_start, ctx) {
    restore(api, runtime, ctx)
    promise.resolve(Nil)
  })
  event.on_session_shutdown(api, fn(_shutdown, ctx) {
    case context.has_ui(ctx) {
      True -> ui.clear_status(context.ui(ctx), status_key)
      False -> Nil
    }
    promise.resolve(Nil)
  })

  pi.register_command(
    api,
    "finance-track",
    "Show or switch the active finance track: cn, hk, or us",
    fn(args, ctx) {
      case string.trim(args) {
        "" -> show_command(api, runtime, ctx)
        value ->
          case finance_track.from_name(value) {
            Ok(track) -> switch_command(api, runtime, track, ctx)
            Error(_) ->
              notify(
                ctx,
                "Unknown finance track '" <> value <> "'; use cn, hk, or us",
                ui.Error,
              )
          }
      }
      promise.resolve(Nil)
    },
  )
  register_direct_command(api, runtime, finance_track.Cn, "cn-track")
  register_direct_command(api, runtime, finance_track.Hk, "hk-track")
  register_direct_command(api, runtime, finance_track.Us, "us-track")

  tool.register(
    api,
    "finance_track_status",
    "Finance track status",
    "Read the active cn, hk, or us navigation track with effective currency/timezone defaults, source credibility, and installed feature coverage without exposing operator contact values",
    "Check the active finance track before choosing a market-specific tool",
    tool.parameters(schema.object([]), decode.success(StatusInput)),
    tool.Parallel,
    fn(_id, _input, _signal, _updates, ctx) {
      let value = current_profile(runtime)
      let receipt = current_receipt(api, value.0)
      refresh_status(ctx, value.0, receipt)
      tool.text_result(
        describe(value.0, receipt),
        details(value.0, value.1, receipt),
      )
      |> promise.resolve
    },
  )

  tool.register(
    api,
    "finance_track_switch",
    "Switch finance track",
    "Explicitly switch the active navigation track; this never relabels observations, tools, providers, or persisted market state",
    "Switch to exactly one of the cn, hk, or us finance tracks",
    tool.parameters(
      schema.object([
        schema.Required("track", schema.string_enum(["cn", "hk", "us"])),
      ]),
      switch_decoder(),
    ),
    tool.Sequential,
    fn(_id, input, _signal, _updates, ctx) {
      switch_track(api, runtime, input.track, ctx, persist: True)
      let value = current_profile(runtime)
      let receipt = current_receipt(api, value.0)
      tool.text_result(
        describe(value.0, receipt),
        details(value.0, value.1, receipt),
      )
      |> promise.resolve
    },
  )

  promise.resolve(Nil)
}

/// Shared model-facing finance-routing guidance. Host shells contribute this
/// exact text through their own prompt registry instead of copying policy.
pub fn routing_prompt() -> String {
  "Pi Sparkles finance routing: For a current finance request, the first evidence-acquisition step MUST contain only applicable installed Pi Sparkles tools. Never place web_search, browsing, or another generic source in that same step. Observe the Sparkles result before deciding whether anything else is needed; a rejected or incomplete controlled result remains unavailable unless the user explicitly requested a separate generic-web source. Treat AGENT_CONTACT as one shared operator identity across cn, hk, and us, but never reveal its value in model-visible results. Tool use gathers evidence; it does not delegate the final judgment. The user never needs to say 'use tools', 'use current data', or 'provide tool evidence'. For a request about today's overall Shanghai/Shenzhen market, including STAR 50 or index 000688, call installed cn_market_overview exactly once; it includes the reviewed SSE STAR 50 snapshot. Do not call cn_raw_vendor_history for 000688 when the request is about the current market. For a historical STAR 50 trend or technical-analysis series, call cn_raw_vendor_history first with provider eastmoney and the exact reviewed SSE 000688 benchmark identity. If that call rejects with the Sina-available error, stop: state that Eastmoney failed, state that Sina was not called, and ask whether the user explicitly wants the separately selected Sina source. Never call Sina in the same step or automatically. Only after the user explicitly accepts Sina may a new cn_raw_vendor_history call repeat the exact identity, date window, and limit with provider sina; state the data-source change explicitly. For exact listed A-share history, cn_stock_ohlcv follows the same strict two-call Eastmoney-then-prompt contract. Optionally call cn_market_calendar for official session status, but do not probe benchmark codes through stock quote/history, provider-health, or shell-time calls. Describe that result as provider-scoped market evidence and preserve its explicit completeness, intraday-ordering, fund-flow, sector, turnover-semantics, and prior-session gaps. For a current CN top-gainers or largest percentage-gainers request, call cn_market_movers once with the requested limit. Preserve its provider filter and provider order; do not present it as an authoritative whole-market rank, inferred venue identity, analysis, or recommendation. Equivalent provider-ranked movers acquisition is currently track_partial for hk and us, so never substitute the cn result across tracks. For a broad CN industry-sector or sector-rotation request, call cn_sector_series once with one explicit date window, then pass its comparisonInput and expectedInputSha256 unchanged to compare_series_returns. Do not guess or probe sector codes with cn_raw_vendor_history, and do not call both short and long windows: the acquisition supplies one receipt-bound pinned 11-sector CSI 800 handoff, while the separate calculator supplies latest-session, five-session, and full-window relative returns without network access. Describe only relative price performance; never translate it into fund flow, capital rotation, sector breadth, causal leadership, AI/theme exposure, a confirmed top, stabilization, or reversal. When a user asks whether to buy now, what happens if they buy now, when to sell, or requests an entry, exit, stop, target, or timing opinion about a security, treat that ordinary wording itself as a request for current read-only evidence. Do not answer from general knowledge alone and do not skip tools merely because the LLM owns the recommendation. Unless the user explicitly requests a general educational answer or declines current-data lookup, first resolve the exact active-track identity once if necessary, fetch a current quote and a bounded recent daily OHLCV/history series, then call the relevant installed sma, rsi, and atr tools before giving a conditional scenario-based answer. Use plan_loss or other trade-plan calculations only when their exact required entry, stop, account, risk, or trade-unit facts are available; use simulate_bar_paths only for an exact proposed order and completed bar, never as a prerequisite for an ordinary timing question. For CN price or technical-analysis requests with an exact venue and code, call the market-data tool directly and do not call symbol search or CNINFO first. Never infer a mainland listing's exact venue or code from model memory, a familiar name, or a code prefix. For a name-only instrument, use an applicable installed identity-discovery tool only when that tool covers the instrument kind and its provider, credential, and entitlement prerequisites are satisfied; prefer an applicable credential-free installed identity path. cn_stock_symbol_search is a heavily rate- and entitlement-limited optional Tushare stock_basic adapter for stock listings only. Keep it only as a fallback option: never use it as the first route or invoke it automatically. Offer or call it only after the primary identity path is unavailable and the user explicitly requests or accepts the Tushare fallback. It is never a mandatory prerequisite and does not resolve benchmark or sector indices. If no applicable configured identity path can prove the identity, keep it unresolved instead of guessing or cascading through providers. For a current broad-market benchmark name covered by cn_market_overview, use that overview result as the controlled identity and current observation. For any other name-only benchmark or sector identity, do not guess a code, misuse stock search, or probe history; use an applicable installed index-identity tool if one exists, otherwise report that controlled index discovery is unavailable. Use CNINFO tools only when the user explicitly requests announcements, disclosures, filings, or event evidence; CNINFO is never a prerequisite for quotes, OHLCV, or indicators. After a history/OHLCV tool returns rows, call installed sma, rsi, and atr tools for requested calculations instead of writing or executing a program or calculating indicators yourself. When the history result supplies seriesReceipt, pass only that receipt plus each tool's calculation and projection, omit context and observations/bars, and never copy the CSV rows into indicator calls. For a requested chart, call chart_ohlcv with only seriesReceipt, maximumBars, any chartHandoffReceipt values returned by the indicator tools as indicatorReceipts, and the small annotation fields; omit context, series, and indicators and never copy OHLCV rows or indicator points into the chart call. Omit stock-technicals instructionRef unless a real retained hash already exists; the tool derives it, so never pause to calculate that hash."
  <> " For a request to list, inspect, or analyze the current STAR 50 or 000688 constituents, call cn_index_constituents exactly once with venue sse and code 000688. When composition analysis is requested, also call cn_index_industry_composition exactly once with the same identity and use its official aggregate sector counts and weight lexemes; do not invent per-stock classifications or causal attribution. These credential-free official SSE operations are the primary path: do not ask the user to supply the member list, call Tushare, use generic web, or fan out quote or history calls merely to discover membership. Preserve publication and effective dates, provider order, request receipts, the complete member list, and explicit evidence limitations. If the user explicitly requests a sampled current-performance analysis, use the smallest clearly disclosed sample that can answer it and call one return-capable OHLCV/history acquisition per selected identity; do not call quote and then history for the same sample, and do not assign any sampled stock to an industry unless an installed source returned that exact stock-to-industry mapping. This current-index acquisition capability is cn supported only for exact sse 000688; hk and us are track_partial because no reviewed authority-bound complete-membership adapter, effective-date and correction contract, and licence and redistribution decision is installed. Never relabel, reuse, or substitute the cn result across tracks."
  <> " A seriesReceipt is valid only when that exact field is returned by the immediately observed history/OHLCV result and registered in the same active session. Never substitute acquisitionReceipt, gapAssessmentReceiptDigest, a gap receipt digest, or any other SHA-256 value. If a receipt-mode consumer reports that no active-session handoff matched, stop that enrichment and report the integration failure: do not retry the same receipt across sma, rsi, atr, or chart_ohlcv, do not copy internally acquired rows or indicator points into direct mode, and do not invoke bash or another script to manufacture instructionRef. US us_stock_ohlcv creates a seriesReceipt only when its request includes exact caller-proven XNYS or XNAS mic; without that evidence the result is track_partial for receipt consumers."
  <> " For stock-technicals projections, priorOffset is one-based: use 1 for the newest calculated value, never 0. For a raw, split_adjusted, dividend_adjusted, or total_return basis, omit label and instructionRef entirely instead of copying display labels or null fields from an acquisition result; provider_defined requires label only, and llm_projection requires both label and a real retained instructionRef."
  <> "\nFor a general analysis of rows returned by cn_market_movers, use the returned mover observations and let the LLM make only descriptive comparisons; then stop. Do not automatically fan out identity, classification, quote, history, indicator, disclosure, or fundamental calls across the result list. Compose one of those orthogonal tools only when the user explicitly requests that additional dimension or it is indispensable to the requested answer, and only when its exact identity, credential, entitlement, and input preconditions are already satisfied without inference. Do not reacquire the movers page and do not expect one top-ten-analysis tool to own every step. A failed optional enrichment is terminal for that dimension: do not retry every row, switch query modes, or cascade into alternate providers or tools. cn_industry_classification downloads and parses one complete pinned PDF for one code per call, so never fan it out across a movers list. cn_stock_symbol_search exact-code mode requires a caller-proven venue and TUSHARE_TOKEN; do not use name mode as a workaround for missing venue evidence."
  <> "\nFor any request whose purpose is controlled, official, provider-scoped, receipt-bound, or source-authoritative finance evidence, do not call generic web search in parallel with the controlled acquisition. If the controlled tool is missing, fails, rejects, or returns incomplete evidence, preserve that dimension as unavailable or unknown and report the exact limitation; do not replace it with generic web search, web snippets, browsing, model memory, or an unrequested provider. Use generic web sources only when the user explicitly requests them as a distinct source path, label them separately, and never present them as controlled evidence."
  <> "\nFor direct CN overview, movers, sector, quote, or history routes, the explicit request already supplies the navigation track. Do not call finance_track_status, finance_capabilities, provider-health tools, or shell-time tools first. For mover rows, never infer a venue, board, security kind, daily price-limit rule, currency, numeric unit, or display scale from a code prefix, provider filter, or field name; obtain the relevant identity/rules evidence or keep the fact unknown and preserve the provider lexeme. Describe them as provider-filtered CN listing-category rows, not verified A-share instruments. Treat provider amount, volume, market-cap, and float-market-cap fields as opaque raw lexemes while their unit, currency, and scale are unresolved: never convert them to thousands, millions, billions, wan, or yi, and never label a currency. Price-like last, high, low, open, change, and previous-close lexemes also have unknown currency: never append CNY, RMB, yuan, or any currency-denominated price-band wording. The last field is a provider latest lexeme with unknown market-session and latency state, not a proved official close; never say a row closed, finished, or settled at or near a level. Do not describe a percentage cluster as a price limit, limit-up event, daily ceiling, board regime, or abnormal activity without exact identity and dated rules evidence."
}

fn register_direct_command(
  api: pi.ExtensionApi,
  runtime: store.Store(state.State),
  track: finance_track.Track,
  name: String,
) -> Nil {
  pi.register_command(
    api,
    name,
    "Switch the active finance track to " <> finance_track.label(track),
    fn(_args, ctx) {
      switch_command(api, runtime, track, ctx)
      promise.resolve(Nil)
    },
  )
}

fn show_command(
  api: pi.ExtensionApi,
  runtime: store.Store(state.State),
  ctx: pi.CommandContext,
) -> Nil {
  let value = current_profile(runtime)
  let receipt = current_receipt(api, value.0)
  refresh_status(ctx, value.0, receipt)
  notify(ctx, describe(value.0, receipt), notification(value.1))
}

fn switch_command(
  api: pi.ExtensionApi,
  runtime: store.Store(state.State),
  track: finance_track.Track,
  ctx: pi.CommandContext,
) -> Nil {
  switch_track(api, runtime, track, ctx, persist: True)
  let value = current_profile(runtime)
  notify(
    ctx,
    describe(value.0, current_receipt(api, value.0)),
    notification(value.1),
  )
}

fn switch_track(
  api: pi.ExtensionApi,
  runtime: store.Store(state.State),
  track: finance_track.Track,
  ctx: pi.Context,
  persist persist: Bool,
) -> Nil {
  let #(next, transition) = state.switch(store.read(runtime), to: track)
  store.write(runtime, next)
  case transition, persist {
    state.Switched(_, _), True -> {
      pi.append_entry(
        api,
        state_entry_type,
        raw.dynamic(finance_track.name(track)),
      )
      publish(api, track)
    }
    state.Switched(_, _), False -> publish(api, track)
    state.Unchanged(_), False -> publish(api, track)
    _, _ -> Nil
  }
  let value = current_profile(runtime)
  refresh_status(ctx, value.0, current_receipt(api, value.0))
}

fn publish(api: pi.ExtensionApi, track: finance_track.Track) -> Nil {
  event_bus.emit(
    pi.events(api),
    finance_track.changed_channel,
    raw.dynamic(finance_track.name(track)),
  )
}

fn restore(
  api: pi.ExtensionApi,
  runtime: store.Store(state.State),
  ctx: pi.Context,
) -> Nil {
  case
    session.latest_custom_entry(
      session.manager(ctx),
      state_entry_type,
      decode.string,
    )
  {
    Ok(Some(entry)) ->
      case entry.data {
        Some(name) ->
          case finance_track.from_name(name) {
            Ok(track) -> switch_track(api, runtime, track, ctx, persist: False)
            Error(_) -> restore_warning(api, runtime, ctx)
          }
        _ -> restore_warning(api, runtime, ctx)
      }
    Ok(_) -> {
      let track = configured_track(api)
      switch_track(api, runtime, track, ctx, persist: False)
    }
    Error(_) -> restore_warning(api, runtime, ctx)
  }
}

fn restore_warning(
  api: pi.ExtensionApi,
  runtime: store.Store(state.State),
  ctx: pi.Context,
) -> Nil {
  let track = configured_track(api)
  switch_track(api, runtime, track, ctx, persist: False)
  notify(
    ctx,
    "Finance track state could not be restored; using configured "
      <> finance_track.name(track)
      <> " track",
    ui.Warning,
  )
}

fn current_profile(
  runtime: store.Store(state.State),
) -> #(profile.Profile, Bool) {
  let track = runtime |> store.read |> state.active_track
  case profile.defaults(track, environment.contact()) {
    Ok(value) -> #(value, True)
    Error(_) -> {
      let assert Ok(value) = profile.defaults(track, "invalid-contact")
      #(value, False)
    }
  }
}

fn configured_track(api: pi.ExtensionApi) -> finance_track.Track {
  case pi.get_flag(api, "finance-track") {
    Some(pi.StringFlag(value)) ->
      case finance_track.from_name(value) {
        Ok(track) -> track
        Error(_) -> finance_track.Us
      }
    _ -> finance_track.Us
  }
}

fn current_receipt(
  api: pi.ExtensionApi,
  value: profile.Profile,
) -> readiness.Receipt {
  readiness.inspect(profile.track(value), pi.get_active_tools(api))
}

fn refresh_status(
  ctx: pi.Context,
  value: profile.Profile,
  receipt: readiness.Receipt,
) -> Nil {
  case context.has_ui(ctx) {
    True ->
      ui.set_status(context.ui(ctx), status_key, status_line(value, receipt))
    False -> Nil
  }
}

fn status_line(value: profile.Profile, receipt: readiness.Receipt) -> String {
  string.uppercase(finance_track.name(profile.track(value)))
  <> " · "
  <> currency.code(profile.currency(value))
  <> " · "
  <> time.timezone_name(profile.timezone(value))
  <> " · src:"
  <> int.to_string(readiness.source_percentage(receipt))
  <> "% · feat:"
  <> int.to_string(readiness.feature_percentage(receipt))
  <> "%"
}

fn describe(value: profile.Profile, receipt: readiness.Receipt) -> String {
  "Active finance track: "
  <> string.uppercase(finance_track.name(profile.track(value)))
  <> " ("
  <> finance_track.label(profile.track(value))
  <> ")\neffectiveCurrency="
  <> currency.code(profile.currency(value))
  <> " effectiveTimezone="
  <> time.timezone_name(profile.timezone(value))
  <> " sourceCredibility="
  <> int.to_string(readiness.source_percentage(receipt))
  <> "% featureCoverage="
  <> int.to_string(readiness.feature_percentage(receipt))
  <> "% sourceCredibilityMeaning=evidence_maturity_not_truth_probability"
}

fn notify(ctx: pi.Context, message: String, kind: ui.Notification) -> Nil {
  case context.has_ui(ctx) {
    True -> ui.notify(context.ui(ctx), message, kind)
    False -> Nil
  }
}

fn notification(configuration_valid: Bool) -> ui.Notification {
  case configuration_valid {
    True -> ui.Info
    False -> ui.Warning
  }
}

fn details(
  value: profile.Profile,
  configuration_valid: Bool,
  receipt: readiness.Receipt,
) -> json.Json {
  let context = result_context(value)
  json.object(
    list.append(track_json.result_fields(context), [
      #("currency", json.string(currency.code(profile.currency(value)))),
      #("timezone", json.string(time.timezone_name(profile.timezone(value)))),
      #("agentContactConfigured", json.bool(configuration_valid)),
      #("statusLine", json.string(status_line(value, receipt))),
      #(
        "sourceCredibilityPercentage",
        json.int(readiness.source_percentage(receipt)),
      ),
      #(
        "featureCoveragePercentage",
        json.int(readiness.feature_percentage(receipt)),
      ),
      #(
        "sourceCredibility",
        credibility_json(readiness.source_credibility(receipt)),
      ),
      #("featureCoverage", coverage_json(readiness.feature_coverage(receipt))),
      #("configurationValid", json.bool(configuration_valid)),
      #("persistence", json.string("session_branch")),
    ]),
  )
}

fn credibility_json(value: credibility.Assessment) -> json.Json {
  json.object([
    #("meaning", json.string("evidence_maturity_not_truth_probability")),
    #(
      "calculation",
      json.string("equal_weight_mean_verified_10000_partial_5000_missing_0"),
    ),
    #("criticalRule", json.string("all_critical_criteria_must_be_verified")),
    #("sourceSet", json.string(credibility.source_set(value))),
    #("criterionCount", json.int(list.length(credibility.criteria(value)))),
    #("scoreBasisPoints", json.int(credibility.score_basis_points(value))),
    #("percentage", json.int(credibility.score_percentage(value))),
    #("minimumBasisPoints", json.int(credibility.minimum_basis_points(value))),
    #("readiness", json.string(credibility_readiness_name(value))),
    #("criticalGaps", json.array(credibility.critical_gaps(value), json.string)),
    #("criteria", json.array(credibility.criteria(value), criterion_json)),
  ])
}

fn criterion_json(value: credibility.Criterion) -> json.Json {
  json.object([
    #("id", json.string(credibility.criterion_id(value))),
    #("importance", json.string(credibility_importance_name(value))),
    #("level", json.string(credibility_level_name(value))),
    #("evidence", json.string(credibility.criterion_evidence(value))),
  ])
}

fn credibility_readiness_name(value: credibility.Assessment) -> String {
  case credibility.readiness(value) {
    credibility.OperationallyCredible -> "operationally_credible"
    credibility.LimitedCredibility -> "limited_credibility"
  }
}

fn credibility_importance_name(value: credibility.Criterion) -> String {
  case credibility.criterion_importance(value) {
    credibility.Critical -> "critical"
    credibility.Standard -> "standard"
  }
}

fn credibility_level_name(value: credibility.Criterion) -> String {
  case credibility.criterion_level(value) {
    credibility.Verified -> "verified"
    credibility.Partial -> "partial"
    credibility.Missing -> "missing"
  }
}

fn coverage_json(value: coverage.Assessment) -> json.Json {
  json.object([
    #(
      "meaning",
      json.string("installed_end_user_feature_coverage_not_data_completeness"),
    ),
    #(
      "calculation",
      json.string("set_union_covered_requirements_over_declared_requirements"),
    ),
    #("criticalRule", json.string("all_critical_requirements_must_be_covered")),
    #("family", json.string(coverage.assessment_family(value))),
    #("requirementCount", json.int(coverage.requirement_count(value))),
    #("coveredCount", json.int(coverage.covered_count(value))),
    #("scoreBasisPoints", json.int(coverage.coverage_basis_points(value))),
    #("percentage", json.int(coverage_percentage(value))),
    #(
      "minimumBasisPoints",
      json.int(coverage.assessment_minimum_basis_points(value)),
    ),
    #(
      "minimumSourceGroups",
      json.int(coverage.assessment_minimum_source_groups(value)),
    ),
    #("readiness", json.string(coverage_readiness_name(value))),
    #(
      "coveredRequirements",
      json.array(coverage.covered_requirements(value), json.string),
    ),
    #(
      "missingRequirements",
      json.array(coverage.missing_requirements(value), json.string),
    ),
    #(
      "criticalGaps",
      json.array(coverage.missing_critical_requirements(value), json.string),
    ),
    #("sourceGroups", json.array(coverage.source_groups(value), json.string)),
    #(
      "contributions",
      json.array(coverage.assessment_contributions(value), contribution_json),
    ),
  ])
}

fn contribution_json(value: coverage.Contribution) -> json.Json {
  json.object([
    #("channelId", json.string(coverage.contribution_channel_id(value))),
    #("sourceGroup", json.string(coverage.contribution_source_group(value))),
    #(
      "coveredRequirements",
      json.array(coverage.contribution_covered_requirements(value), json.string),
    ),
  ])
}

fn coverage_percentage(value: coverage.Assessment) -> Int {
  let assert Ok(percentage) =
    int.divide(coverage.coverage_basis_points(value), by: 100)
  percentage
}

fn coverage_readiness_name(value: coverage.Assessment) -> String {
  case coverage.assessment_readiness(value) {
    coverage.OperationallyReady -> "operationally_ready"
    coverage.BelowThreshold -> "below_threshold"
  }
}

fn result_context(value: profile.Profile) -> track_context.Context {
  let track = profile.track(value)
  let assert Ok(context) =
    track_context.new(
      track: track,
      market_scope: finance_track.name(track) <> "_active_track",
      venue_mic: None,
      board: None,
      timezone: Some(profile.timezone(value)),
      source_language: source_language(track),
      providers: ["pi-sparkles track status"],
      entitlement: "configuration_only",
      limitations: [
        "navigation_context_only",
        "does_not_relabel_market_data",
      ],
    )
  context
}

fn source_language(track: finance_track.Track) -> String {
  case track {
    finance_track.Cn -> "zh-CN"
    finance_track.Hk -> "zh-HK"
    finance_track.Us -> "en-US"
  }
}

fn switch_decoder() -> decode.Decoder(SwitchInput) {
  use name <- decode.field("track", decode.string)
  case finance_track.from_name(name) {
    Ok(track) -> decode.success(SwitchInput(track))
    Error(_) ->
      decode.failure(SwitchInput(finance_track.Us), "cn, hk, or us track")
  }
}
