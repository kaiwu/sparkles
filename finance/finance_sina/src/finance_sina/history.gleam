import finance_calendar/date
import finance_core/decimal
import finance_core/time
import finance_sina/query.{type HistoryQuery}
import gleam/dynamic/decode
import gleam/int
import gleam/json
import gleam/list
import gleam/order.{Eq, Gt, Lt}
import gleam/result
import gleam/string

type RawBar {
  RawBar(
    day: String,
    open: String,
    high: String,
    low: String,
    close: String,
    volume: String,
  )
}

pub opaque type Bar {
  Bar(
    date: time.Date,
    open: String,
    high: String,
    low: String,
    close: String,
    volume: String,
  )
}

pub opaque type History {
  History(code: String, bars: List(Bar), provider_window_truncated: Bool)
}

pub type DecodeError {
  InvalidJson(json.DecodeError)
  TooManyRows(limit: Int, received: Int)
  InvalidBar(index: Int)
  RowsNotStrictlyAscending(index: Int)
  NoRowsInRange
}

pub fn decode(
  body: String,
  for plan: HistoryQuery,
) -> Result(History, DecodeError) {
  use rows <- result.try(
    json.parse(body, decode.list(of: raw_bar_decoder()))
    |> result.map_error(InvalidJson),
  )
  use _ <- result.try(case list.length(rows) <= query.history_limit(plan) {
    True -> Ok(Nil)
    False -> Error(TooManyRows(query.history_limit(plan), list.length(rows)))
  })
  use bars <- result.try(decode_rows(rows, 0, []))
  use _ <- result.try(validate_order(bars, 0))
  let selected =
    bars
    |> list.filter(fn(bar) {
      date.compare(bar.date, query.history_start(plan)) != Lt
      && date.compare(bar.date, query.history_end(plan)) != Gt
    })
  case selected {
    [] -> Error(NoRowsInRange)
    [_, ..] ->
      Ok(History(
        query.history_code(plan),
        selected,
        list.length(rows) == query.history_limit(plan),
      ))
  }
}

pub fn code(value: History) -> String {
  value.code
}

pub fn bars(value: History) -> List(Bar) {
  value.bars
}

pub fn provider_window_truncated(value: History) -> Bool {
  value.provider_window_truncated
}

pub fn date(value: Bar) -> time.Date {
  value.date
}

pub fn open(value: Bar) -> String {
  value.open
}

pub fn high(value: Bar) -> String {
  value.high
}

pub fn low(value: Bar) -> String {
  value.low
}

pub fn close(value: Bar) -> String {
  value.close
}

pub fn volume(value: Bar) -> String {
  value.volume
}

fn raw_bar_decoder() -> decode.Decoder(RawBar) {
  use day <- decode.field("day", decode.string)
  use open <- decode.field("open", decode.string)
  use high <- decode.field("high", decode.string)
  use low <- decode.field("low", decode.string)
  use close <- decode.field("close", decode.string)
  use volume <- decode.field("volume", decode.string)
  decode.success(RawBar(day, open, high, low, close, volume))
}

fn decode_rows(
  values: List(RawBar),
  index: Int,
  reversed: List(Bar),
) -> Result(List(Bar), DecodeError) {
  case values {
    [] -> Ok(list.reverse(reversed))
    [RawBar(day, open, high, low, close, volume), ..rest] ->
      case
        parse_date(day),
        list.all([open, high, low, close, volume], valid_numeric_lexeme)
      {
        Ok(bar_date), True ->
          decode_rows(rest, index + 1, [
            Bar(bar_date, open, high, low, close, volume),
            ..reversed
          ])
        _, _ -> Error(InvalidBar(index))
      }
  }
}

fn validate_order(values: List(Bar), index: Int) -> Result(Nil, DecodeError) {
  case values {
    [] | [_] -> Ok(Nil)
    [first, second, ..rest] ->
      case date.compare(first.date, second.date) {
        Lt -> validate_order([second, ..rest], index + 1)
        Eq | Gt -> Error(RowsNotStrictlyAscending(index + 1))
      }
  }
}

fn parse_date(value: String) -> Result(time.Date, Nil) {
  case string.split(value, "-") {
    [year, month, day] -> {
      use year <- result.try(int.parse(year) |> result.map_error(fn(_) { Nil }))
      use month <- result.try(
        int.parse(month) |> result.map_error(fn(_) { Nil }),
      )
      use day <- result.try(int.parse(day) |> result.map_error(fn(_) { Nil }))
      time.date(year, month, day) |> result.map_error(fn(_) { Nil })
    }
    _ -> Error(Nil)
  }
}

fn valid_numeric_lexeme(value: String) -> Bool {
  case decimal.parse(value) {
    Ok(_) -> True
    Error(_) -> False
  }
}
