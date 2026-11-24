// Supabase caps each select at the project's "max rows" (1000 by default) and
// silently drops the rest. Payroll totals must never be computed from a
// truncated list, so long queries page through with .range() until a page
// comes back empty. The query must have a stable order (e.g. .order("id")).

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

export async function fetchAll<T>(page: (from: number, to: number) => Page<T>, size = 1000): Promise<T[]> {
  const rows: T[] = [];
  // Advance by what actually came back, in case the server cap is below `size`
  for (;;) {
    const { data, error } = await page(rows.length, rows.length + size - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return rows;
    rows.push(...data);
  }
}
