export type FetchPageResult<T> = {
  data: T[] | null;
  error: { message?: string; code?: string } | null;
};

export async function fetchAllPages<T>(
  fetchPage: (rangeStart: number, rangeEnd: number) => PromiseLike<FetchPageResult<T>>,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);

    if (error) {
      const message = typeof error.message === "string" && error.message.trim().length > 0
        ? error.message
        : "Failed to fetch paginated rows.";
      throw new Error(message);
    }

    if (!data || data.length === 0) {
      break;
    }

    rows.push(...data);
    if (data.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return rows;
}
