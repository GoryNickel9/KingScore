import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { UserPlus, LockKeyhole } from 'lucide-react'
import { Spinner } from '../components/Spinner'
import { supabase } from '../lib/supabase'

const Register = () => {
  const [name, setName] = useState<string>('')
  const [email, setEmail] = useState<string>('')
  const [password, setPassword] = useState<string>('')
  const [confirmPassword, setConfirmPassword] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)
  const [checkingRegistrationStatus, setCheckingRegistrationStatus] = useState(true)
  const [registrationsOpen, setRegistrationsOpen] = useState(false)
  const { signUp } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    let isCurrent = true
    void Promise.resolve(
      supabase
        .from('registration_settings')
        .select('registrations_open')
        .eq('id', true)
        .single()
        .then(({ data, error }) => {
          if (!isCurrent) return
          if (error) {
            console.error('Error checking registration status:', error)
            setRegistrationsOpen(false)
          } else {
            setRegistrationsOpen(data.registrations_open)
          }
        })
    )
      .catch((error: unknown) => {
        if (!isCurrent) return
        console.error('Error loading registration status:', error)
        setRegistrationsOpen(false)
      })
      .finally(() => {
        if (isCurrent) setCheckingRegistrationStatus(false)
      })

    return () => {
      isCurrent = false
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    if (!registrationsOpen) return

    if (password !== confirmPassword) {
      alert('Le password non coincidono')
      return
    }

    if (password.length < 6) {
      alert('La password deve avere almeno 6 caratteri')
      return
    }

    setLoading(true)

    const { error } = await signUp(email, password, name)
    
    if (!error) {
      void navigate('/login')
    }
    
    setLoading(false)
  }

  if (checkingRegistrationStatus) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-900"><Spinner /></div>
  }

  if (!registrationsOpen) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4">
        <div className="w-full max-w-md space-y-6 rounded-xl bg-slate-800 p-8 text-center shadow-lg">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/15">
            <LockKeyhole className="h-7 w-7 text-amber-300" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Registrazioni chiuse</h1>
            <p className="mt-2 text-slate-400">Al momento non è possibile creare un nuovo account.</p>
          </div>
          <Link to="/login" className="inline-flex rounded-lg bg-emerald-500 px-5 py-3 font-medium text-white transition hover:bg-emerald-600">
            Accedi
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 px-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <img src="/kingscore-icon-192.png" alt="" width={72} height={72} className="h-18 w-18 rounded-xl" />
          </div>
          <h2 className="text-3xl font-bold text-white">KingScore</h2>
          <p className="mt-2 text-slate-400">Crea il tuo account</p>
        </div>

        <form className="mt-8 space-y-6 bg-slate-800 p-8 rounded-xl shadow-lg" onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-slate-300 mb-2">
                Nome
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                value={name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
                className="appearance-none relative block w-full px-4 py-3 border border-slate-600 rounded-lg bg-slate-700 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
                placeholder="Il tuo nome"
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-300 mb-2">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                value={email}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                className="appearance-none relative block w-full px-4 py-3 border border-slate-600 rounded-lg bg-slate-700 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
                placeholder="la tua@email.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-300 mb-2">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                value={password}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                className="appearance-none relative block w-full px-4 py-3 border border-slate-600 rounded-lg bg-slate-700 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
                placeholder="••••••••"
              />
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-300 mb-2">
                Conferma Password
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                required
                value={confirmPassword}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirmPassword(e.target.value)}
                className="appearance-none relative block w-full px-4 py-3 border border-slate-600 rounded-lg bg-slate-700 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
                placeholder="••••••••"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex justify-center py-3 px-4 border border-transparent rounded-lg text-white bg-emerald-500 hover:bg-emerald-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="flex items-center">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Registrazione in corso...
              </span>
            ) : (
              <span className="flex items-center">
                <UserPlus className="w-5 h-5 mr-2" />
                Registrati
              </span>
            )}
          </button>
        </form>

        <p className="text-center text-slate-400">
          Hai già un account?{' '}
          <Link to="/login" className="text-emerald-500 hover:text-emerald-400 font-medium transition">
            Accedi
          </Link>
        </p>
      </div>
    </div>
  )
}

export default Register
