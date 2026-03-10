import { createContext, useContext, useEffect, useState, useMemo } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import type { AuthContextType, AuthResult } from '../types'
import type { User } from '@supabase/supabase-js'

const AuthContext = createContext<AuthContextType | null>(null)

interface AuthProviderProps {
  children: ReactNode
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState<boolean>(true)

  useEffect(() => {
    // Controlla la sessione corrente
    const checkSession = async (): Promise<void> => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        setUser(session?.user ?? null)
      } catch (error) {
        console.error('Errore Supabase:', error)
        toast.error('Errore di connessione con Supabase. Verifica le credenziali.')
      } finally {
        setLoading(false)
      }
    }

    checkSession()

    // Ascolta i cambiamenti di autenticazione
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signUp = async (email: string, password: string, name: string): Promise<AuthResult> => {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            name,
          },
        },
      })

      if (error) throw error

      toast.success('Registrazione completata! Controlla la tua email.')
      return { data, error: null }
    } catch (error) {
      toast.error((error as Error).message)
      return { data: null, error: error as Error }
    }
  }

  const signIn = async (email: string, password: string): Promise<AuthResult> => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) throw error

      toast.success('Login effettuato con successo!')
      return { data, error: null }
    } catch (error) {
      toast.error((error as Error).message)
      return { data: null, error: error as Error }
    }
  }

  const signOut = async (): Promise<void> => {
    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error

      toast.success('Logout effettuato con successo!')
      setUser(null)
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  const value = useMemo(
    () => ({ user, loading, signUp, signIn, signOut }),
    [user, loading, signUp, signIn, signOut]
  )

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth deve essere usato all\'interno di AuthProvider')
  }
  return context
}
