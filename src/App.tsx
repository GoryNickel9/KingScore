import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { Toaster } from 'react-hot-toast'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import ErrorBoundary from './components/ErrorBoundary'

// Pages
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Plays from './pages/Plays'
import AddPlay from './pages/AddPlay'
import EditPlay from './pages/EditPlay'
import PlayDetail from './pages/PlayDetail'
import Games from './pages/Games'
import GameDetail from './pages/GameDetail'
import Players from './pages/Players'
import PlayerDetail from './pages/PlayerDetail'
import Import from './pages/Import'
import Stats from './pages/Stats'
import ELO from './pages/ELO'
import Images from './pages/Images'
import Register from './pages/Register'

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
      <Router>
        <Toaster position="top-right" />
        <Routes>
          {/* Public Routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

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
          <Route
            path="/images"
            element={
              <Layout>
                <Images />
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
            path="/plays/:id/edit"
            element={
              <ProtectedRoute>
                <Layout>
                  <EditPlay />
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

          {/* Default redirect */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
      </AuthProvider>
    </ErrorBoundary>
  )
}

export default App
