import { Q as parseBigIntAwareJson } from './main.js';

/**
 * @license
 * Copyright 2025-2026 Open Home Foundation
 * SPDX-License-Identifier: Apache-2.0
 */
function parseJsonPayload(text) {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      error: "Payload must not be empty"
    };
  }
  try {
    return {
      ok: true,
      value: parseBigIntAwareJson(trimmed)
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export { isPlainObject as i, parseJsonPayload as p };
