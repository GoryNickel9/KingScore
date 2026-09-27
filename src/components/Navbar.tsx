import { Link, useLocation } from 'react-router-dom'
import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { Gamepad2, LayoutDashboard, Calendar, Library, Users, FileText, BarChart3, LogOut, User, Download, Trophy, LogIn, Image as ImageIcon, ChevronDown, Sparkles, ShieldCheck } from 'lucide-react'
import type { NavItem } from '../types'
import { PLAYER_COUNT_BUCKETS, PLAYER_COUNT_BUCKET_ORDER } from '../utils/elo/playerCountElo'

const publicNavItems: NavItem[] = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/plays', icon: Calendar, label: 'Partite' },
  { path: '/stats', icon: BarChart3, label: 'Statistiche' },
  { path: '/elo', icon: Trophy, label: 'Rating ELO' },
  { path: '/wrapped', icon: Sparkles, label: 'Wrapped' },
]

const profileNavItems: NavItem[] = [
  { path: '/games', icon: Library, label: 'Giochi' },
  { path: '/images', icon: ImageIcon, label: 'Immagini' },
  { path: '/plays/new', icon: FileText, label: 'Aggiungi Partita' },
  { path: '/players', icon: Users, label: 'Giocatori' },
  { path: '/import', icon: Download, label: 'Import' },
]

const adminNavItem: NavItem = { path: '/admin', icon: ShieldCheck, label: 'Admin' }

function isActive(pathname: string, path: string): boolean {
  return pathname === path
}

const Navbar = () => {
  const { user, signOut } = useAuth()
  const visibleProfileNavItems = user?.app_metadata?.role === 'admin'
    ? [...profileNavItems, adminNavItem]
    : profileNavItems
  const location = useLocation()
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false)
  const [isStatsSubmenuOpen, setIsStatsSubmenuOpen] = useState<boolean>(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Chiudi il sottomenu mobile di Statistiche a ogni cambio pagina
  const [prevPathname, setPrevPathname] = useState(location.pathname)
  if (prevPathname !== location.pathname) {
    setPrevPathname(location.pathname)
    setIsStatsSubmenuOpen(false)
  }

  // Chiudi il dropdown quando si clicca fuori
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <nav className="bg-slate-800 border-b border-slate-700 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center space-x-2">
            <div className="bg-emerald-500 p-2 rounded-lg">
              <Gamepad2 className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-bold text-white">KingScore</span>
          </Link>

          {/* Navigation Links */}
          <div className="hidden md:flex items-center space-x-1">
            {publicNavItems.map((item) => {
              // Voce "Statistiche": link diretto + dropdown al passaggio del
              // mouse con le statistiche per numero di giocatori
              if (item.path === '/stats') {
                const statsActive =
                  location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)
                return (
                  <div key={item.path} className="relative group">
                    <Link
                      to={item.path}
                      className={`flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium transition ${
                        statsActive
                          ? 'bg-emerald-500 text-white'
                          : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                      }`}
                    >
                      <item.icon className="w-4 h-4" />
                      <span>{item.label}</span>
                      <ChevronDown className="w-3 h-3" />
                    </Link>

                    <div className="absolute left-0 top-full hidden pt-1 group-hover:block z-50">
                      <div className="w-60 bg-slate-700 rounded-lg shadow-lg py-1 border border-slate-600">
                        {PLAYER_COUNT_BUCKET_ORDER.map((bucket) => {
                          const path = `/stats/${bucket}`
                          return (
                            <Link
                              key={bucket}
                              to={path}
                              className={`block px-4 py-2 text-sm font-medium transition ${
                                isActive(location.pathname, path)
                                  ? 'bg-emerald-500 text-white'
                                  : 'text-slate-300 hover:bg-slate-600 hover:text-white'
                              }`}
                            >
                              {PLAYER_COUNT_BUCKETS[bucket].label}
                            </Link>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )
              }

              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium transition ${
                    isActive(location.pathname, item.path)
                      ? 'bg-emerald-500 text-white'
                      : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                  }`}
                >
                  <item.icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </Link>
              )
            })}
          </div>

          {/* User Menu */}
          <div className="flex items-center space-x-4">
            {user ? (
              <div className="relative" ref={dropdownRef}>
                {/* User Profile Button */}
                <button
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                  className="flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition"
                >
                  <div className="bg-slate-700 p-2 rounded-full">
                    <User className="w-5 h-5 text-slate-300" />
                  </div>
                  <span className="hidden sm:block">
                    {user?.user_metadata?.name || user?.email}
                  </span>
                  <ChevronDown className={`w-4 h-4 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                {/* Dropdown Menu */}
                {isDropdownOpen && (
                  <div className="absolute right-0 mt-2 w-56 bg-slate-700 rounded-lg shadow-lg py-1 border border-slate-600">
                    <div className="px-4 py-2 border-b border-slate-600">
                      <p className="text-xs text-slate-400 uppercase tracking-wider">Menu Profilo</p>
                    </div>
                    {visibleProfileNavItems.map((item) => (
                      <Link
                        key={item.path}
                        to={item.path}
                        onClick={() => setIsDropdownOpen(false)}
                        className={`flex items-center space-x-3 px-4 py-2 text-sm font-medium transition ${
                          isActive(location.pathname, item.path)
                            ? 'bg-emerald-500 text-white'
                            : 'text-slate-300 hover:bg-slate-600 hover:text-white'
                        }`}
                      >
                        <item.icon className="w-4 h-4" />
                        <span>{item.label}</span>
                      </Link>
                    ))}
                    <div className="border-t border-slate-600 mt-1 pt-1">
                      <button
                        onClick={() => {
                          void signOut()
                          setIsDropdownOpen(false)
                        }}
                        className="flex items-center space-x-3 w-full px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-600 hover:text-white transition"
                      >
                        <LogOut className="w-4 h-4" />
                        <span>Logout</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <Link
                to="/login"
                className="flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition"
              >
                <LogIn className="w-4 h-4" />
                <span className="hidden sm:inline">Login</span>
              </Link>
            )}
          </div>
        </div>

        {/* Mobile Navigation */}
        <div className="md:hidden pb-4">
          <div className="grid grid-cols-3 gap-2">
            {publicNavItems.map((item) => {
              // Voce "Statistiche": su mobile l'hover non esiste, il tap apre
              // un sottomenu con le statistiche per numero di giocatori
              if (item.path === '/stats') {
                const statsActive =
                  location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)
                return (
                  <button
                    key={item.path}
                    type="button"
                    onClick={() => setIsStatsSubmenuOpen(!isStatsSubmenuOpen)}
                    aria-expanded={isStatsSubmenuOpen}
                    className={`flex flex-col items-center justify-center p-2 rounded-lg text-xs font-medium transition ${
                      statsActive
                        ? 'bg-emerald-500 text-white'
                        : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                    }`}
                  >
                    <item.icon className="w-5 h-5 mb-1" />
                    <span className="flex items-center gap-1">
                      {item.label}
                      <ChevronDown
                        className={`w-3 h-3 transition-transform ${isStatsSubmenuOpen ? 'rotate-180' : ''}`}
                      />
                    </span>
                  </button>
                )
              }

              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex flex-col items-center justify-center p-2 rounded-lg text-xs font-medium transition ${
                    isActive(location.pathname, item.path)
                      ? 'bg-emerald-500 text-white'
                      : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                  }`}
                >
                  <item.icon className="w-5 h-5 mb-1" />
                  <span>{item.label}</span>
                </Link>
              )
            })}
            {user && visibleProfileNavItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`flex flex-col items-center justify-center p-2 rounded-lg text-xs font-medium transition ${
                  isActive(location.pathname, item.path)
                    ? 'bg-emerald-500 text-white'
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
              >
                <item.icon className="w-5 h-5 mb-1" />
                <span>{item.label}</span>
              </Link>
            ))}
          </div>

          {/* Sottomenu Statistiche per numero di giocatori (su mobile non c'è hover) */}
          {isStatsSubmenuOpen && (
            <div className="mt-2 bg-slate-700 rounded-lg shadow-lg py-1 border border-slate-600">
              <Link
                to="/stats"
                className={`block px-4 py-2 text-sm font-medium transition ${
                  isActive(location.pathname, '/stats')
                    ? 'bg-emerald-500 text-white'
                    : 'text-slate-300 hover:bg-slate-600 hover:text-white'
                }`}
              >
                Generali
              </Link>
              {PLAYER_COUNT_BUCKET_ORDER.map((bucket) => {
                const path = `/stats/${bucket}`
                return (
                  <Link
                    key={bucket}
                    to={path}
                    className={`block px-4 py-2 text-sm font-medium transition ${
                      isActive(location.pathname, path)
                        ? 'bg-emerald-500 text-white'
                        : 'text-slate-300 hover:bg-slate-600 hover:text-white'
                    }`}
                  >
                    {PLAYER_COUNT_BUCKETS[bucket].label}
                  </Link>
                )
              })}
            </div>
          )}
          {user && (
            <div className="mt-2 flex justify-center">
              <button
                onClick={signOut}
                className="flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition"
              >
                <LogOut className="w-4 h-4" />
                <span>Logout</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  )
}

export default Navbar
