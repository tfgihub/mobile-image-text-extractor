export function packageKey(id) {
  return id.toUpperCase();
}

export function samePackage(left, right) {
  const first = packageKey(left);
  const second = packageKey(right);
  return first === second || (Math.min(first.length, second.length) === 4 && first.slice(-4) === second.slice(-4));
}
