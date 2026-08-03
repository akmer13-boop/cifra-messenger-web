const DEFAULT_MAX_DIRECTORY_PAGES = 100;

/**
 * Loads a cursor-based directory without silently truncating it to one page.
 * Cursor cycles and unreasonable page counts fail closed instead of looping.
 */
export async function collectDirectoryPages(
  fetchPage,
  { maxPages = DEFAULT_MAX_DIRECTORY_PAGES } = {},
) {
  if (typeof fetchPage !== "function") {
    throw new TypeError("fetchPage must be a function");
  }
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new RangeError("maxPages must be a positive integer");
  }

  const items = [];
  const seenItemIds = new Set();
  const seenCursors = new Set();
  let cursor = null;

  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const page = await fetchPage(cursor);
    if (!page || !Array.isArray(page.items)) {
      throw new TypeError("directory page must contain an items array");
    }

    for (const item of page.items) {
      const itemId = typeof item?.id === "string" ? item.id : "";
      if (!itemId || seenItemIds.has(itemId)) continue;
      seenItemIds.add(itemId);
      items.push(item);
    }

    const nextCursor =
      typeof page.next_cursor === "string" && page.next_cursor
        ? page.next_cursor
        : null;
    if (!nextCursor) {
      return { items, next_cursor: null };
    }
    if (seenCursors.has(nextCursor)) {
      throw new Error("directory cursor cycle detected");
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  throw new Error("directory page limit exceeded");
}
