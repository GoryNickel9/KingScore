import type { GameRuleConfig } from '../utils/elo/gameRules'

interface Props {
  value: GameRuleConfig
  onChange: (value: GameRuleConfig) => void
  disabled?: boolean
}

export function GameRulesFields({ value, onChange, disabled }: Props) {
  return (
    <fieldset disabled={disabled} className="space-y-2 rounded-lg border border-slate-600 p-3">
      <legend className="px-1 text-sm font-medium text-slate-300">Regole di classifica</legend>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-white">
        <input type="checkbox" checked={value.lower_score_wins}
          onChange={e => onChange({ ...value, lower_score_wins: e.target.checked })}
          className="h-5 w-5 shrink-0 accent-emerald-500" />
        Vince il punteggio più basso
      </label>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-white">
        <input type="checkbox" checked={value.shared_score_positions}
          onChange={e => onChange({ ...value, shared_score_positions: e.target.checked })}
          className="h-5 w-5 shrink-0 accent-emerald-500" />
        Punteggi uguali condividono la posizione
      </label>
      <p className="text-xs text-slate-400">Le parità condivise usano posizioni 1, 2, 2, 4. Se disattivi l’opzione, a pari punteggio si conservano le posizioni importate; nei nuovi inserimenti manuali vale l’ordine dei giocatori.</p>
    </fieldset>
  )
}
