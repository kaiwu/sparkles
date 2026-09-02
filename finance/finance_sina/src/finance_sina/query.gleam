import finance_calendar/date
import finance_core/time
import finance_track
import gleam/int
import gleam/list
import gleam/order.{Gt}
import gleam/string

pub type Venue {
  Sse
  Szse
}

pub opaque type HistoryQuery {
  HistoryQuery(
    venue: Venue,
    code: String,
    start_date: time.Date,
    end_date: time.Date,
    limit: Int,
  )
}

pub type QueryError {
  TrackMismatch
  InvalidCode
  InvalidDateRange
  InvalidLimit
}

pub fn history(
  track: finance_track.Track,
  venue: Venue,
  code: String,
  start_date: time.Date,
  end_date: time.Date,
  limit: Int,
) -> Result(HistoryQuery, QueryError) {
  case
    track == finance_track.Cn,
    valid_code(code),
    date.compare(start_date, end_date),
    limit >= 1 && limit <= 1000
  {
    False, _, _, _ -> Error(TrackMismatch)
    _, False, _, _ -> Error(InvalidCode)
    _, _, Gt, _ -> Error(InvalidDateRange)
    _, _, _, False -> Error(InvalidLimit)
    True, True, _, True ->
      Ok(HistoryQuery(venue, code, start_date, end_date, limit))
  }
}

pub fn history_venue(value: HistoryQuery) -> Venue {
  value.venue
}

pub fn history_code(value: HistoryQuery) -> String {
  value.code
}

pub fn history_start(value: HistoryQuery) -> time.Date {
  value.start_date
}

pub fn history_end(value: HistoryQuery) -> time.Date {
  value.end_date
}

pub fn history_limit(value: HistoryQuery) -> Int {
  value.limit
}

pub fn history_symbol(value: HistoryQuery) -> String {
  case value.venue {
    Sse -> "sh" <> value.code
    Szse -> "sz" <> value.code
  }
}

pub fn venue_name(value: Venue) -> String {
  case value {
    Sse -> "sse"
    Szse -> "szse"
  }
}

pub fn history_source_reference(value: HistoryQuery) -> String {
  "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol="
  <> history_symbol(value)
  <> "&scale=240&ma=no&datalen="
  <> int.to_string(value.limit)
}

fn valid_code(value: String) -> Bool {
  string.length(value) == 6
  && value
  |> string.to_graphemes
  |> list.all(fn(character) { string.contains("0123456789", character) })
}
