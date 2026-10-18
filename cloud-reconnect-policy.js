'use strict';

function cloudRetryDelay(attempt, random = Math.random) {
  const exponent = Math.max(0, Math.min(5, Number(attempt) || 0));
  const baseDelay = Math.min(30_000, 1000 * (2 ** exponent));
  const jittered = Math.round(baseDelay * (0.75 + random() * 0.5));
  return Math.min(30_000, jittered);
}

module.exports = { cloudRetryDelay };
