import { useState } from 'react'
import { Download } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { fetchAndroidApk } from '../services/androidDownload'

export default function AndroidDownloadButton() {
  const { user } = useAuth()
  const [downloading, setDownloading] = useState(false)
  if (!user) return null

  async function download() {
    if (downloading) return
    setDownloading(true)
    try {
      const { data, error } = await supabase.auth.getSession()
      if (error || !data.session) throw new Error('Accedi di nuovo a KingScore.')
      const apk = await fetchAndroidApk(data.session.access_token)
      const url = URL.createObjectURL(apk)
      const link = document.createElement('a')
      link.href = url
      link.download = 'KingScore.apk'
      document.body.appendChild(link)
      link.click()
      link.remove()
      // Give Android browsers time to start saving the file before releasing the Blob.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      toast.success('APK scaricato. Aprilo per avviare l’installazione Android.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Download non riuscito. Riprova.')
    } finally { setDownloading(false) }
  }

  return (
    <button type="button" onClick={() => void download()} disabled={downloading} aria-busy={downloading}
      className="flex min-h-11 w-full items-center gap-3 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-600 hover:text-white focus-visible:outline-2 focus-visible:outline-emerald-400 disabled:cursor-wait disabled:opacity-60">
      <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span role="status">{downloading ? 'Download APK in corso…' : 'Scarica Android'}</span>
    </button>
  )
}
