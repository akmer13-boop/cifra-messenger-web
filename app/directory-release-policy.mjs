const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_QUERY_LENGTH = 96;

export function normalizeDirectoryQuery(
  value,
  maxLength = DEFAULT_MAX_QUERY_LENGTH,
) {
  if (!Number.isInteger(maxLength) || maxLength < 1) {
    throw new RangeError("maxLength must be a positive integer");
  }
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, maxLength)
    : "";
}

/**
 * @param {any[]} currentItems
 * @param {{items: any[], next_cursor?: string|null}} page
 * @param {{requestedCursor?: string|null, seenCursors?: Set<string>}} options
 * @returns {{items: any[], next_cursor: string|null}}
 */
export function mergeDirectoryPage(
  currentItems,
  page,
  { requestedCursor = null, seenCursors = new Set() } = {},
) {
  if (!Array.isArray(currentItems)) {
    throw new TypeError("currentItems must be an array");
  }
  if (!page || !Array.isArray(page.items)) {
    throw new TypeError("directory page must contain an items array");
  }

  const items = [];
  const itemIndex = new Map();
  for (const item of [...currentItems, ...page.items]) {
    const id = typeof item?.id === "string" ? item.id : "";
    if (!id) continue;
    const existingIndex = itemIndex.get(id);
    if (existingIndex === undefined) {
      itemIndex.set(id, items.length);
      items.push(item);
    } else {
      items[existingIndex] = item;
    }
  }

  const nextCursor =
    typeof page.next_cursor === "string" && page.next_cursor
      ? page.next_cursor
      : null;
  if (
    nextCursor &&
    (nextCursor === requestedCursor || seenCursors.has(nextCursor))
  ) {
    throw new Error("directory cursor cycle detected");
  }

  return { items, next_cursor: nextCursor };
}

export function createDirectoryRequestEpoch() {
  let current = 0;
  return Object.freeze({
    next() {
      current += 1;
      return current;
    },
    isCurrent(epoch) {
      return epoch === current;
    },
    invalidate() {
      current += 1;
    },
  });
}

export function clampDirectoryPageSize(value) {
  if (!Number.isInteger(value)) return DEFAULT_PAGE_SIZE;
  return Math.min(DEFAULT_PAGE_SIZE, Math.max(1, Number(value)));
}

export function calculateDirectoryWindow(
  itemCount,
  scrollTop,
  viewportHeight,
  rowHeight = 68,
  overscan = 6,
) {
  const safeItemCount = Math.max(0, Math.floor(Number(itemCount) || 0));
  const safeRowHeight = Math.max(1, Number(rowHeight) || 68);
  const safeOverscan = Math.max(0, Math.floor(Number(overscan) || 0));
  const firstVisible = Math.floor(
    Math.max(0, Number(scrollTop) || 0) / safeRowHeight,
  );
  const visibleCount = Math.ceil(
    Math.max(safeRowHeight, Number(viewportHeight) || safeRowHeight) /
      safeRowHeight,
  );
  const start = Math.max(0, firstVisible - safeOverscan);
  const end = Math.min(
    safeItemCount,
    firstVisible + visibleCount + safeOverscan,
  );
  return {
    start,
    end,
    offset: start * safeRowHeight,
    totalHeight: safeItemCount * safeRowHeight,
  };
}
