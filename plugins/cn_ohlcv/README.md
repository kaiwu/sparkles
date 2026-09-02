# pi_sparkles_cn_ohlcv

Status: **Experimental** · version: `0.1.0` · target: JavaScript/Bun

`cn_stock_ohlcv` converts one bounded mainland vendor history response into the
shared `finance_ohlcv` contract. Eastmoney `klt=101`, `fqt=0` remains primary.
An Eastmoney failure only returns a suggestion to ask the user about Sina; it
never contacts Sina in that call. Only after the user explicitly chooses the
alternative may a separate call set `provider: "sina"`. That call contacts only
Sina's `scale=240` CN endpoint and plainly states the user-selected data-source
change. The caller must give an exact six-digit code, venue, board, share class,
currency, and provider. The plugin validates the declared combinations but does
not claim either vendor proves that identity.

Every source numeric lexeme is retained. Provider amount, amplitude, change,
and turnover fields remain separate raw evidence rather than being coerced into
OHLCV. Eastmoney supplies a civil date, not an exact bar timestamp, so canonical
observations use a visibly labelled UTC-midnight ordering anchor. The provider
volume unit and session membership remain unknown; the plugin does not call the
value shares, infer suspensions, fill gaps, or apply adjustments.

Requests are read-only, caller-identified, limited to 1–1000 rows, bounded,
cancellable, and admitted at one request per two seconds through process-shared
provider quotas. Neither adapter retries. The explicitly selected Sina
alternative is available only for SSE/SZSE CNY A-shares; BSE, B-shares, HK, and
US never enter that route. A Sina result reports
`eastmoney->sina_by_explicit_user_choice`, `fallbackPerformed: false`, one Sina
attempt, and no Eastmoney attempt. If a provider response reaches its row limit,
pagination is reported as truncated.

Every successful result also emits a versioned `gapAssessmentReceipt`. Its
canonical SHA-256 binds the exact CN identity and range, selected provider source plan,
retrieval time, pagination state, ordered normalized bar dates, and response
byte length/body hash. The separate network-free `cn_ohlcv_gap_assessment`
tool can verify and compose that copied receipt with independently supplied
listing, 2026 venue-calendar, and status evidence. The digest is a content
coherence check, not a provider signature or exchange proof.

The same successful call separately appends the canonical
`pi_sparkles_finance_ohlcv.series_handoff.v1` entry to the invoking Pi or DSH
session and returns its exact `seriesReceipt`. `sma`, `rsi`, `atr`, and
`chart_ohlcv` consume that short receipt without copying rows. The gap digest
and the series receipt have different contracts and are never interchangeable.

Runtime configuration:

- `AGENT_CONTACT` (shared non-secret operator identity, for example `ops@example.com`)

The plugin supplies its fixed outbound product label.

Eastmoney and Sina are vendor-origin public-web evidence with unknown service
levels, quotas, licences, and redistribution rights. Sina does not echo the
listing identity or supply amount, and those facts remain caller-declared or
unknown. Normal tests use fixtures only.

The tool emits its complete bounded provider rows and normalized OHLCV bars in
model-visible content as well as structured details, so agents can consume the
exact series rather than only the compact bar-count summary.

## T1 provider-port migration

This implementation is the first adapter evidence. T1 introduces one canonical
CN daily-series provider port and keeps the exact Eastmoney and Sina decoders
behind it. Both adapters preserve their own lexemes, timestamps, adjustment,
units, rights, pagination, and limitations while returning the same canonical
envelope. The Sina alternative requires a separate, explicit user-selected request and
does not duplicate the swing acceptance journey per provider.
