import { Link, useLocation } from 'react-router-dom'
import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { ArrowLeftRight, Gamepad2, LayoutDashboard, Calendar, Library, Users, BarChart3, LogOut, User, Trophy, LogIn, ChevronDown, Sparkles, ShieldCheck, Settings, Menu, X } from 'lucide-react'
import type { NavItem } from '../types'
import { PLAYER_COUNT_BUCKETS, PLAYER_COUNT_BUCKET_ORDER } from '../utils/elo/playerCountElo'
import { getPlayerImageUrl } from '../utils/imageUpload'
import { supabase } from '../lib/supabase'

const publicNavItems: NavItem[] = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/plays', icon: Calendar, label: 'Partite' },
  { path: '/stats', icon: BarChart3, label: 'Statistiche' },
  { path: '/elo', icon: Trophy, label: 'Rating ELO' },
  { path: '/wrapped', icon: Sparkles, label: 'Wrapped' },
]

const profileNavItems: NavItem[] = [
  { path: '/games', icon: Library, label: 'Giochi' },
  { path: '/players', icon: Users, label: 'Giocatori' },
]

const adminNavItem: NavItem = { path: '/admin', icon: ShieldCheck, label: 'Admin' }
const settingsNavItem: NavItem = { path: '/settings', icon: Settings, label: 'Impostazioni' }

function isActive(pathname: string, path: string): boolean {
  return pathname === path
}

const Navbar = () => {
  const { user, signOut } = useAuth()
  const isAdmin = user?.app_metadata?.role === 'admin'
  const visibleProfileNavItems = isAdmin
    ? [...profileNavItems, adminNavItem, settingsNavItem]
    : [settingsNavItem]
  const avatarPath = typeof user?.user_metadata?.avatar_url === 'string'
    ? user.user_metadata.avatar_url
    : null
  const avatarUrl = avatarPath ? getPlayerImageUrl(supabase, avatarPath) : null
  const location = useLocation()
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false)
  const [isDesktopStatsMenuOpen, setIsDesktopStatsMenuOpen] = useState<boolean>(false)
  const [isStatsSubmenuOpen, setIsStatsSubmenuOpen] = useState<boolean>(false)
  const [previousPathname, setPreviousPathname] = useState(location.pathname)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const statsDropdownRef = useRef<HTMLDivElement>(null)

  if (previousPathname !== location.pathname) {
    setPreviousPathname(location.pathname)
    setIsMobileMenuOpen(false)
    setIsDropdownOpen(false)
    setIsDesktopStatsMenuOpen(false)
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

  useEffect(() => {
    const handleStatsMenuClickOutside = (event: MouseEvent): void => {
      if (statsDropdownRef.current && !statsDropdownRef.current.contains(event.target as Node)) {
        setIsDesktopStatsMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleStatsMenuClickOutside)
    return () => document.removeEventListener('mousedown', handleStatsMenuClickOutside)
  }, [])

  return (
    <nav className="bg-slate-800 border-b border-slate-700 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link
            to="/"
            onClick={() => {
              setIsMobileMenuOpen(false)
              setIsStatsSubmenuOpen(false)
            }}
            className="flex items-center space-x-2"
          >
            <div className="bg-emerald-500 p-2 rounded-lg">
              <Gamepad2 className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-bold text-white">KingScore</span>
          </Link>

          {/* Navigation Links */}
          <div className="hidden lg:flex items-center space-x-1">
            {publicNavItems.map((item) => {
              // Il menu si apre anche al tocco su tablet e dispositivi mobili.
              if (item.path === '/stats') {
                const statsActive =
                  location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)
                return (
                  <div key={item.path} ref={statsDropdownRef} className="relative">
                    <button
                      type="button"
                      aria-haspopup="menu"
                      aria-expanded={isDesktopStatsMenuOpen}
                      aria-controls="desktop-statistics-menu"
                      onClick={() => setIsDesktopStatsMenuOpen((open) => !open)}
                      className={`flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium transition ${
                        statsActive || isDesktopStatsMenuOpen
                          ? 'bg-emerald-500 text-white'
                          : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                      }`}
                    >
                      <item.icon className="w-4 h-4" />
                      <span>{item.label}</span>
                      <ChevronDown className={`w-3 h-3 transition-transform ${isDesktopStatsMenuOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {isDesktopStatsMenuOpen && (
                      <div id="desktop-statistics-menu" role="menu" className="absolute left-0 top-full z-50 pt-1">
                        <div className="w-60 rounded-lg border border-slate-600 bg-slate-700 py-1 shadow-lg">
                          <Link
                            to="/stats"
                            role="menuitem"
                            onClick={() => setIsDesktopStatsMenuOpen(false)}
                            className={`block px-4 py-3 text-sm font-medium transition ${
                              isActive(location.pathname, '/stats')
                                ? 'bg-emerald-500 text-white'
                                : 'text-slate-300 hover:bg-slate-600 hover:text-white'
                            }`}
                          >
                            Statistiche generali
                          </Link>
                          {PLAYER_COUNT_BUCKET_ORDER.map((bucket) => {
                            const path = `/stats/${bucket}`
                            return (
                              <Link
                              key={bucket}
                              to={path}
                              role="menuitem"
                              onClick={() => setIsDesktopStatsMenuOpen(false)}
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
                    )}
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
            <a
              href="https://partyscore.baldeddu.cc/"
              title="Vai a PartyScore"
              className="flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition"
            >
              <ArrowLeftRight className="w-4 h-4" />
              <span>PartyScore</span>
            </a>
          </div>

          {/* User Menu */}
          <div className="flex items-center gap-1 sm:gap-4">
            {user ? (
              <div className="relative" ref={dropdownRef}>
                {/* User Profile Button */}
                <button
                  type="button"
                  aria-label="Menu utente"
                  aria-expanded={isDropdownOpen}
                  aria-controls="user-profile-menu"
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                  className="flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition"
                >
                  <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-slate-700">
                    {avatarUrl ? (
                      <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <User className="w-5 h-5 text-slate-300" />
                    )}
                  </div>
                  <span className="hidden sm:block">
                    {user?.user_metadata?.name || user?.email}
                  </span>
                  <ChevronDown className={`w-4 h-4 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                {/* Dropdown Menu */}
                {isDropdownOpen && (
                  <div id="user-profile-menu" className="absolute right-0 mt-2 w-56 bg-slate-700 rounded-lg shadow-lg py-1 border border-slate-600">
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
            <button
              type="button"
              aria-label={isMobileMenuOpen ? 'Chiudi menu' : 'Apri menu'}
              aria-expanded={isMobileMenuOpen}
              aria-controls="mobile-navigation"
              onClick={() => {
                setIsMobileMenuOpen((open) => !open)
                setIsDropdownOpen(false)
                setIsStatsSubmenuOpen(false)
              }}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white transition sm:hidden"
            >
              {isMobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>

        {/* Mobile Navigation */}
        <div
          id="mobile-navigation"
          className={`${isMobileMenuOpen ? 'block' : 'hidden'} max-h-[calc(100dvh-4rem)] overflow-y-auto pb-4 sm:block lg:hidden`}
        >
          <div className="grid grid-cols-3 gap-2">
            {publicNavItems.map((item) => {
              // Su mobile la voce Statistiche apre un elenco ampio e touch-friendly.
              if (item.path === '/stats') {
                const statsActive =
                  location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)
                return (
                  <button
                    key={item.path}
                    type="button"
                    onClick={() => setIsStatsSubmenuOpen(!isStatsSubmenuOpen)}
                    aria-expanded={isStatsSubmenuOpen}
                    aria-controls="mobile-statistics-menu"
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
                  onClick={() => {
                    setIsMobileMenuOpen(false)
                    setIsStatsSubmenuOpen(false)
                  }}
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
            <a
              href="https://partyscore.baldeddu.cc/"
              title="Vai a PartyScore"
              className="flex flex-col items-center justify-center p-2 rounded-lg text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition"
            >
              <ArrowLeftRight className="w-5 h-5 mb-1" />
              <span>PartyScore</span>
            </a>
          </div>

          {/* Pannello statistiche touch-friendly per mobile */}
          {isStatsSubmenuOpen && (
            <div id="mobile-statistics-menu" role="region" aria-label="Voci del menu Statistiche" className="mt-3 rounded-xl border border-slate-600 bg-slate-700 p-2 shadow-lg">
              <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Statistiche per numero di giocatori
              </p>
              <div className="grid grid-cols-1 gap-1">
                <Link
                  to="/stats"
                  onClick={() => {
                    setIsMobileMenuOpen(false)
                    setIsStatsSubmenuOpen(false)
                  }}
                  className={`flex min-h-12 items-center rounded-lg px-4 py-3 text-sm font-medium transition ${
                    isActive(location.pathname, '/stats')
                      ? 'bg-emerald-500 text-white'
                      : 'text-slate-200 hover:bg-slate-600 hover:text-white'
                  }`}
                >
                  Statistiche generali
                </Link>
                {PLAYER_COUNT_BUCKET_ORDER.map((bucket) => {
                  const path = `/stats/${bucket}`
                  return (
                    <Link
                      key={bucket}
                      to={path}
                      onClick={() => {
                        setIsMobileMenuOpen(false)
                        setIsStatsSubmenuOpen(false)
                      }}
                      className={`flex min-h-12 items-center rounded-lg px-4 py-3 text-sm font-medium transition ${
                        isActive(location.pathname, path)
                          ? 'bg-emerald-500 text-white'
                          : 'text-slate-200 hover:bg-slate-600 hover:text-white'
                      }`}
                    >
                      {PLAYER_COUNT_BUCKETS[bucket].label}
                    </Link>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </nav>
  )
}

export default Navbar
