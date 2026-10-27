export function read_api_key() {
  return process.env.TWELVE_DATA_API_KEY ?? "";
}

export function read_equibles_api_key() {
  return process.env.EQUIBLES_API_KEY ?? "";
}

export function read_now_milliseconds() {
  return Date.now();
}
