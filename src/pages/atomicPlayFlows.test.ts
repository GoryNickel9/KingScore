import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import AddPlay from './AddPlay'
import EditPlay from './EditPlay'
import PlayDetail from './PlayDetail'
import { PlayWriteError } from '../services/playWrites'

// Exercise the real event callbacks with persistent hook state, without a DOM.
// Rendering, focus, browser validation and accessibility need separate browser tests.
const harness = vi.hoisted(() => ({
  states: [] as unknown[], refs: [] as { current: unknown }[],
  effects: [] as { callback: () => void | (() => void); deps: readonly unknown[] | undefined; cleanup?: () => void; pending: boolean }[],
  stateCursor: 0, refCursor: 0, effectCursor: 0,
  seed: (value: unknown): unknown => value,
  actorId: '10000000-0000-0000-0000-000000000001',
  playId: '20000000-0000-0000-0000-000000000001',
  create: vi.fn(), update: vi.fn(), remove: vi.fn(), editor: vi.fn(),
  recalc: vi.fn(), invalidate: vi.fn(), navigate: vi.fn(), from: vi.fn(),
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => {
      const index = harness.stateCursor++
      if (!(index in harness.states)) {
        const value = typeof initial === 'function' ? (initial as () => T)() : initial
        harness.states[index] = harness.seed(value)
      }
      return [harness.states[index] as T, (next: T | ((previous: T) => T)) => {
        harness.states[index] = typeof next === 'function'
          ? (next as (previous: T) => T)(harness.states[index] as T) : next
      }]
    },
    useRef: <T,>(initial: T) => {
      const index = harness.refCursor++
      return harness.refs[index] ?? (harness.refs[index] = { current: initial })
    },
    useEffect: (callback: () => void | (() => void), deps: readonly unknown[] | undefined) => {
      const index = harness.effectCursor++
      const previous = harness.effects[index]
      const changed = !previous || !deps || !previous.deps ||
        deps.length !== previous.deps.length || deps.some((value, i) => !Object.is(value, previous.deps?.[i]))
      if (changed) harness.effects[index] = { callback, deps, cleanup: previous?.cleanup, pending: true }
    },
  }
})

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: harness.actorId, app_metadata: { role: 'admin' } } }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => harness.navigate, useParams: () => ({ id: harness.playId }), Link: 'a' }))
vi.mock('../lib/supabase', () => ({ supabase: { from: harness.from } }))
vi.mock('../services/playWrites', async importOriginal => ({
  ...await importOriginal<typeof import('../services/playWrites')>(),
  atomicPlayWritesEnabled: true,
  createPlay: harness.create, updatePlay: harness.update, deletePlay: harness.remove, getPlayEditor: harness.editor,
}))
vi.mock('../services/games', () => ({ listGames: vi.fn().mockResolvedValue([]), createGame: vi.fn() }))
vi.mock('../services/players', () => ({ listUserPlayers: vi.fn().mockResolvedValue([]), createPlayer: vi.fn() }))
vi.mock('../utils/imageUpload', () => ({ uploadGameImage: vi.fn(), compressImage: vi.fn(), getPlayerImageUrl: vi.fn() }))
vi.mock('../utils/elo/recalc', () => ({ performFullRecalc: harness.recalc }))
vi.mock('../utils/eloCalculator', () => ({
  invalidateELOHistory: harness.invalidate,
  getELOHistoryForGame: vi.fn().mockResolvedValue([]), getGeneralELO: vi.fn().mockResolvedValue(null),
  getGeneralELOHistory: vi.fn().mockResolvedValue([]),
}))
vi.mock('react-hot-toast', () => ({ default: harness.toast }))
vi.mock('../components/PlayComments', () => ({ default: () => null }))

const actorId = '10000000-0000-0000-0000-000000000001'
const ownerId = '10000000-0000-0000-0000-000000000009'
const playId = '20000000-0000-0000-0000-000000000001'
const gameId = '30000000-0000-0000-0000-000000000001'
const playerId = '40000000-0000-0000-0000-000000000001'
const scoreId = '50000000-0000-0000-0000-000000000001'
const revision = `v1:${'a'.repeat(64)}`
const exactScore = '9007199254740993.125'

function editorFixture(id = playId, notes = 'Original', rev = revision) {
  return {
    revision: rev,
    detail: {
      play: { id, user_id: ownerId, game_id: gameId, played_at: '2026-10-13', source: 'offline',
        notes, duration_minutes: null, is_cooperative: false, team_won: null, location: null, bga_table_id: null },
      game: { id: gameId, name: 'Azul', image_url: null },
      scores: [{
        score: { id: scoreId, play_id: id, player_id: playerId, score: exactScore, winner: true, color: 'red', role: 'leader', position: 1 },
        player: { id: playerId, name: 'Anna', alias: null, avatar_url: null },
      }],
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function render(component: () => ReactNode): ReactNode {
  harness.stateCursor = 0; harness.refCursor = 0; harness.effectCursor = 0
  return component()
}

function runEffects(): void {
  for (const effect of harness.effects) {
    if (!effect.pending) continue
    effect.pending = false
    effect.cleanup?.()
    const cleanup = effect.callback()
    effect.cleanup = typeof cleanup === 'function' ? cleanup : undefined
  }
}

async function settle(): Promise<void> {
  // Drain chained service promises; no timer or network is involved.
  for (let i = 0; i < 12; i++) await Promise.resolve()
}

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...elements(node.props.children as ReactNode)]
}

function text(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(text).join('')
  return isValidElement<Record<string, unknown>>(node) ? text(node.props.children as ReactNode) : ''
}

function formSubmit(tree: ReactNode): () => Promise<void> {
  const form = elements(tree).find(element => element.type === 'form')
  expect(form).toBeDefined()
  return () => (form!.props.onSubmit as (event: { preventDefault: () => void }) => Promise<void>)({ preventDefault: vi.fn() })
}

function button(tree: ReactNode, label: string): () => void | Promise<void> {
  const matches = elements(tree).filter(candidate => candidate.type === 'button' && text(candidate.props.children as ReactNode).trim() === label)
  const element = matches[matches.length - 1]
  expect(element, `Button ${label}`).toBeDefined()
  return element!.props.onClick as () => void | Promise<void>
}

function seedAddForm(): void {
  harness.seed = value => {
    if (value && typeof value === 'object' && 'gameId' in value && 'playedAt' in value) {
      return { ...value, gameId, gameName: 'Azul', playedAt: '2026-10-13', players: [playerId], notes: 'My draft' }
    }
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
      return { [playerId]: { score: exactScore, winner: true } }
    }
    return value
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  harness.states = []; harness.refs = []; harness.effects = []
  harness.seed = value => value
  harness.actorId = actorId; harness.playId = playId
  harness.create.mockReset().mockResolvedValue({ play_id: playId, revision, replayed: false })
  harness.update.mockReset().mockResolvedValue({ play_id: playId, revision, replayed: false })
  harness.remove.mockReset().mockResolvedValue({ play_id: playId, deleted: true, replayed: false })
  harness.editor.mockReset().mockResolvedValue(editorFixture())
  harness.recalc.mockResolvedValue({}); harness.invalidate.mockResolvedValue(undefined)
  harness.from.mockImplementation((table: string) => {
    const detail = editorFixture().detail
    const query = {
      select: vi.fn(() => query), eq: vi.fn(() => query),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
      single: vi.fn().mockResolvedValue({ data: table === 'plays'
        ? { ...detail.play, games: detail.game, play_scores: detail.scores.map(({ score, player }) => ({ ...score, players: player })) }
        : null, error: null }),
    }
    return query
  })
})

describe('atomic play event callbacks (without DOM)', () => {
  it('AddPlay prevents double submit while saving and preserves an exact decimal payload', async () => {
    seedAddForm()
    const save = deferred<{ play_id: string; revision: string; replayed: boolean }>()
    harness.create.mockReturnValue(save.promise)
    const submit = formSubmit(render(AddPlay))
    const first = submit()
    const second = submit()
    await settle()
    expect(harness.create).toHaveBeenCalledOnce()
    expect(harness.create.mock.calls[0][1].payload.scores[0].score).toBe(exactScore)
    save.resolve({ play_id: playId, revision, replayed: false })
    await Promise.all([first, second])
    expect(harness.navigate).toHaveBeenCalledOnce()
  })

  it('AddPlay manual retry after an unknown outcome reuses the UUID and frozen payload', async () => {
    seedAddForm()
    harness.create.mockRejectedValueOnce(new PlayWriteError('unknown', 'Timeout'))
    await formSubmit(render(AddPlay))()
    const original = harness.create.mock.calls[0][1]
    await button(render(AddPlay), 'Riprova la stessa richiesta')()
    expect(harness.create).toHaveBeenCalledTimes(2)
    expect(harness.create.mock.calls[1][1]).toBe(original)
    expect(harness.create.mock.calls[1][1].requestId).toBe(original.requestId)
    expect(harness.create.mock.calls[1][1].payload.notes).toBe('My draft')
  })

  it('AddPlay retains the pending command if a retry cannot authorize before sending', async () => {
    seedAddForm()
    harness.create.mockRejectedValueOnce(new PlayWriteError('unknown', 'Timeout'))
    harness.create.mockRejectedValueOnce(new PlayWriteError('unavailable', 'Auth network unavailable'))
    await formSubmit(render(AddPlay))()
    const original = harness.create.mock.calls[0][1]
    await button(render(AddPlay), 'Riprova la stessa richiesta')()
    expect(elements(render(AddPlay)).find(element => element.type === 'fieldset')?.props.disabled).toBe(true)
    await button(render(AddPlay), 'Riprova la stessa richiesta')()
    expect(harness.create).toHaveBeenCalledTimes(3)
    expect(harness.create.mock.calls[1][1]).toBe(original)
    expect(harness.create.mock.calls[2][1]).toBe(original)
  })

  it('AddPlay refuses to retry a pending request under another account', async () => {
    seedAddForm()
    harness.create.mockRejectedValueOnce(new PlayWriteError('unknown', 'Timeout'))
    await formSubmit(render(AddPlay))()
    const retry = button(render(AddPlay), 'Riprova la stessa richiesta')
    harness.actorId = ownerId
    const switched = render(AddPlay)
    expect(elements(switched).some(element => element.type === 'form')).toBe(false)
    await retry()
    expect(harness.create).toHaveBeenCalledOnce()
    expect(harness.toast.error).toHaveBeenLastCalledWith(expect.stringContaining('account originale'))
  })

  it('EditPlay ignores an obsolete snapshot after changing the route', async () => {
    const first = deferred<ReturnType<typeof editorFixture>>()
    const second = deferred<ReturnType<typeof editorFixture>>()
    harness.editor.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    void render(EditPlay); runEffects()
    const newerId = '20000000-0000-0000-0000-000000000002'
    harness.playId = newerId
    void render(EditPlay); runEffects()
    second.resolve(editorFixture(newerId, 'Newer draft', `v1:${'b'.repeat(64)}`))
    await settle()
    first.resolve(editorFixture(playId, 'Obsolete draft'))
    await settle()
    await formSubmit(render(EditPlay))()
    expect(harness.update).toHaveBeenCalledOnce()
    expect(harness.update.mock.calls[0][1]).toMatchObject({
      playId: newerId, revision: `v1:${'b'.repeat(64)}`, payload: { notes: 'Newer draft' },
    })
  })

  it('EditPlay retains score IDs, metadata and exact decimals when retrying a pending save', async () => {
    void render(EditPlay); runEffects(); await settle()
    harness.update.mockRejectedValueOnce(new PlayWriteError('unknown', 'Timeout'))
    await formSubmit(render(EditPlay))()
    const original = harness.update.mock.calls[0][1]
    expect(original.payload.scores[0]).toMatchObject({ id: scoreId, score: exactScore, color: 'red', role: 'leader' })
    await button(render(EditPlay), 'Riprova la stessa richiesta')()
    expect(harness.update.mock.calls[1][1]).toBe(original)
    expect(harness.invalidate).toHaveBeenCalledWith(expect.anything(), playId, ownerId)
  })

  it('PlayDetail prevents double delete and recalculates the play owner instead of the admin', async () => {
    void render(PlayDetail); runEffects(); await settle()
    await button(render(PlayDetail), 'Elimina')()
    await settle()
    const deletion = deferred<{ play_id: string; deleted: boolean; replayed: boolean }>()
    harness.remove.mockReturnValue(deletion.promise)
    const remove = button(render(PlayDetail), 'Elimina')
    const first = remove()
    const second = remove()
    await settle()
    expect(harness.remove).toHaveBeenCalledOnce()
    deletion.resolve({ play_id: playId, deleted: true, replayed: false })
    await Promise.all([first, second])
    expect(harness.recalc).toHaveBeenCalledWith(expect.anything(), ownerId)
  })
})
