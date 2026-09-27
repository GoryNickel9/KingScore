import { useEffect, useState } from 'react'
import { ImagePlus, LockKeyhole, Mail, Trash2, UserRound } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../contexts/AuthContext'
import { Spinner } from '../components/Spinner'
import { supabase } from '../lib/supabase'
import { deletePlayerImage, getPlayerImageUrl, uploadPlayerImage } from '../utils/imageUpload'
import type { DbPlayer } from '../types/rows'

type ProfilePlayer = Pick<DbPlayer, 'id' | 'name' | 'alias' | 'avatar_url'>

const Settings = () => {
  const { user } = useAuth()
  const [profile, setProfile] = useState<ProfilePlayer | null>(null)
  const [loading, setLoading] = useState(true)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [savingAvatar, setSavingAvatar] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [savingEmail, setSavingEmail] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)

  useEffect(() => {
    if (!user) {
      setLoading(false)
      return
    }

    let isCurrent = true
    void Promise.resolve(
      supabase
        .from('players')
        .select('id, name, alias, avatar_url')
        .eq('account_user_id', user.id)
        .maybeSingle()
        .then(({ data, error }) => {
          if (!isCurrent) return
          if (error) {
            console.error('Error loading linked player profile:', error)
            toast.error('Impossibile caricare il profilo giocatore')
          } else {
            setProfile(data)
          }
        })
    )
      .finally(() => {
        if (isCurrent) setLoading(false)
      })

    return () => {
      isCurrent = false
    }
  }, [user])

  useEffect(() => () => {
    if (avatarPreview?.startsWith('blob:')) URL.revokeObjectURL(avatarPreview)
  }, [avatarPreview])

  const handleAvatarSelection = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0] ?? null
    if (!file) return
    if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      toast.error('Scegli un’immagine JPG, PNG, WebP o GIF')
      event.target.value = ''
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('L’immagine deve pesare al massimo 2 MB')
      event.target.value = ''
      return
    }
    setAvatarFile(file)
    setAvatarPreview(URL.createObjectURL(file))
  }

  const updateAuthAvatar = async (path: string | null): Promise<boolean> => {
    try {
      const { error } = await supabase.auth.updateUser({
        data: { ...user?.user_metadata, avatar_url: path }
      })
      if (error) throw error
      return true
    } catch (error) {
      console.error('Error updating account avatar metadata:', error)
      return false
    }
  }

  const removeOwnedAvatarFile = (path: string | null): void => {
    if (!path || !user || !path.startsWith(`${user.id}/`)) return
    void deletePlayerImage(supabase, path).catch((error: unknown) => {
      console.warn('Could not remove the previous profile image:', error)
    })
  }

  const saveAvatar = async (): Promise<void> => {
    if (!user || !profile || !avatarFile) return
    setSavingAvatar(true)

    let uploadedPath: string | null = null
    try {
      const upload = await uploadPlayerImage(supabase, avatarFile, user.id)
      uploadedPath = upload.path

      const { data, error } = await supabase
        .from('players')
        .update({ avatar_url: uploadedPath })
        .eq('id', profile.id)
        .eq('account_user_id', user.id)
        .select('id, name, alias, avatar_url')
        .single()

      if (error) throw error
      const metadataUpdated = await updateAuthAvatar(uploadedPath)
      setProfile(data)
      setAvatarFile(null)
      setAvatarPreview(null)
      removeOwnedAvatarFile(profile.avatar_url)
      toast.success(metadataUpdated
        ? 'Immagine del profilo aggiornata'
        : 'Immagine salvata; aggiorna la pagina per vederla nel menu')
    } catch (error) {
      console.error('Error saving profile image:', error)
      if (uploadedPath) removeOwnedAvatarFile(uploadedPath)
      toast.error('Impossibile aggiornare l’immagine del profilo')
    } finally {
      setSavingAvatar(false)
    }
  }

  const removeAvatar = async (): Promise<void> => {
    if (!user || !profile?.avatar_url) return
    setSavingAvatar(true)
    try {
      const oldPath = profile.avatar_url
      const { data, error } = await supabase
        .from('players')
        .update({ avatar_url: null })
        .eq('id', profile.id)
        .eq('account_user_id', user.id)
        .select('id, name, alias, avatar_url')
        .single()

      if (error) throw error
      const metadataUpdated = await updateAuthAvatar(null)
      setProfile(data)
      removeOwnedAvatarFile(oldPath)
      toast.success(metadataUpdated
        ? 'Immagine del profilo rimossa'
        : 'Immagine rimossa; aggiorna la pagina per vedere il menu aggiornato')
    } catch (error) {
      console.error('Error removing profile image:', error)
      toast.error('Impossibile rimuovere l’immagine del profilo')
    } finally {
      setSavingAvatar(false)
    }
  }

  const updateEmail = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const email = newEmail.trim()
    if (!email || email.toLowerCase() === user?.email?.toLowerCase()) {
      toast.error('Inserisci un indirizzo email diverso da quello attuale')
      return
    }

    setSavingEmail(true)
    try {
      const { error } = await supabase.auth.updateUser({ email })
      if (error) throw error
      setNewEmail('')
      toast.success('Richiesta inviata: conferma il nuovo indirizzo dalla tua email')
    } catch (error) {
      console.error('Error updating account email:', error)
      toast.error('Impossibile aggiornare l’email')
    } finally {
      setSavingEmail(false)
    }
  }

  const updatePassword = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (newPassword.length < 6) {
      toast.error('La password deve contenere almeno 6 caratteri')
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error('Le password non coincidono')
      return
    }

    setSavingPassword(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
      setNewPassword('')
      setConfirmPassword('')
      toast.success('Password aggiornata')
    } catch (error) {
      console.error('Error updating account password:', error)
      toast.error('Impossibile aggiornare la password')
    } finally {
      setSavingPassword(false)
    }
  }

  if (loading) return <Spinner className="h-64" />

  const profileImageUrl = avatarPreview || (profile?.avatar_url ? getPlayerImageUrl(supabase, profile.avatar_url) : null)

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-white">Impostazioni</h1>
        <p className="mt-2 text-slate-400">Gestisci l’immagine del profilo, l’email e la password del tuo account.</p>
      </header>

      <section className="rounded-xl border border-slate-700 bg-slate-800 p-6 shadow-md">
        <div className="flex items-center gap-3">
          <UserRound className="h-5 w-5 text-emerald-400" />
          <div>
            <h2 className="font-semibold text-white">Immagine del profilo</h2>
            <p className="text-sm text-slate-400">
              {profile ? (profile.alias || profile.name) : 'Il tuo account non è ancora collegato a un giocatore'}
            </p>
          </div>
        </div>

        {profile ? (
          <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-center">
            <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-700">
              {profileImageUrl ? (
                <img src={profileImageUrl} alt="Anteprima immagine del profilo" className="h-full w-full object-cover" />
              ) : (
                <UserRound className="h-10 w-10 text-slate-400" />
              )}
            </div>
            <div className="space-y-3">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700">
                <ImagePlus className="h-4 w-4" />
                Scegli immagine
                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handleAvatarSelection} className="sr-only" />
              </label>
              <p className="text-xs text-slate-500">JPG, PNG, WebP o GIF · massimo 2 MB</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void saveAvatar()} disabled={!avatarFile || savingAvatar} className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50">
                  {savingAvatar ? 'Salvataggio…' : 'Salva immagine'}
                </button>
                {profile.avatar_url && (
                  <button type="button" onClick={() => void removeAvatar()} disabled={savingAvatar} className="inline-flex items-center gap-2 rounded-lg border border-red-400/30 px-4 py-2 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-50">
                    <Trash2 className="h-4 w-4" />Rimuovi
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <p className="mt-4 rounded-lg border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-200">
            L’amministratore deve collegare il tuo account a un giocatore esistente prima che tu possa cambiare l’immagine.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-slate-700 bg-slate-800 p-6 shadow-md">
        <div className="flex items-center gap-3">
          <Mail className="h-5 w-5 text-emerald-400" />
          <div>
            <h2 className="font-semibold text-white">Email</h2>
            <p className="text-sm text-slate-400">Attuale: {user?.email || 'non disponibile'}</p>
          </div>
        </div>
        <form onSubmit={(event) => void updateEmail(event)} className="mt-5 flex flex-col gap-3 sm:flex-row">
          <input type="email" required value={newEmail} onChange={(event) => setNewEmail(event.target.value)} placeholder="Nuovo indirizzo email" autoComplete="email" className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none" />
          <button type="submit" disabled={savingEmail || !newEmail.trim()} className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50">
            {savingEmail ? 'Invio…' : 'Aggiorna email'}
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-slate-700 bg-slate-800 p-6 shadow-md">
        <div className="flex items-center gap-3">
          <LockKeyhole className="h-5 w-5 text-emerald-400" />
          <div>
            <h2 className="font-semibold text-white">Password</h2>
            <p className="text-sm text-slate-400">Scegli una nuova password di almeno 6 caratteri.</p>
          </div>
        </div>
        <form onSubmit={(event) => void updatePassword(event)} className="mt-5 grid gap-3 sm:grid-cols-2">
          <input type="password" required minLength={6} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="Nuova password" autoComplete="new-password" className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none" />
          <input type="password" required minLength={6} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Conferma password" autoComplete="new-password" className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none" />
          <button type="submit" disabled={savingPassword || !newPassword || !confirmPassword} className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50 sm:col-span-2 sm:justify-self-start">
            {savingPassword ? 'Aggiornamento…' : 'Aggiorna password'}
          </button>
        </form>
      </section>
    </div>
  )
}

export default Settings
