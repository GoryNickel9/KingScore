// PostgREST tronca in silenzio le risposte oltre db-max-rows (1000 righe
// su Supabase) a prescindere dal limit richiesto: un `.limit(10000)` NON
// alza il cap. Unica difesa: richiedere il count esatto e scaricare tutte
// le pagine finché non è coperto.
const PAGE_SIZE = 1000

type PageLoader<T> = (
  from: number,
  to: number
) => PromiseLike<{ data: T[] | null; count: number | null; error: unknown }>

export const fetchAllPages = async <T,>(buildPage: PageLoader<T>): Promise<T[]> => {
  const rows: T[] = []
  let from = 0
  for (;;) {
    const { data, count, error } = await buildPage(from, from + PAGE_SIZE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    rows.push(...data)
    from += data.length
    if ((count !== null && from >= count) || data.length < PAGE_SIZE) break
  }
  return rows
}
