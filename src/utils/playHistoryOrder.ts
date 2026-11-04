export type PlayHistoryOrder = 'created_at' | 'played_at'

const STORAGE_KEY = 'kingscore:history-order'

export function readPlayHistoryOrder(): PlayHistoryOrder {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'played_at' ? 'played_at' : 'created_at'
  } catch {
    return 'created_at'
  }
}

export function savePlayHistoryOrder(order: PlayHistoryOrder): void {
  try {
    localStorage.setItem(STORAGE_KEY, order)
  } catch {
    // A blocked preference store must not prevent changing the visible order.
  }
}
