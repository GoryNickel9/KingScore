import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { Toaster } from 'react-hot-toast'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'

// Pages
import Login from './pages/Login'
import Register from './pages/Register'
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
          <Route path="/register" element={<Register />} />

          {/* Protected Routes */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout>
                  <Dashboard />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/plays"
            element={
              <ProtectedRoute>
                <Layout>
                  <Plays />
                </Layout>
              </ProtectedRoute>
            }
          />
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
            path="/plays/:id"
            element={
              <ProtectedRoute>
                <Layout>
                  <PlayDetail />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/games"
            element={
              <ProtectedRoute>
                <Layout>
                  <Games />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/games/:id"
            element={
              <ProtectedRoute>
                <Layout>
                  <GameDetail />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/players"
            element={
              <ProtectedRoute>
                <Layout>
                  <Players />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/players/:id"
            element={
              <ProtectedRoute>
                <Layout>
                  <PlayerDetail />
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
          <Route
            path="/stats"
            element={
              <ProtectedRoute>
                <Layout>
                  <Stats />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/elo"
            element={
              <ProtectedRoute>
                <Layout>
                  <ELO />
                </Layout>
              </ProtectedRoute>
            }
          />

          {/* Default redirect */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  )
}

export default App
