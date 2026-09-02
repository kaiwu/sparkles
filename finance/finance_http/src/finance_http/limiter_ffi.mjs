const registryKey = Symbol.for("pi-sparkles.finance-http.limiters.v1");

function registry() {
  globalThis[registryKey] ??= new Map();
  return globalThis[registryKey];
}

export function new_cell(value) {
  return { value };
}

export function shared_cell(scope, value) {
  const limiters = registry();
  if (!limiters.has(scope)) {
    limiters.set(scope, { value });
  }
  return limiters.get(scope);
}

export function read_cell(cell) {
  return cell.value;
}

export function write_cell(cell, value) {
  cell.value = value;
}
