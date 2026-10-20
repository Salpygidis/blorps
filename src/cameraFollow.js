/**
 * Look-at point while a slime hops.
 * `t` is 0 on the start hex and 1 on the landing hex, already eased by the hop tween.
 * The camera rises with the jump, then settles back to the board.
 */
export function hopLookPoint(from, to, t, arcHeight = 0.55) {
  const arc = Math.sin(Math.max(0, Math.min(1, t)) * Math.PI) * arcHeight;
  const u = Math.max(0, Math.min(1, t));
  return {
    x: from.x + (to.x - from.x) * u,
    y: arc * 0.45,
    z: from.z + (to.z - from.z) * u,
  };
}
