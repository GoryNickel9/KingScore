# nightly-elo-recalc

Job notturno che ricalcola automaticamente tutti i rating ELO (per gioco, Generali e cache `elo_history`) una volta al giorno a mezzanotte, ora italiana. Piano completo in `docs/automazione-aggiornamento-elo-notturno.md`.

## Come funziona

- Per ogni utente con almeno una partita: unica lettura bulk → simulazione in memoria → scritture massive (~6-10 richieste totali per utente).
- L'algoritmo è **condiviso con il frontend**: importa `src/utils/elo/recalc.ts`, che a sua volta usa il core puro `src/utils/elo/simulation.ts`. Nessuna duplicazione della logica di calcolo.
- Usa la **service role key** (env nativa dell'Edge runtime) che bypassa RLS: filtra sempre per `user_id`.
- Ogni esecuzione è registrata in `elo_recalc_runs` (tabella creata dalla migrazione `add_elo_recalc_runs.sql`), che fa anche da guardia anti-sovrapposizione.
- Accetta solo JWT con `role = service_role`: le invocazioni pianificate dalla dashboard usano proprio quel token; l'anon key viene rifiutata con 403.

## Prerequisiti (una volta sola)

1. Applicare la migrazione `supabase/migrations/add_elo_recalc_runs.sql` (da dashboard: SQL Editor → incolla → Run, oppure `supabase db push`).

## Deploy

```bash
supabase functions deploy nightly-elo-recalc
```

> Nota: la funzione importa `recalc.ts` da fuori della cartella `functions/`.
> Il bundler della CLI Supabase (esbuild) lo segue automaticamente; serve una
> CLI non antica (v1.120+). Se il deploy dovesse lamentarsi dell'import,
> fallback manuale: copiare `src/utils/elo/recalc.ts` e
> `src/utils/elo/simulation.ts` accanto a `index.ts` e correggere i path
> (segnalandolo in un commento, per tenere traccia della divergenza).

## Pianificazione (dashboard, consigliata)

1. Supabase Dashboard → **Edge Functions** → `nightly-elo-recalc` → **Schedules** (o *Integrations → Cron*).
2. Nuovo schedule: **ogni giorno alle 00:00**, timezone **Europe/Rome**.

Con il timezone esplicito non c'è nessun problema di ora legale: il job parte sempre a mezzanotte italiana. La dashboard genera in automatico la entry `pg_cron` corrispondente (visibile in *Database → Cron*).

## Test manuale

Dalla dashboard (Edge Functions → `nightly-elo-recalc` → *Test with a curl command*) oppure da terminale:

```bash
curl -X POST 'https://<PROJECT_REF>.supabase.co/functions/v1/nightly-elo-recalc' \
  -H 'Authorization: Bearer <SERVICE_ROLE_KEY>'
```

Risposta attesa: `{ "ok": true, "users": N, "results": [...] }` con il riepilogo per utente (partite processate, giochi, righe di storico, durata). Una seconda chiamata immediata risponde `skipped: true` (guardia anti-sovrapposizione).

## Verifiche post-esecuzione

- `elo_recalc_runs`: ultima riga con `status = 'succeeded'` e `summary` popolato.
- Pagina **Stats** dell'app: apre usando la cache rigenerata, senza ricalcoli visibili.
- Pagina **Rating ELO**: valori coerenti col pulsante "Ricalcola Tutti gli ELO".

## Parità dei risultati

La pipeline è la stessa del pulsante manuale, verificata da `npm run compare:elo` (golden test che confronta l'algoritmo storico con il nuovo core sui dati reali).
