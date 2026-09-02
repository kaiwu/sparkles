# finance_sina

Status: **Experimental** · version: `0.1.0` · target: JavaScript/Bun

`finance_sina` is a bounded, caller-identified adapter for Sina Finance's
mainland daily K-line surface. It supports explicitly declared SSE and SZSE
codes, including the exact reviewed SSE STAR 50 index `000688`, preserves price and volume lexemes, rejects malformed or unordered
rows, filters the provider's bounded trailing window to the caller's exact date
range, and reports when the provider window reached its row budget.

Production requests share one process-local quota across independently loaded
Pi and DSH shells: one request per two seconds, one request in flight, a bounded
queue, and no automatic retry. Sina is never selected silently. The CN OHLCV
shell uses it only in a separate request with `provider: sina` after the user
explicitly chooses the suggested alternative. The CN raw market-data shell uses
the same two-call contract only for the exact reviewed SSE STAR 50 history.
An Eastmoney request never calls Sina automatically, and a Sina request never
calls Eastmoney. Sina results state the user-selected provider transition and
`fallbackPerformed: false`.

The response does not echo a listing identity, exchange, currency, adjustment,
volume unit, entitlement, or calendar. Those facts remain caller-declared or
unknown. The official Sina HK history surface observed during this adapter
review ended in 2019, so HK is deliberately `track_partial` and is not exposed
as a current alternative. BSE is also unsupported until its symbol mapping is
independently proved. Service level, quota, licence, redistribution, and
correction behavior are unknown.
