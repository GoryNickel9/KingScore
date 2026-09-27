import { Suspense, lazy } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { Toaster } from 'react-hot-toast'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import ErrorBoundary from './components/ErrorBoundary'
import Spinner from './components/Spinner'

// Pages (lazy loaded)
const Login = lazy(() => import('./pages/Login'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Plays = lazy(() => import('./pages/Plays'))
const AddPlay = lazy(() => import('./pages/AddPlay'))
const EditPlay = lazy(() => import('./pages/EditPlay'))
const PlayDetail = lazy(() => import('./pages/PlayDetail'))
const Games = lazy(() => import('./pages/Games'))
const GameDetail = lazy(() => import('./pages/GameDetail'))
const Players = lazy(() => import('./pages/Players'))
const PlayerDetail = lazy(() => import('./pages/PlayerDetail'))
const Import = lazy(() => import('./pages/Import'))
const Stats = lazy(() => import('./pages/Stats'))
const StatsByPlayerCount = lazy(() => import('./pages/StatsByPlayerCount'))
const ELO = lazy(() => import('./pages/ELO'))
const Images = lazy(() => import('./pages/Images'))
const Register = lazy(() => import('./pages/Register'))
const Wrapped = lazy(() => import('./pages/Wrapped'))
const Admin = lazy(() => import('./pages/Admin'))
const Settings = lazy(() => import('./pages/Settings'))

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
      <Router>
        <Toaster position="top-right" />
        <Suspense fallback={<Spinner />}>
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
              <ProtectedRoute requireAdmin>
                <Layout>
                  <Games />
                </Layout>
              </ProtectedRoute>
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
            path="/stats/:bucket"
            element={
              <Layout>
                <StatsByPlayerCount />
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
              <ProtectedRoute requireAdmin>
                <Layout>
                  <Images />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/wrapped"
            element={
              <Layout>
                <Wrapped />
              </Layout>
            }
          />

          <Route
            path="/admin"
            element={
              <ProtectedRoute requireAdmin>
                <Layout>
                  <Admin />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <Layout>
                  <Settings />
                </Layout>
              </ProtectedRoute>
            }
          />

          {/* Protected Routes - Only for registered users */}
          <Route
            path="/plays/new"
            element={
              <ProtectedRoute requireAdmin>
                <Layout>
                  <AddPlay />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/plays/:id/edit"
            element={
              <ProtectedRoute requireAdmin>
                <Layout>
                  <EditPlay />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/players"
            element={
              <ProtectedRoute requireAdmin>
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
              <ProtectedRoute requireAdmin>
                <Layout>
                  <Import />
                </Layout>
              </ProtectedRoute>
            }
          />

          {/* Default redirect */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </Router>
      </AuthProvider>
    </ErrorBoundary>
  )
}

export default App
