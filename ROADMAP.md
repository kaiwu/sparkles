# Finance plugin roadmap

## Active cumulative Pi maintenance — opt-in durable personal watchlists

The 2026-10-04 batch keeps the complete T6 cumulative distribution as its
delivery and verification unit. Existing T3 watchlist/monitor contracts remain
the inventory owners; no new plugin or independent maturity milestone is added.
A contextual LLM hint offers conversational opt-in; no command-line flag is
required. After accepting, Pi users may select a private local store, save a content-bound
watchlist, and request a bounded one-off or recurring review. Pi Durable owns
task checkpoints, atomic receipts, and restart recovery. Finance validation,
identity, date, and comparison laws stay in Gleam. Scheduled acquisition reuses
the registered CN Eastmoney quote tool through the host's capability bridge;
HK/US picks remain separately labelled `track_partial` for that acquisition.
Source failures and interrupted attempts are terminal for that cycle, with no
provider fallback or automatic re-fetch. Saved picks survive fresh Pi sessions.
Scheduling runs only while Pi owns the store; reopening it resumes pending
work, with missed intervals reported and no catch-up request burst.

Acceptance must cover opt-in/default-off behavior, saved picks and revisions,
receipt handoffs, completed-source reuse, interrupted-source recovery, bounded
cycles, cancellation, isolated stores, competing writers, and the ordinary
portfolio-manager journey. DSH keeps its existing scoped session watchlists;
it has no equivalent durable scheduler and does not receive these Pi surfaces.
Dependencies, locks/notices, clean installation, and the cumulative Pi load are
part of this batch. Publishing and version selection are outside its scope.

This roadmap sketches a family of small Gleam packages that can turn Pi into a
finance research agent, initially focused on public equities. Each plugin is an
independent Gleam project, can be distributed as source through Hex, and must be
built into a Pi-loadable JavaScript artifact with Gleam and Bun.

The catalog is intentionally broad. It is a menu and dependency map, not a
promise to build every package at once.

All implementation and promotion claims are governed by
[`PRODUCT_READINESS.md`](PRODUCT_READINESS.md). A correct Experimental core is
an engineering milestone; a real product additionally needs a supported input
path and a complete professional journey.
Delivery is grouped into the six role products in
[`PRODUCT_TIERS.md`](PRODUCT_TIERS.md) and [`tiers.json`](tiers.json); no
proposal is independently selected, verified, or promoted.

Catalog entries represented only by this roadmap are **Draft**. A README-only
`plugins/<name>/` directory is **Designing**; it is not a package and root tasks
ignore it. Implemented entries have `gleam.toml`, source, tests, and the
lifecycle state recorded in their package README. The local README is the
detailed design document; this roadmap retains only the proposal, priority,
dependencies, and delivery status. The complete package/design inventory is
[`plugins/README.md`](plugins/README.md).

As of 2026-08-12, the catalog has 135 unique named `pi_*` proposals: 133 have
matching implementation packages with `gleam.toml` (98.5%), and 2 have
README-only designs. The repository has 140 plugin implementation packages in
total because seven reference, setup, or workflow slices do not map one-to-one
to an R1 proposal. Seven T6 packages are explicitly `track_partial`; their
available and missing scope is recorded in `tiers.json`. These are breadth counts, not completion counts: many
packages intentionally implement only one Experimental slice, and design-only
directories contribute zero implementation breadth.
The increase from 131 proposals is Session 33's retirement of the broad
`pi_hk_stock` umbrella and replacement by five exact HK proposals.
The operational tier state and blocker docket are recorded in
[`R2.md`](R2.md#catalog-breadth-snapshot).

## Proposal lifecycle

Use separate package-inventory and product-delivery states:

```text
Package: Draft -> Designing -> Implementing -> Experimental
Tier:    Queued -> BlockerResolution -> Building -> Verifying -> ProductUseful
```

- **Draft** means only the proposal in this file exists.
- **Designing** starts by creating `plugins/<name>/README.md`, not code.
- **Implementing** means its independent Gleam project and tests exist.
- **Experimental** means it builds, loads in Pi, and can be distributed as Hex
  source, but its API or coverage may still change. Its exact implemented
  contract must work; this state does not permit toy behavior or hidden gaps.
- **ProductUseful** applies only to a complete tier whose named professional
  journey works end to end through a supported repeatable input path, compact
  response, bounded drill-down, explicit failures and cross-plugin receipt
  handoffs. No plugin is independently promoted to this state.

Proposal maturity is implementation inventory, not the delivery ledger.
**Externally gated** and **Paused** are blocker facts. The owning tier is the
only selected/building/verifying/ProductUseful unit.

A proposal or build step marked **Course gate `CG-*` (Open)** cannot enter
**Designing** for the gated scope. When its owning tier reaches blocker
resolution, pause, tell the user which gate was reached, and ask them to obtain
the referenced finance-advisor deep dive. Do not create the package directory,
finalize formulas/policy, or start implementation by filling the gap with model
knowledge. Record the advisor's requirements and counterexamples in the
cross-referenced trading-course repository, link that deep-dive note from the
gate row here, record its
reviewed scope, and change the gate to **Resolved — YYYY-MM-DD**; then let the
package README become the detailed design. The registry's “Applies first to”
column and downstream consumption of a gated contract are binding even if a
proposal row does not repeat the marker. A resolved gate may be reopened when a
new track, timeframe, instrument class, or materially different workflow
exceeds the advisor's reviewed scope.

Each plugin README should cover:

1. user stories and explicit non-goals;
2. commands, tools, flags, events, and custom session data;
3. public Gleam modules and types;
4. provider endpoints, authentication, entitlements, licence, cache, pacing,
   retry, and outage behavior;
5. schemas, decoding rules, units, timestamps, adjustment and freshness policy;
6. permissions, secrets, trust boundary, and non-interactive behavior;
7. lifecycle behavior across reload, new/resume/fork, compaction, and shutdown;
8. pure, FFI, artifact, Pi integration, and provider-contract tests;
9. tested Pi/binding/provider versions and known limitations;
10. Hex source contents and the exact source-to-Pi build instructions.

At the user's direction on 2026-08-11, every then-unimplemented catalog row
moved into README-only Designing so the available tutor specifications would
not remain centralized only in course sessions. QA22–QA28 and tutor Sessions
40–46 then audited all 81 designs for real professional usefulness, supported
input paths, Pi architecture, operational safety and cross-plugin acceptance.
The corrected audit reports zero unresolved non-external questions in the
reviewed scope. The later tier-workflow decision retires the individual queue:
T1 swing trader is ProductUseful with Eastmoney plus a Tushare Pro adapter
proof, and `pi_stock_tape` belongs to the deliberately last T6
day-trader/execution product.

Creating a plugin directory therefore means its proposal has graduated from
this catalog. Empty placeholder directories are not useful and should not be
created ahead of implementation.

## Product direction

The first useful finance agent should answer questions such as:

- What is this security, where does it trade, and how fresh is the quote?
- What changed in the latest 10-K, 10-Q, or 8-K?
- How are revenue, margins, cash flow, leverage, and dilution changing?
- Which upcoming earnings, dividends, splits, and macro releases matter?
- How does a company compare with peers under explicit valuation assumptions?
- What risks and concentrations exist in a portfolio?
- Can this research be reproduced from cited source data?

It never performs autonomous or user-confirmed broker trading. Read-only
research, provenance, portfolio analytics, local simulation, and external
receipt review give us the highest usefulness with a much smaller failure cost.

## Trader-requirement steering audit — 2026-08-06

The ultimate product goal is to meet trader requirements. Packages, bindings,
providers, and feature counts are enabling machinery; they are not success by
themselves. An audit against the trading curriculum's four working personas
finds strong trust and research foundations, but only partial end-to-end trader
workflows.

The personas are acceptance lenses, not permanent user identities and not new
market tracks. One user may use several workflows. A workflow selection may
change defaults, information density, and review cadence, but it must never
change an observation's `cn`, `hk`, or `us` track, substitute a provider, or
reinterpret source evidence.

| Trader workflow | Required decision loop | Current roadmap coverage | Steering gap |
| --- | --- | --- | --- |
| Day trader | Establish the live session and auction/halts state; scan intraday transaction price, volume, conditions, and tape; form a bounded entry/exit plan; size risk; monitor; review externally performed execution. | Session 22 and the Experimental `pi_day_workbench` provide network-free validation/inspection of one caller-attested sequenced intraday packet, selected mechanical calculations, and explicit caller-retained workflow transitions; calendar, execution-information, and risk slices are separately available. | **Still the weakest live-data vertical.** T6 requires separately authenticated `cn`, `hk`, and `us` transaction-tape legs behind one shared workflow. OpenD supplied development baselines only; direct Futu HK REST ticker now passes, direct SH/SZ is permission-denied, and direct WebSocket subscription acknowledgement is non-conforming. No scan, durable monitor, alert, or whole-product day-trader acceptance exists. Live stock quote/bid/offer/order-book acquisition and order mutation are outside plugin scope; daily bars must not be presented as a day-trading surface. |
| Swing trader | Scan a point-in-time universe; confirm price/volume/volatility and sector regime; inspect catalysts; define entry, stop, target, size, and holding horizon; monitor and journal. | Experimental strategy, market-data, indicator, risk, execution, workbench, journal, shared-replay, exact-predicate screener, shared exact-calendar, quant-research, backtest, deterministic-chart, HK result-related board-meeting-date, US corporate-action source, explicit portfolio exposure/heat calculation, point-in-time FRED, and exact Alpaca/Benzinga US news-metadata slices now compose around explicit facts. The source adapters preserve their timing and completeness limits, and portfolio/macro/news judgment stays LLM-owned. | **Strongest current vertical; no more depth before breadth.** Session 17 ranks 1 through 20 are complete. Extend swing/provider depth only on a concrete workflow trigger. |
| Long-term investor | Resolve the security; read primary disclosures and complete statements; assess business quality, governance, valuation, dividends/actions, portfolio fit, and thesis changes; review periodically. | Session 19 and the Experimental `pi_investor_workbench` provide a caller-supplied dossier; existing profile/classification/news and Session 21 portfolio import slices add bounded facts. Sessions 24, 26, 27, 29–31, and 34–36 now specify future portfolio review, comparative valuation, quality/growth/thesis, monitoring/company intelligence, fund, and fixed-income/options contracts. | Current implementations remain narrow Experimental slices. Future rows now have README-only designs but are not selected for implementation; source/provider/licence/security work, optimization, professional judgments, live execution, and implementation remain separate. |
| Quant researcher | State a falsifiable hypothesis; bind a point-in-time universe and dataset; define features/signals; simulate costs and fills; validate out of sample; measure uncertainty; reproduce every run. | The Experimental `finance_replay` core supplies point-in-time manifests, shared receipt joins, caller-declared partitions/trials, deterministic replay, requested calculations, comparison, compact context, and reproduction JSONL. `finance_dataset`, `stock_screener`, `finance_calendar`, `quant_research`, `backtest`, `finance_charts`, and `macro_fred` expose exact dataset/vintage, point-in-time predicate, session/closure, hypothesis/ledger, requested-metric, run-comparison, replay, reproduction, deterministic-view, and bounded macro-source inputs. | Ranks 5 through 14 are complete. Historical membership remains a high-leverage missing quant source fact; edge/deployability remain LLM conclusions. |

The following decisions bind later proposals:

- The LLM owns every query and every research or trade decision. It chooses the
  tool, information request, inputs, formula, parameters, drill-down, operation
  order, interpretation, and next action. Finance libraries and plugins are
  neutral information surfaces: they return compact typed facts, evidence,
  explicitly requested calculations, provenance, workflow history, available
  operations, and exact failures or unknowns. They never decide what should be
  queried, what evidence is sufficient or correct, which alternative should be
  preferred, or whether a setup, plan, result, or trade is acceptable. Runtime
  decoding, deterministic calculation, and effect authorization only report
  what occurred or why an operation could not run; they are not market or
  workflow verdicts.
- Professional workflow fit is a release criterion, not presentation polish.
  Each workbench starts from the persona's recurring day-to-day loop, preserves
  context across interruptions, makes the routine path short, groups exceptions
  for triage, and progressively reveals evidence when the trader drills in. A
  package that exposes every concept but forces the trader to manually assemble
  the normal workflow does not meet the trader requirement.
- Workbenches should feel like one coherent professional instrument rather than
  a bag of tools: one exact working set, stable vocabulary, sensible versioned
  defaults, batch actions where safe, and a clear “what changed / what needs my
  attention / what is next” view. Natural interaction must not hide assumptions,
  cross tracks, weaken a gate, or turn a plan into an order.
- Start acceptance from a trader task and decision loop, not from an indicator
  checklist. RSI, MACD, KD9, Bollinger Bands, ATR, VWAP, support/resistance, and
  patterns are parameterized evidence transformations, never standalone buy or
  sell claims.
- A computed feature or signal retains its exact input series, track/listing
  identity, source/as-of boundary, parameters, lookback and warm-up state,
  missing-data policy, formula version, and any confirmation rule.
- Trade planning is read-only analysis. Entry, stop, target, scaling, risk
  budget, order choice, and invalidation conditions remain a proposed plan until
  a separately authorized paper or live plugin acts on an exact draft.
- Alerts, screeners, backtests, paper simulations, and journals consume the same
  versioned strategy and execution definitions. They must not each invent
  incompatible signal, fee, slippage, or fill semantics.
- Trader-facing charts are views of typed evidence, not a second analytics
  engine. Axes, units, timezone, session gaps, adjustment basis, warm-up, source
  cut-off, and omitted points remain visible; every chart has a structured-data
  fallback outside the TUI.
- Psychology support is a user-declared checklist and review loop. The system
  may record FOMO, confirmation-bias, loss-aversion, discipline, and confidence
  labels supplied by the user; it must not infer a diagnosis or silently alter
  risk limits from prose sentiment.
- Readiness is track-specific. A workflow is not supported on a track until its
  identity, calendar/rules, source rights, time resolution, and required data
  quality pass that workflow's acceptance gate.

### Historical portfolio steering — Session 17 (retired)

[Course Session 17](../trading-course/sessions/17_product_plugin_portfolio_steering_20260807.md)
is the historical implementation-priority review that produced the following
thin-shell inventory. It no longer controls selection, verification, or
promotion; [`PRODUCT_TIERS.md`](PRODUCT_TIERS.md) and [`tiers.json`](tiers.json)
supersede its queue:

1. `pi_stock_technicals` — Experimental thin shell complete 2026-08-07;
2. `pi_finance_sources` — Experimental thin shell complete 2026-08-07;
3. `pi_trade_plan` — Experimental thin shell complete 2026-08-07;
4. `pi_order_simulator` — Experimental thin shell complete 2026-08-08;
5. `pi_finance_dataset` — Experimental thin shell complete 2026-08-08.
6. `pi_stock_screener` predicate increment — Experimental complete 2026-08-08.
7. `pi_finance_calendar` — Experimental thin shell complete 2026-08-08.
8. `pi_quant_research` — Experimental thin shell complete 2026-08-08.
9. `pi_backtest` — Experimental thin shell complete 2026-08-08.
10. `pi_finance_charts` — Experimental thin shell complete 2026-08-08.
11. `pi_stock_earnings_calendar` — Experimental HK source slice complete
    2026-08-08.
12. `pi_stock_corporate_actions` — Experimental US source slice complete
    2026-08-09.
13. `pi_portfolio_risk` — Experimental light calculation slice complete
    2026-08-09.
14. `pi_macro_fred` — Experimental credentialed source slice complete
    2026-08-09.
15. `pi_investor_workbench` — Experimental minimum dossier slice complete
    2026-08-09.
16. `pi_company_profile` — Experimental US source slice complete 2026-08-09.
17. `pi_cn_stock_sector_concept` — Experimental CAPCO source slice complete
    2026-08-09.
18. `pi_finance_news` — Experimental Alpaca/Benzinga US metadata slice complete
    2026-08-09.
19. `pi_portfolio` — Experimental bounded local import/inspection slice complete
    2026-08-09.
20. `pi_day_workbench` — Experimental provider-neutral workflow information
    slice complete 2026-08-10.

The retired process advanced one plugin at a time. The following paragraphs
are evidence of work already performed, not instructions to repeat that
cadence. Rank 1 `pi_stock_technicals` completed with its detailed design,
Experimental implementation, focused/bundled verification, installed-Pi smoke,
and full repository regression. Ranks 2 through 5 completed the same historical
loop with stateless `finance_provenance`, `finance_risk`, `finance_execution`,
and canonical dataset-inspection shells. Rank 6 then completed that loop
with exact manifest binding, six caller-supplied decimal operators, explicit
matched/not-matched/unresolved facts, stable paging receipts, and no built-in
screen or rank. Rank 7 then completed the same loop with exact track/MIC
selection, ordered venue-local phases, stable published-holiday paging, bounded
next-session facts, and no scheduling or fallback. Rank 8 then completed the
same loop with exact hypothesis hashes, complete trial-ledger reconstruction,
requested core metrics, canonical run comparison, and no research verdict. Rank
9 then completed exact budgeted/cancellable replay, retained-event paging, and
canonical definition-bound reproduction export. Rank 10 completed deterministic
PNG projection with exact structured/table fallback and no analytics. Rank 11
completed a bounded HKEX Main Board/GEM result-related board-meeting-date slice
without publication-time or completeness claims. Rank 12 completed an exact
bounded Alpaca US corporate-action source slice without venue, effective-date,
adjustment, impact, or completeness claims. Rank 13 completed the Session 18
light `CG-PORTFOLIO` slice with exact supplied-fact exposure, weight, signed
heat, partiality, contribution, temporal, reconciliation, and receipt facts,
without a portfolio judgment. Rank 14 completed one exact FRED v1 point-in-time
metadata and complete bounded raw-level range with canonical observations,
response receipts, final-row semantics, and adjacent exact change, without a
market-track assignment, forecast, or interpretation. Rank 15
`pi_investor_workbench` is also complete after Session 19 resolved
`CG-FUNDAMENTAL`, validates supplied dossier, metric, valuation, and review
facts without provider orchestration or judgment. Rank 16 completed one bounded
Twelve Data US company-profile/statistics source slice with exact symbol/MIC
identity, nullable fields, raw numeric share lexemes, separate observations,
response hashes, explicit credits, and no classification or investment
judgment. Rank 17 completed one exact CAPCO 2025-H2 stock-code classification
row with content-hash-bound source evidence, distinct taxonomy/result/
publication/retrieval dates, published level limits, and no inferred MIC or
membership-validity interval. Rank 18 completed one bounded Alpaca/Benzinga US
article-metadata source slice with exact symbol association, source timestamps,
pagination, rights, and content-bound page receipts while withholding article
material and making no event, sentiment, impact, catalyst, or absence claim.
Rank 19 completed the Session 21 bounded caller-file portfolio import/
inspection slice. Rank 20 completed the Session 22 caller-attested intraday
packet, selected-calculation, and caller-retained workflow information slice
without provider authentication/acquisition, persistence, judgment, or
mutation. The post-rank-20 portfolio integration review completed on
2026-08-10: day depth remains licensed-source
blocked, swing has no new trigger, and full investor review remains gated; the
quant loop exposes one qualifying shared-receipt gap because both screening and
backtesting require historical point-in-time universe membership. The
provider-neutral part of that trigger is complete: `project_universe` in
`pi_stock_screener` verifies exact canonical `finance_replay` manifests and
projects effective-date/knowledge-cutoff membership independently for `cn`,
`hk`, or `us`, preserving re-entry, ended, late, unknown, conflicting, and
overlapping facts. Track-separated source/rights arbitration selected HKEX's
licensed XHKG Securities Attribute Daily Files only as a conditional future
provider adapter. Its unresolved counter identity, correction/completeness,
subscriber/order, fixture, and output rights are parked external work, not an
implementation blocker. The inquiry remains drafted and unsent.

The provider-neutral `pi_stock_quote`, `pi_stock_history`,
`pi_stock_market_snapshot`, `pi_finance_data_quality`,
`pi_stock_market_calendar`, and `pi_stock_order_book` slices are now
implemented. They cover one exact
`cn`, `hk`, or `us` scope and retain raw lexemes, evidence IDs,
entitlement/licence declarations, redacted sources, unavailable/conflicting
states, and explicit unknowns. The data-quality slice adds only explicit-
coordinate omissions, same-source duplicates, caller-policy freshness, exact
unit/adjustment compatibility, and fully comparable exact provider agreement/
disagreement. The stock-market-calendar slice adds only typed reported
schedule/status comparison and supplied half-open phase-interval containment.
The top-of-book slice adds only explicit side states, venue aggregation,
sequence/gap/reset facts, and displayed-liquidity limitations. All focused and
repository gates passed for those historical slices. There is now no next
breadth item. T1 swing trader is ProductUseful; `pi_stock_tape` is T6 inventory and
begins only as part of the complete day-trader/execution product. Authentic
real-time market-data access is the only current external tier blocker; other
provider adapters and operational controls are implementation requirements. Provider
selection/acquisition, inferred venue or halt state, trust or correctness
verdicts, repair, depth reconstruction, hidden-liquidity or executable-price
claims, cross-track fallback, inferred fund flows, forecasts, ranking policy,
and trading decisions remain separate.

Depth resumes only for a named professional-task information gap, inefficient
LLM context, a missing shared receipt needed by two consumers, a risky effect
boundary, a lossy provider representation, or a track fact required by a
selected workflow. Exhaustive variants, universal provider coverage, repeated
acceptance, general requests for more tests, and plugin correctness verdicts do
not qualify.

### Course-demand gates

The canonical local course TOC is
[`../trading-course/ROADMAP.md`](../trading-course/ROADMAP.md). These references
name the curriculum topic to deepen; they do not copy its illustrative rules
into production policy. `CG-SWING` is resolved for the bounded completed-daily-
bar workflow, `CG-MARKET-DATA` for the information-only daily-market-data
contract, `CG-TECH` for calculation-only technical facts, `CG-RISK` for
calculation-only risk facts, and the execution-information slice of `CG-DAY`
for desired instructions, capabilities, explicit simulations,
lifecycle/fills, and requested calculations. `CG-QUANT` is resolved for the
provider-neutral completed-daily shared-replay, event-study, and factor-research
information contracts. Session 22 resolves the provider-neutral full intraday
workflow information contract. Session 24 resolves full portfolio review;
Session 25 is historical input for broker lifecycle evidence. The 2026-08-12
repository amendment limits plugins to read-only observation/import, local
simulation, non-executable handoff, reconciliation, and compliance facts.
Licensed acquisition, provider agreements, entitlement, private-data security,
and jurisdiction-specific policy remain separate inputs.

| Gate | Trading-course TOC cross-reference | Finance-advisor deep dive required before design | Applies first to |
| --- | --- | --- | --- |
| `CG-MARKET-DATA` **(Resolved — 2026-08-07)** | Phase 1, Week 1 “Market Literacy” and Week 2 “Data & Tools” | Define the minimum trustworthy quote/bar/depth fields for each persona; source-time, session, auction, spread, volume and market-depth interpretation; trader-facing data-quality failures; and safe CSV/JSON/XLSX/SQL import expectations. | `pi_finance_dataset`, charts, snapshots, screeners, and later intraday surfaces |
| `CG-RISK` **(Resolved — 2026-08-07)** | Phase 1, Week 3 “Risk Management Foundation” and Phase 5, Week 19 “Advanced Risk Management” | Replace slogans such as “2% rule” and “2:1” with configurable laws: account and portfolio heat, gap/leverage/correlation/liquidity risk, stop distance, lot rounding, scaling, drawdown limits, stress cases, zero-size outcomes, and every constraint the LLM must see when deciding on a proposed plan. | `finance_strategy`, `pi_trade_plan`, `pi_portfolio_risk` |
| `CG-PSYCHOLOGY` **(Journal-information slice Resolved — 2026-08-07)** | Phase 1, Week 4 “Market Psychology” and Phase 5, Week 20 “Trading Psychology Mastery” | Specify user-declared bias/emotion/checklist vocabulary, pre-trade and post-trade review, immutable attribution, requested comparisons/metrics, portable storage, and boundaries against inferred diagnosis, plugin-owned process judgment, or automatic risk changes. | `finance_journal`, `pi_trade_journal`, and every persona review loop |
| `CG-TECH` **(Resolved — 2026-08-07)** | Phase 2, Weeks 5–8 “Technical Analysis” | Provide exact formulas, seeds, parameters, warm-up, missing-session and corporate-action treatment for SMA/EMA, RSI, MACD, KD9, Bollinger, ATR and VWAP; operational definitions and counterexamples for support/resistance, trend, breakout, gaps, divergence, volume confirmation, patterns and multi-timeframe use. | `finance_indicators`, `pi_stock_technicals`, screeners, charts and alerts |
| `CG-FUNDAMENTAL` **(Minimum dossier information slice Resolved — 2026-08-09)** | Phase 3, Weeks 9–12 “Fundamental Analysis” | Session 19 defines the 16-section evidence-state dossier, identity and statement laws, mechanical insufficiency and metric facts, assumption-explicit valuation rows, review history, and the boundary against plugin-owned investment judgment. Provider orchestration, governance/industry extraction, peer selection, monitoring, portfolio composition, and deeper valuation remain incremental. | `pi_investor_workbench`; later governance/industry, quality/growth/valuation, fundamentals, and profile sources |
| `CG-SWING` **(Resolved — 2026-08-06)** | Phase 4, Week 13 “Swing Trading System” and Week 16 “Strategy Integration” | Walk one complete weekly-to-daily workflow: universe, sector/regime/catalyst context, setup and confirmation, entry/stop/target/expiry, sizing/scaling, monitoring, exits, invalidation and journal review; distinguish required evidence from preferences. | `finance_strategy` completed-daily-bar slice, `pi_swing_workbench`, the next sprint |
| `CG-DAY` **(Execution-information slice Resolved — 2026-08-07; provider-neutral full workflow Resolved — 2026-08-09)** | Phase 4, Week 14 “Day Trading System” and Phase 5, Week 17 “Order Types & Execution” | Sessions 14 and 22 define desired-instruction/execution evidence plus the network-free intraday packet, session/phase, entitlement/licence, sequence/freshness/gap, explicit calculation, workflow-state, fail-closed, and forbidden-conclusion laws. Licensed CN acquisition, durable monitoring, alerts, external handoff and receipt review remain later triggers. | `finance_execution`, `pi_order_simulator`, `pi_day_workbench`; later licensed CN provider and read-only receipt adapters |
| `CG-QUANT` **(Shared replay Resolved — 2026-08-07; event/factor slices Resolved — 2026-08-11)** | Phase 4, Week 15 “Quantitative Approaches” | Session 16 defines the shared research/replay protocol; Session 28 adds explicit event-study and factor-definition calculations, point-in-time inputs, uncertainty facts, trial receipts, and forbidden edge/deployability conclusions. | `finance_replay`, `pi_quant_research`, `pi_backtest`, `pi_stock_event_study`, `pi_stock_factor_lab` |
| `CG-PORTFOLIO` **(Resolved — full review 2026-08-11)** | Phase 5, Week 18 “Portfolio Management” and Week 19 “Advanced Risk Management” | Sessions 18 and 21 define light calculations and bounded raw import; Session 24 adds the multi-account/multi-currency fact model, requested return/attribution and scenario calculations, mechanical rebalance proposals, durable review receipts, and tax-lot information. Optimization, automated harvesting, jurisdictional tax policy, broker execution, and professional judgments remain outside scope. | `pi_portfolio`, `pi_portfolio_risk`, `pi_portfolio_scenarios`, `pi_portfolio_attribution`, `pi_portfolio_rebalance`, `pi_tax_lots` |
| `CG-LIVE` **(Non-executing amendment controls — 2026-08-12)** | Phase 6, Weeks 21–24+ “Live Trading” | Plugins may preserve read-only broker facts, run deterministic local simulations, export non-executable handoffs, and reconcile imported/read-only lifecycle evidence. They never receive write-capable authority or place, route, cancel, replace, modify, or approve an order. | read-only broker, simulation/receipt-review, handoff, and `pi_trade_compliance` proposals |

#### Supplementary tutor specification harvest — 2026-08-11

Session 23 audited the remaining proposal table. QA06–QA21 then produced
Sessions 24–39, supplying the missing professional and instrument-family
contracts before implementation selection. The complete proposal-to-session
mapping is the binding [R1 tutor specification registry](R1.md#tutor-specification-registry--2026-08-11).

| Evidence | Contract status |
| --- | --- |
| [Session 24](../trading-course/sessions/24_cg_portfolio_full_review_contract_20260811.md) | `CG-PORTFOLIO` full review Resolved |
| [Session 25](../trading-course/sessions/25_cg_live_broker_effect_contract_20260811.md) | `CG-LIVE` information/interaction contract Resolved; external stops preserved |
| [Sessions 26–27](../trading-course/sessions/26_peer_valuation_industry_research_contract_20260811.md) | Comparative valuation/industry and quality/growth/thesis depth Resolved |
| [Session 28](../trading-course/sessions/28_quant_event_study_factor_contract_20260811.md) | `CG-QUANT` event-study and factor-research slices Resolved |
| [Session 29](../trading-course/sessions/29_monitoring_catalyst_alert_contract_20260811.md) | Durable monitoring/catalyst/alert contract Resolved |
| [Sessions 30–31](../trading-course/sessions/30_filing_earnings_company_intelligence_contract_20260811.md) | Company-intelligence and transparent text/claim contracts Resolved |
| [Sessions 32–39](../trading-course/sessions/32_cn_ipo_information_contract_20260811.md) | CN IPO, HK proposal disposition, funds, rates/fixed income/convertibles, options, commodities/COT, crypto, and macro/FX/global contracts Resolved for their stated first slices |

These sessions are requirements evidence, not provider evidence. They do not
select implementation priority, create packages, grant data rights, verify
authority/completeness, pass a security review, or authorize external effects.

#### CG-MARKET-DATA resolution — 2026-08-07

- **Evidence:** trading-course
  [Session 11 and its information-only amendments](../trading-course/sessions/11_cg_market_data_20260807.md).
- **Reviewed scope:** regular-session daily OHLCV facts for long-only cash
  equities on the `cn`, `hk`, and `us` tracks: identity, calendar/status,
  acquisition, timing, adjustment, units, source-rights statements, quality,
  conflicts, imports, compact summaries, drill-down, and stable evidence
  references.
- **Controlling boundary:** plugins preserve and efficiently expose observations,
  provenance, unknowns, conflicts, omissions, mechanical checks, available
  operations, and explicitly requested calculations. They do not judge
  correctness, trustworthiness, sufficiency, usability, freshness, readiness,
  setup quality, provider preference, the next action, or a trade. The LLM owns
  every such decision.
- **Accepted mechanics:** every required slot may be known, unknown, not
  obtained, conflicting, or a decode failure without discarding other safe
  evidence; parse failures remain distinct from mechanical predicates;
  classifications include their component facts and versioned rules; no
  imputation occurs unless explicitly requested by the LLM and returned as a
  separate calculated artifact; rights predicates retain sourced, declared,
  host-policy, or unknown authority.
- **Implementation freedom:** package/type placement is non-blocking. Incremental
  shared and track-owned information contracts may proceed without claiming
  complete provider or track coverage. The resolved `CG-TECH` contract owns
  indicator calculations; the resolved `CG-RISK` contract owns risk
  calculations; `CG-DAY` and the other adjacent gates still own their
  respective facts. The LLM owns all professional decisions.
- **Initial implementation:** [`finance_ohlcv`](finance/finance_ohlcv/README.md)
  now exposes generic fact states, raw reported-row mechanics, quantity, rights,
  timing comparisons, bounded acquisition-attempt evidence, a typed packet, and
  neutral available operations alongside its existing validated `Bar`/`Batch`
  projection. Fourteen focused offline tests and the full repository suite pass.

#### CG-TECH resolution — 2026-08-07

- **Evidence:** trading-course
  [Session 12 and its design-closing amendments](../trading-course/sessions/12_cg_tech_indicator_calculations_20260807.md).
- **Reviewed scope:** versioned daily-bar calculations and relations, exact
  input projections, seeds, window/gap/rounding/parseable-value policies,
  warm-up omissions, adjustment and unit facts, intermediate values, source
  corrections, batch/incremental semantic equivalence, compact requested
  projections, drill-down operations, and content-bound receipts.
- **Controlling boundary:** indicator libraries and plugins calculate only what
  the LLM requests and expose inputs, parameters, alternatives, outputs,
  provenance, unknowns, conflicts, omissions, and available operations. They
  never select an indicator or parameter, interpret a value, judge correctness
  or sufficiency, label readiness/setup/signal/candidate state, rank/recommend,
  choose a next action, or decide a trade.
- **Accepted mechanics:** no implicit price basis, imputation, seed, regional
  convention, gap recovery, rounding, failed-check policy, conflict branch, or
  summary calculation; unavailable dates remain unperformed expressions rather
  than whole-request rejection; raw unknown-unit arithmetic may be returned
  with that unit fact when explicitly requested; semantic-result hashing is
  non-self-referential and separate from optional execution traces.
- **Initial implementation:**
  [`finance_indicators`](finance/finance_indicators/README.md) implements
  `slot_window_v1` SMA, Wilder RSI, true range, and Wilder ATR with canonical
  request and semantic-result receipts. Eighteen deterministic offline tests
  and the full `bun run test` repository suite pass. EMA/MACD, Bollinger, KD,
  volume relations, other variants, execution traces, and technical primitives
  remain incremental without reopening the resolved LLM-only boundary.

#### CG-RISK resolution — 2026-08-07

- **Evidence:** trading-course
  [Session 13](../trading-course/sessions/13_cg_risk_calculation_contract_20260807.md),
  which supersedes Sessions 02, 05, and 10/10A/10B wherever they assigned a
  risk policy, scenario, quantity, sufficiency judgment, or next action to a
  plugin.
- **Reviewed scope:** long-only cash equities on completed-daily planning for
  separately labelled `cn`, `hk`, and `us` legs: exact account/position/plan
  facts, explicitly selected budgets and scenarios, per-constraint quantity
  bounds, supplied trade-unit grids, requested intersections, gap loss, costs,
  portfolio heat, FX seams, unknown/conflicting branches, compact operations,
  and content-bound receipts.
- **Controlling boundary:** risk libraries and plugins expose supported
  calculations and preserve their exact inputs, intermediate values, outputs,
  provenance, unknowns, conflicts, omissions, alternatives, and available
  operations. They never choose a policy, threshold, scenario, quantity,
  sufficiency/correctness judgment, plan status, authorization, recommendation,
  or next operation; the LLM owns every such decision.
- **Accepted mechanics:** negative/zero loss and remaining-budget values are
  returned without a verdict; every requested bound remains independent;
  intersection occurs only for an explicit bound list; unknown grid, FX, cost,
  or scenario operands leave other calculations available; market-rule,
  account, scenario, and cost facts remain source-separated; semantic hashing
  is non-self-referential and separate from optional execution traces.
- **Initial implementation:** [`finance_risk`](finance/finance_risk/README.md)
  implements sourced information states, exact planned/gap loss and explicit
  fraction budgets, generic independent quantity bounds, supplied-grid
  projection, requested intersections, single-currency planned-stop heat,
  partial cost decompositions, and canonical request/semantic receipts. Twenty
  deterministic offline tests and the full repository suite pass. Shorts,
  derivatives, margin liquidation, cross-currency aggregation, scaling,
  tiered costs, correlation/liquidity stress, VaR/CVaR, drawdown schedules,
  intraday risk, and execution integration remain incremental.

#### CG-DAY execution-information resolution — 2026-08-07

- **Evidence:** trading-course
  [Session 14](../trading-course/sessions/14_cg_day_execution_information_contract_20260807.md),
  which resolved the bounded execution-information slice and at that time left
  the complete professional intraday loop open; Session 22 later resolves the
  provider-neutral workflow information contract below.
- **Reviewed scope:** long-only cash equities on separately labelled `cn`,
  `hk`, and `us` tracks: desired instructions, sourced broker/account/exchange
  capabilities, session comparisons, explicit daily-bar/depth/scenario models,
  unknown queue and remainder facts, ordered lifecycle/fill receipts, requested
  aggregate/cost/benchmark/latency calculations, compact operations, and
  content-bound receipts. Daily swing use does not claim intraday sequence.
- **Controlling boundary:** execution libraries and plugins expose exact facts,
  labelled model branches, external broker states, requested calculations,
  provenance, unknowns, conflicts, omissions, alternatives, and available
  operations. They never select an order or broker encoding, transform to a
  fallback, predict a fill, choose a branch/benchmark/threshold, judge
  correctness or sufficiency, recommend a response, decide the next operation,
  or authorize a trade. The LLM owns every such decision.
- **Accepted mechanics:** desired instructions and broker-native encodings are
  distinct; depth snapshots do not prove queue or hidden size; daily bars emit
  compatible paths rather than a fill; partial remainders stay unknown beyond
  the scenario window; broker rejection text remains an external fact;
  cancel/fill races retain every event; unknown cost or clock operands leave
  known calculations available; semantic hashes are non-self-referential and
  batch/incremental folds are equivalent for equal ordered events.
- **Initial implementation:**
  [`finance_execution`](finance/finance_execution/README.md) implements sourced
  facts and desired capabilities, session comparisons,
  `visible_depth_sweep_v1`, `bar_possible_paths_v1`, exact fill aggregation,
  lifecycle folding, requested spread/slippage/shortfall/cost/latency
  calculations, and canonical request/semantic receipts. Twenty-four
  deterministic offline tests pass. `pi_order_simulator` exposes the reviewed
  completed-daily branch slice, while additional models, provider/broker
  adapters, licensed intraday acquisition, journal composition, and all
  mutation remain separate. The
  `CG-PSYCHOLOGY` journal-information slice is resolved below; it does not
  complete the day-trader workflow.

#### CG-DAY provider-neutral full-workflow resolution — 2026-08-09

- **Evidence:** trading-course
  [Session 22](../trading-course/sessions/22_cg_day_full_workflow_contract_20260809.md),
  which resolves the network-free intraday packet, calculation, and workflow
  information contract before a licensed provider adapter exists.
- **Reviewed scope:** one long cash-equity listing/session packet on an exact
  `cn`, `hk`, or `us` track; caller-attested provider/feed/entitlement/licence
  and acquisition facts; exact phase/rule receipts; all reviewed quote, trade,
  depth, auction, halt/status, correction, cancel/bust, and heartbeat variants;
  sequence/freshness/gap laws; explicit calculations; and caller-retained
  `Preparation` through `Review` state transitions.
- **Controlling boundary:** the workbench reports mechanical facts and applies
  explicit transitions. It does not authenticate a feed, acquire data, decide
  readiness or a trade, rank a candidate, predict/claim a fill, persist state,
  alert, or mutate an order/account. `Ready` means only
  `evidence_available`; the LLM/user owns every interpretation and next action.
- **Initial implementation:** [`day_workbench`](plugins/day_workbench/README.md)
  registers `day_inspect`, `day_calculate`, and `day_transition`. Ten focused
  tests and six bundled scenarios cover the packet/event, calculation,
  integrity, workflow/idempotence, cancellation, and `CG-LIVE` boundaries;
  warnings-as-errors, architecture, artifact/installed-Pi smoke, and the full
  regression pass complete the Experimental slice. Licensed acquisition,
  scanning, durable monitoring, alerts, short/margin/derivatives, advanced
  execution evidence, and external-receipt review remain future triggers.

#### CG-LIVE historical contract and controlling amendment — 2026-08-12

- **Evidence:** trading-course
  [Session 25](../trading-course/sessions/25_cg_live_broker_effect_contract_20260811.md),
  written in response to `/tmp/QA07.md`.
- **Reviewed scope:** Session 25 supplies account/order/activity observation,
  lifecycle/race, reconciliation and immutable audit vocabulary. Its
  broker-hosted paper and live mutation effects are superseded.
- **Controlling boundary:** no plugin accepts write-capable credentials or
  places, routes, cancels, replaces, modifies, or approves an order. Plugins may
  perform read-only observation/import, deterministic local simulation,
  non-executable handoff export, lifecycle reconciliation, and pure rule
  evaluation. The user performs every market action outside Pi.
- **Design effect:** all eight catalog proposal scopes follow the amended
  evidence-only boundary. T6 has one composed acceptance lane with independently
  proved Futu `cn`, `hk`, and `us` live legs; no track leg grants order mutation
  or proves another track.

#### CG-PSYCHOLOGY journal-information resolution — 2026-08-07

- **Evidence:** trading-course
  [Session 15](../trading-course/sessions/15_cg_psychology_journal_information_contract_20260807.md),
  which is the canonical contract for attributed declarations, checklists,
  immutable journal events, local-first portability, requested calculations,
  compact context, corrections, redaction metadata, and failure behavior.
- **Reviewed scope:** exact user, LLM, imported, provider, broker, system, and
  calculated attribution; open declaration vocabulary; versioned partial
  checklists; append-only correction/redaction lineage; point-in-time views;
  JSONL storage/query/export/import effects; explicitly requested
  plan-observation comparison and long-cash realized net P&L; and compact
  resumable context for `cn`, `hk`, and `us` journal records.
- **Controlling boundary:** journal libraries and plugins preserve exact events,
  privacy, identity, provenance, unknowns, conflicts, omissions, calculations
  explicitly requested by the LLM, and neutral available operations. They never
  infer psychology, diagnose, grade process or discipline, judge correctness or
  sufficiency, explain performance causally, select a review policy, change
  risk, recommend a response, authorize a trade, or choose the next operation.
  The LLM owns every interpretation and decision.
- **Accepted mechanics:** authorship never changes in a projection; corrections
  and redactions append rather than rewrite history; same idempotency key plus
  identical semantic content returns the original event; private prose is
  omitted from compact context and ordinary queries unless explicitly
  requested; storage capability and security facts remain distinct; exact
  cross-track/listing identity is never inferred from a symbol; and export
  privacy is caller-selected rather than plugin policy.
- **Initial implementation:**
  [`finance_journal`](finance/finance_journal/README.md) implements immutable
  events, information states, replay/query/export, checklist receipts,
  comparisons, realized net P&L, and compact context with twenty offline tests.
  [`trade_journal`](plugins/trade_journal/README.md) supplies the thin Pi shell
  and bounded local-first JSONL backend with seven plugin tests and four binding
  scenarios; artifact verification, installed-Pi smoke loading, and the full
  repository suite pass. Pagination continuations, partial import, more requested metrics,
  deletion, databases, persona templates, `CG-QUANT` statistics,
  `CG-PORTFOLIO` attribution, and `CG-LIVE` integration remain incremental and
  do not authorize plugin-owned decisions.

#### CG-QUANT shared-replay resolution — 2026-08-07

- **Evidence:** trading-course
  [Session 16](../trading-course/sessions/16_cg_quant_shared_replay_information_contract_20260807.md),
  which is the canonical information contract for point-in-time manifests,
  immutable run definitions, partitions, replay events, trial accounting,
  requested calculations, comparison, compact context, and reproducibility.
- **Reviewed scope:** provider-neutral completed-daily, long-only cash-equity
  replay on separately labelled `cn`, `hk`, and `us` tracks; exact joins to
  existing feature, strategy, risk, and execution receipts; deterministic
  ordered-event folding; checkpoints; explicit event/byte/time/session budgets
  and cancellation; caller-supplied trials and calculations; and portable
  canonical manifests plus event JSONL.
- **Controlling boundary:** libraries and plugins expose exact inputs, temporal
  and source facts, replay events, requested calculations, provenance,
  unknowns, conflicts, ambiguous branches/orderings, omissions, trial history,
  compact handles, and neutral available operations. They never choose a
  hypothesis, universe, feature, policy, parameter, partition, model, branch,
  benchmark, metric, trial, threshold, interpretation, or next operation. They
  never label correctness, sufficiency, edge, significance, robustness,
  validity, readiness, or deployability. The LLM owns every decision.
- **Accepted mechanics:** an unknown required time produces explicit ambiguous
  ordering alternatives rather than a fabricated sequence; caller-supplied
  event order is never silently interpolated, reordered, deduplicated, or
  netted; failed, cancelled, truncated, duplicate, and unperformed trials stay
  visible; identical idempotent retries return the original while conflicting
  retries preserve both hashes; requested calculations retain formula, units,
  scale, rounding, sample, ordering, benchmark, source receipts, and
  unavailable operands; checkpoints cannot change a run definition or state.
- **Initial implementation:** [`finance_replay`](finance/finance_replay/README.md)
  implements universe/dataset manifests, immutable run and partition
  definitions, replay events and pure fold/effects, ambiguity facts,
  checkpoints, trial definitions and append-only ledger, net return,
  win/loss/tie counts, drawdown series, trade-list projection, run comparison,
  compact context, reproduction manifests and bounded JSONL, and a local
  scripted interpreter. Twenty-three deterministic offline tests pass.
  Intraday replay, shorting/derivatives, portfolio construction, automated
  search/optimization, advanced statistics, live deployment, provider clients,
  and Pi shells remain incremental and do not reopen this LLM-only boundary.

#### CG-PORTFOLIO light calculation resolution — 2026-08-09

- **Evidence:** trading-course
  [Session 18](../trading-course/sessions/18_cg_portfolio_light_calculation_contract_20260809.md),
  which explicitly permits the bounded calculation slice before
  `CG-FUNDAMENTAL` while leaving full portfolio construction/review open.
- **Reviewed scope:** stateless calculations over supplied single-currency,
  long-only cash-equity positions and account facts: gross/net exposure,
  NLV-denominated weights, signed current-mark or entry-minus-stop heat,
  caller-selected heat denominator, per-position contributions, partial or
  all-or-nothing totals, temporal cutoff projection, duplicate/conflict
  preservation, reconciliation, and canonical semantic receipts.
- **Controlling boundary:** the plugin returns exact arithmetic, formula and
  operand provenance, unknowns, conflicts, omissions, staleness, mechanical
  facts, and reconciliation. The LLM owns every threshold, concentration or
  adequacy judgment, response, rebalance, recommendation, authorization, and
  next operation.
- **Initial implementation:**
  [`portfolio_risk`](plugins/portfolio_risk/README.md) registers one pure
  calculation tool and reuses `finance_risk` information/expression contracts
  plus `finance_math` exact arithmetic. Twelve pure tests, five bundled-boundary
  scenarios, artifact verification, installed-Pi smoke, architecture gates,
  and full repository regression pass. Shorts, FX/multi-currency,
  provider/account import, aggregation by
  listing/issuer, leverage/margin, correlation, concentration policy,
  liquidity, stress, VaR/CVaR, optimization, and rebalancing remain outside the
  resolved slice.

#### CG-PORTFOLIO raw import/inspection resolution — 2026-08-09

- **Evidence:** trading-course
  [Session 21](../trading-course/sessions/21_cg_portfolio_import_inspection_contract_20260809.md),
  written in response to `/tmp/QA04.md` and independently authorizing the
  rank-19 import slice before full portfolio review.
- **Reviewed scope:** strict bounded local CSV/JSON decoding into immutable
  snapshot/account/position facts; explicit null/blank/absent/unavailable/
  decode-failure states; exact track/listing/currency/time/source lexemes;
  duplicate/conflict and unsupported-row preservation; privacy redaction;
  per-currency mechanical values and reconciliation; compact summary and
  bounded row drill-down.
- **Controlling boundary:** the source file and content hash authenticate no
  broker or fact. The implementation infers no track, listing, currency, FX,
  aggregation, portfolio sufficiency, review conclusion, recommendation,
  rebalance, or next operation. Its bounded in-memory lookup is session-local
  only and satisfies the drill-down contract without durable storage.
- **Initial implementation:** [`portfolio`](plugins/portfolio/README.md)
  registers `portfolio_import`, `portfolio_summary`, and
  `portfolio_positions`. Eight pure tests and seven bundled-boundary scenarios
  cover decoding, budgets, identity, information states, conflicts,
  reconciliation, regular-file/UTF-8/symlink safety, cancellation, privacy,
  idempotence, ephemeral lookup, and no writes; warnings-as-errors,
  architecture, artifact, installed-Pi, and full-regression gates pass. Broker
  retrieval, durable comparison, FX aggregation, full review, optimization,
  attribution, and rebalance remain outside this resolved slice.

#### CG-PORTFOLIO full-review resolution — 2026-08-11

- **Evidence:** trading-course
  [Session 24](../trading-course/sessions/24_cg_portfolio_full_review_contract_20260811.md),
  written in response to `/tmp/QA06.md`.
- **Reviewed scope:** caller-supplied multi-account/multi-currency position,
  cash-flow, benchmark, FX, and lot facts; requested money/time-weighted returns
  and named attribution variants with reconciliation/residuals; explicit
  historical or synthetic shocks; mechanical current-to-caller-target rebalance
  deltas with infeasibility facts; tax-lot arithmetic under supplied
  jurisdiction/version parameters; and durable correction-linked review
  receipts.
- **Controlling boundary:** the LLM/user selects benchmarks, formulas, shocks,
  targets, constraints, lot policy, tax rules, interpretation, and action.
  Scenario results are not forecasts, rebalance deltas are not recommendations
  or orders, and tax calculations are not legal/tax advice. Optimization,
  automated harvesting, provider/broker retrieval, and live execution remain
  outside scope.
- **Design effect:** `pi_portfolio_scenarios`, `pi_portfolio_attribution`,
  `pi_portfolio_rebalance`, and `pi_tax_lots` now have README-only designs but
  are not selected for implementation. Existing `pi_portfolio` and
  `pi_portfolio_risk` implementations remain within their Session 18/21 slices.

#### CG-FUNDAMENTAL minimum dossier resolution — 2026-08-09

- **Evidence:** trading-course
  [Session 19](../trading-course/sessions/19_cg_fundamental_investor_dossier_contract_20260809.md),
  written in response to `/tmp/QA02.md` and resolving the rank-15 gate.
- **Reviewed scope:** a stateless caller-supplied dossier with 16 explicit
  evidence states, exact primary and related listing legs, reporting and
  statement/amendment facts, the 15-calendar-month annual-evidence condition,
  append-only review links and receipt deltas, explicitly requested general and
  sector metrics, and assumption-labelled valuation scenarios.
- **Controlling boundary:** the plugin exposes information states, mechanical
  compatibility/insufficiency facts, formula trees, operand proofs, and
  enterprise-to-equity per-share arithmetic. The LLM/user owns evidence
  sufficiency, reviewability, business quality, governance interpretation, peer
  choice, macro linkage, valuation assumptions, thesis, portfolio fit,
  recommendation, and next action.
- **Initial implementation:**
  [`investor_workbench`](plugins/investor_workbench/README.md) registers
  `inspect_dossier`, `dossier_metric`, and `dossier_valuation`. Eleven pure
  tests, five bundled-boundary scenarios, artifact verification, installed-Pi
  smoke, architecture gates, and full repository regression pass. It performs
  no provider fetch, storage, profile/governance/industry extraction, peer
  selection, automated monitoring, thesis mutation, DCF/WACC/terminal-value
  model, completeness verdict, quality score, target-price claim, or investment
  recommendation.

#### CAPCO classification source contract — 2026-08-09

- **Evidence:** trading-course
  [Session 20](../trading-course/sessions/20_cg_portfolio_classification_source_addendum_20260809.md),
  written in response to `/tmp/QA03.md` and authorizing the rank-17 source slice.
- **Reviewed scope:** the official CAPCO 2025-H2 listed-company industry-
  classification result and exact PDF, with the 2023-05-01 guideline effective
  date, 2025-H2 result label, 2026-04-03 publication date, retrieval instant,
  published 门类/大类/manufacturing 次类, source fingerprint, rights, and one
  exact requested stock-code row retained separately.
- **Controlling boundary:** the result is a period-labelled published snapshot,
  not a per-company effective interval. CAPCO publishes no MIC in the artifact;
  the plugin infers none, publishes no 中类, maps no other taxonomy, treats no
  vendor as authority evidence, and fails closed when the pinned bytes change.
- **Initial implementation:** [`finance_capco`](finance/finance_capco/README.md)
  owns the bounded exact request, content-hash check, PDF text boundary, and
  pure row parser. [`cn_stock_sector_concept`](plugins/cn_stock_sector_concept/README.md)
  registers only `cn_industry_classification`; concepts and membership lists
  remain later slices. Five adapter tests, five plugin tests, two synthetic-PDF
  boundary tests, and five bundled scenarios cover the implemented contract;
  architecture, artifact, installed-Pi smoke, and full-regression gates pass.

#### Alpaca/Benzinga news metadata source contract — 2026-08-09

- **Evidence:** Alpaca's current News API reference, historical-news source
  description, and terms were reviewed before implementation. The reference
  exposes bounded symbol/time filtering, ascending `updated_at` ordering,
  pagination, and content inclusion controls; Alpaca identifies Benzinga as the
  current source.
- **Reviewed scope:** one exact caller-declared US symbol and inclusive UTC
  interval, provider article ID, headline, author, exact created/updated time
  lexemes, canonical URL, all provider symbol associations, exact
  `source=benzinga`, pagination, request ID when supplied, response length and
  SHA-256 hash, and whether withheld content classes existed.
- **Controlling boundary:** the slice returns metadata only. It does not return
  summaries, bodies, or image URLs; authenticate a listing or venue; infer a
  correction lineage; deduplicate or cluster; verify an event; score sentiment
  or impact; classify a catalyst; claim absence or completeness; recommend; or
  choose a next operation. Rights are declared as local personal/noncommercial
  use, with redistribution requiring the caller to establish permission.
- **Initial implementation:**
  [`finance_market_alpaca`](finance/finance_market_alpaca/README.md) owns the
  exact bounded request and fail-closed decoder.
  [`finance_news`](plugins/finance_news/README.md) registers only
  `finance_news`, enforces pagination/article budgets and cancellation, and
  emits content-bound page receipts. Seventeen adapter tests, four pure plugin
  tests, six bundled-boundary scenarios, architecture, artifact, and installed-
  Pi gates plus full repository regression cover the implemented contract.

#### CG-SWING resolution — 2026-08-06

- **Evidence:** trading-course
  [Session 10 with the 10A and final 10B corrective addenda](../trading-course/sessions/10_cg_swing_daily_workflow_20260425.md).
- **Reviewed scope:** long-only cash equities on a completed-daily-bar cadence,
  normally held for several sessions, with a point-in-time universe, an
  inspectable RSI-reversal strategy example, plan-before-order, monitoring,
  explicit exit ambiguity, expiry, and planned-versus-observed review. It is a
  workflow contract and test hypothesis, not evidence of positive expectancy.
- **Normative implementation:**
  [`finance_strategy`](finance/finance_strategy/README.md) owns pure strategy
  definition data, evidence compatibility projection, receipt JSON, LLM/user
  plan declarations, and structural workflow history. It deliberately has no
  aggregate evaluation or decision type.
  [`pi_swing_workbench`](plugins/swing_workbench/README.md) is now an
  Experimental thin Pi evidence/context compositor. Neither owns indicator arithmetic, sizing, provider
  access, market rules, fill simulation, journal storage, or the LLM's decision.
- **Accepted corrections:** planned closures are absent from ordered trading-
  session series; no synthetic prices or volume are inserted; price-dependent
  features require an adjustment-consistent series and provenance; row presence
  is not an observation receipt; false predicates are distinct from missing or
  late evidence and never become an aggregate verdict; close-known facts cannot
  become earlier intraday facts; and a daily bar touching stop and target
  without sequence evidence yields an explicit unknown-ordering fact.
- **Repository boundary:** course market, fee, tax, lot, tick, account, broker,
  and calendar facts are requirements examples. Production evidence projection
  consumes exact track/listing/effective-date receipts from the existing
  market-owned packages and caller capabilities; it does not embed those tables
  as timeless constants or decide what the LLM should do. The addendum's
  `CG-JOURNAL` label maps to the existing
  `CG-PSYCHOLOGY` gate plus the ordinary `journal_schema` dependency because
  `CG-JOURNAL` is not registered here. Provider omission and incomplete
  evidence remain distinct compatibility facts, never a semantic rejection of
  the security.
- **Adjacent inputs remain incremental rather than plugin-design blockers:** the
  `CG-MARKET-DATA` information contract is resolved, but exact track/provider
  composition for daily observation, timing, volume/turnover, source-rights,
  and import facts remains incremental; the resolved `CG-TECH` calculation
  contract is implemented only for its first SMA/RSI/ATR slice; position
  sizing, gap stress, account constraints, and portfolio heat now use the
  resolved `CG-RISK` contract and its initial `finance_risk` calculation slice;
  the initial execution-information seam is now available, while exact
  track/account support, additional fill/cost models, and all executable order
  behavior remain incremental; the resolved journal-information contract and
  initial durable shell can now be referenced by event ID, while broader
  psychology/review templates remain incremental; and expectancy/backtest
  claims belong to `CG-QUANT`. The workbench
  can preserve exact supplied receipts and information states before those
  families are broad or complete because it never decides their correctness or
  sufficiency. Missing, stale,
  late, conflicting, declared-only, and unsupported dependencies remain named
  facts. Optional confirmation/ranking omissions stay visibly optional; no
  readiness label authorizes or rejects the LLM's plan.
- **Initial workbench implementation:** the network-free
  [`swing_workbench`](plugins/swing_workbench/README.md) attaches canonical
  strategy receipts, exact generic information facts, immutable opaque LLM/user
  plan declarations, and caller-vocabulary review records. It reports exact
  snapshot changes and neutral available operations, replays/forks Pi branch
  events, and locks malformed history. Fifteen contract tests plus five seeded
  CN/HK/US replay/journal acceptance tests, three deterministic bundled-tool
  journeys, four binding scenarios, artifact verification, and Pi smoke
  loading cover the reproducible slices. An additional opt-in configured-tutor
  lane executes thirteen real workbench and journal calls, lets the LLM select
  content-bound plan, preflight, monitor, replay, and review operations, and
  verifies their plan-reference lineage plus exact `llm_declared` persistence.
  It then opens the same native Pi session in a second process, verifies
  byte-equivalent revision-8 state, attaches the exact durable journal handle,
  and verifies revision 9 from nine extension events, then exports the exact
  caller-selected canonical workbench log. A third process with a distinct Pi
  session ID recovers the journal tuple, imports the expected portable hash
  into an empty branch, and reconstructs the identical revision-9 snapshot.
  The 21-call proof leaves restore, merge, interpretation, and next-operation
  choices with the LLM/caller. A test shell
  invokes the actual bundled CN/HK/US OHLCV
  tools over exact scripted response bytes and copies their market-owned gap
  receipts; the Gleam builder composes indicator-request, risk-request,
  track-owned rule-projection, execution semantic, source-declared
  sector/regime, bounded catalyst, exact task-time, and point-in-time
  universe/candidate receipts. The US row is acquired by the actual bundled
  `stock_universe` plugin over exact scripted Alpaca bytes, and its source and
  universe hashes are matched to the candidate receipt; CN/HK rows remain
  synthetic. All nine hashes are attached on each track. Provider
  authentication remains false and
  non-authenticating rule projection hashes remain explicit. No
  plugin decision field exists. The acceptance fixtures retain exact context,
  task-time, universe/candidate, and exception facts but do not claim provider
  authenticity, completeness, or professional sufficiency.

For a useful answer, ask the advisor to return: persona and holding horizon;
track/instrument scope; required inputs and permissible freshness; exact formulas
or decision rules with defaults identified as defaults; unknown/fail-closed
cases; at least two worked examples and two counterexamples; and what the tool
must never conclude. This becomes requirements evidence, not provider evidence.

## Rules for every finance plugin

Finance tools need a stricter contract than ordinary convenience plugins:

- Follow `FUNCTIONAL_DESIGN.md`: finance rules, calculations, validation, and
  workflow transitions are pure functions over immutable types. Pi, HTTP,
  clocks, storage, randomness, and credentials remain explicit shell
  capabilities.
- Model multi-step workflows as typed events and effects so they can be folded,
  replayed, audited, and tested without Pi or provider access.
- Every observation carries its source, `as_of` time, retrieval time, timezone,
  currency/unit, and delayed/real-time status.
- Prices say whether they are raw or adjusted and identify the session
  (pre-market, regular, after-hours, or closed).
- Missing, stale, estimated, restated, and revised data are explicit states, not
  silently converted to zero.
- Decimal financial values stay as strings or exact decimal representations at
  the FFI boundary; binary floats are reserved for derived analytics where the
  precision policy is stated.
- Corporate actions and symbol changes are first-class. A ticker alone is not a
  permanent security identifier.
- Every analytical result records its inputs and assumptions. The agent must not
  invent a quote, filing fact, consensus estimate, or citation.
- Provider limits, entitlements, and redistribution terms are respected. Cache
  policy is provider-specific.
- Credentials come from environment/configuration and are never appended to Pi
  sessions, logs, tool details, or error messages.
- Read-only is mandatory for broker access. Local simulation, non-executable
  handoff, and external receipt review are separate capabilities; paper/live
  order mutation is unavailable to every plugin.
- Output is research tooling, not a guarantee, fiduciary service, or substitute
  for professional advice.

## Roadmap phases

This file is the governing index. Together, `ROADMAP.md` and `R0.md`–`R3.md`
are the proposal catalog required by the repository guidelines. The lifecycle,
trader-requirement steering decisions, course-demand gates, track laws, and
finance-plugin rules above apply to every phase file.

| Phase | Detailed roadmap | Scope | Exit/steering purpose |
| --- | --- | --- | --- |
| **R0 — Trustworthy substrate and implemented baseline** | [`R0.md`](R0.md) | Shared finance packages, dependency laws, completed arbitrations, Experimental vertical slices, and the current depth gaps. | Establish what is real and reusable before counting trader-facing breadth. |
| **R1 — Finance capability catalog** | [`R1.md`](R1.md) | Foundation/trust, market data, CN/HK/US research, fundamentals, valuation, trader workbenches, events, macro, portfolio, backtest, and execution proposals. | Keep the complete capability map while thin workbenches compose shared engines instead of cloning them. |
| **R2 — Delivery and trader-workflow convergence** | [`R2.md`](R2.md) | Active six-tier ledger and blockers, historical Session 17 inventory, dependency foundations, role acceptance, and CN/HK/US track evidence. | Resolve the active tier's blockers first, build its complete dependency cone atomically, and run the promotion matrix once at the role-product boundary. |
| **R3 — Provider policy and open decisions** | [`R3.md`](R3.md) | Candidate/accepted providers, entitlement and source cautions, and unresolved product/data decisions. | Resolve provider and policy choices without creating invisible fallback chains. |

Read phases in order for a full audit. They are categories, not permission to
skip dependencies: an item in a later file still depends on all applicable R0
contracts, track-specific evidence gates, and course-demand stops. New detailed
proposals go in the appropriate phase file and must be linked from this index if
they change a phase's scope. [`R2.md`](R2.md#active-delivery-ledger--2026-08-09)
is the active work ledger; the other files should not grow duplicate status
lists.
