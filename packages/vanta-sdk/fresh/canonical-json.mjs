/** Canonical UTF-8 input for signed family metadata. Arrays retain their order. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    const fields = Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key]));
    return '{' + fields.join(',') + '}';
  }
  return JSON.stringify(value);
}
