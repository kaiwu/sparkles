# cn_ohlcv_gaps

Experimental, network-free Pi plugin for mainland China. It registers
`cn_ohlcv_gap_assessment`, which consumes the exact `gapAssessmentReceipt`
emitted by `cn_stock_ohlcv` plus an independently repeated listing identity,
effective interval, listing reference, and per-gap market-status receipts.

The copied receipt is CN-specific and SHA-256-bound: venue, board, share class,
currency, code, range, explicit Eastmoney or Sina row limit/source, retrieval time, coverage
state, ordered bar dates, and the response page's byte length, optional request
ID, and body hash all participate in the canonical digest. Any changed field
fails before classification.

Only complete provider coverage can be assessed. The pure engine walks each
civil date against the exact 2026 SSE/SZSE/BSE planned calendar and returns
separate market-closure, suspension, provider-omission, and unavailable-history
states with all applicable evidence legs.

No environment variables or runtime network access are used. The digest proves
copy coherence, not provider origin; listing and status references remain
caller supplied and unverified. Volume, amount, turnover, adjustments,
corporate actions, later calendars, exceptional notices, and redistribution
rights remain outside this slice.
