import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Gamepad2, LayoutDashboard, Calendar, Library, Users, FileText, BarChart3, LogOut, User, Download, Trophy, LogIn } from 'lucide-react'

const Navbar = () => {
  const { user, signOut } = useAuth()
  const location = useLocation()

  const isActive = (path) => location.pathname === path

  const publicNavItems = [
    { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { path: '/plays', icon: Calendar, label: 'Partite' },
    { path: '/players', icon: Users, label: 'Giocatori' },
    { path: '/stats', icon: BarChart3, label: 'Statistiche' },
    { path: '/elo', icon: Trophy, label: 'Rating ELO' },
  ]

  const protectedNavItems = [
    { path: '/plays/new', icon: FileText, label: 'Aggiungi Partita' },
    { path: '/import', icon: Download, label: 'Import' },
  ]

  const allNavItems = user ? [...publicNavItems, ...protectedNavItems] : publicNavItems

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
            {allNavItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium transition ${
                  isActive(item.path)
                    ? 'bg-emerald-500 text-white'
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
              >
                <item.icon className="w-4 h-4" />
                <span>{item.label}</span>
              </Link>
            ))}
          </div>

          {/* User Menu */}
          <div className="flex items-center space-x-4">
            {user ? (
              <>
                <div className="flex items-center space-x-2">
                  <div className="bg-slate-700 p-2 rounded-full">
                    <User className="w-5 h-5 text-slate-300" />
                  </div>
                  <span className="hidden sm:block text-sm text-slate-300">
                    {user?.user_metadata?.name || user?.email}
                  </span>
                </div>
                <button
                  onClick={signOut}
                  className="flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition"
                  title="Logout"
                >
                  <LogOut className="w-4 h-4" />
                  <span className="hidden sm:inline">Logout</span>
                </button>
              </>
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
            {allNavItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`flex flex-col items-center justify-center p-2 rounded-lg text-xs font-medium transition ${
                  isActive(item.path)
                    ? 'bg-emerald-500 text-white'
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
              >
                <item.icon className="w-5 h-5 mb-1" />
                <span>{item.label}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </nav>
  )
}

export default Navbar
