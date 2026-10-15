import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { atomicPlayWritesEnabled, browserPlayWrites } from '../services/browserPlayWrites'
import { PlayWriteCoordinator } from '../services/playWriteCoordinator'

export function usePlayWrites() {
  const { user } = useAuth()
  const actor = user?.id ?? ''
  const admin = user?.app_metadata?.role === 'admin'
  const [api] = useState(browserPlayWrites)
  const coordinator = useMemo(() => new PlayWriteCoordinator(actor, api, atomicPlayWritesEnabled && admin), [actor, admin, api])
  useEffect(() => { void coordinator.initialize(); return () => coordinator.close() }, [coordinator])
  const state = useSyncExternalStore(coordinator.subscribe, coordinator.snapshot)
  return { actor, api, coordinator, state, blocked: state.phase !== 'ready' }
}
