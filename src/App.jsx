import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { Toaster } from 'react-hot-toast'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'

// Pages
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Plays from './pages/Plays'
import AddPlay from './pages/AddPlay'
import PlayDetail from './pages/PlayDetail'
import Games from './pages/Games'
import GameDetail from './pages/GameDetail'
import Players from './pages/Players'
import PlayerDetail from './pages/PlayerDetail'
import Import from './pages/Import'
import Stats from './pages/Stats'
import ELO from './pages/ELO'

function App() {
  return (
    <AuthProvider>
      <Router>
        <Toaster position="top-right" />
        <Routes>
          {/* Public Routes */}
          <Route path="/login" element={<Login />} />

          {/* Public Routes - Accessible to everyone */}
          <Route
            path="/"
            element={
              <Layout>
                <Dashboard />
              </Layout>
            }
          />
          <Route
            path="/plays"
            element={
              <Layout>
                <Plays />
              </Layout>
            }
          />
          <Route
            path="/plays/:id"
            element={
              <Layout>
                <PlayDetail />
              </Layout>
            }
          />
          <Route
            path="/games"
            element={
              <Layout>
                <Games />
              </Layout>
            }
          />
          <Route
            path="/games/:id"
            element={
              <Layout>
                <GameDetail />
              </Layout>
            }
          />
          <Route
            path="/players"
            element={
              <Layout>
                <Players />
              </Layout>
            }
          />
          <Route
            path="/players/:id"
            element={
              <Layout>
                <PlayerDetail />
              </Layout>
            }
          />
          <Route
            path="/stats"
            element={
              <Layout>
                <Stats />
              </Layout>
            }
          />
          <Route
            path="/elo"
            element={
              <Layout>
                <ELO />
              </Layout>
            }
          />

          {/* Protected Routes - Only for registered users */}
          <Route
            path="/plays/new"
            element={
              <ProtectedRoute>
                <Layout>
                  <AddPlay />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/import"
            element={
              <ProtectedRoute>
                <Layout>
                  <Import />
                </Layout>
              </ProtectedRoute>
            }
          />

          {/* Default redirect */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  )
}

export default App
