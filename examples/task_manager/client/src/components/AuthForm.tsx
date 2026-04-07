import { useState, type FormEvent } from 'react';
import { useAuth } from '../hooks/useAuth.js';

export function AuthForm() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') await login(username, password);
      else await register(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Task Manager</h1>
        <div style={styles.tabs}>
          <button style={mode === 'login' ? styles.activeTab : styles.tab} onClick={() => setMode('login')}>Login</button>
          <button style={mode === 'register' ? styles.activeTab : styles.tab} onClick={() => setMode('register')}>Register</button>
        </div>
        <form onSubmit={submit} style={styles.form}>
          <input
            style={styles.input}
            placeholder="Username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            required
            autoComplete="username"
          />
          <input
            style={styles.input}
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          />
          {error && <p style={styles.error}>{error}</p>}
          <button style={styles.button} type="submit" disabled={loading}>
            {loading ? 'Loading…' : mode === 'login' ? 'Login' : 'Register'}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f2f5' },
  card: { background: '#fff', borderRadius: 12, padding: '2rem', width: 360, boxShadow: '0 4px 24px rgba(0,0,0,0.1)' },
  title: { margin: '0 0 1.5rem', textAlign: 'center', fontSize: '1.5rem', color: '#1a1a2e' },
  tabs: { display: 'flex', marginBottom: '1.5rem', borderRadius: 8, overflow: 'hidden', border: '1px solid #e0e0e0' },
  tab: { flex: 1, padding: '0.6rem', border: 'none', background: '#f5f5f5', cursor: 'pointer', fontSize: '0.95rem' },
  activeTab: { flex: 1, padding: '0.6rem', border: 'none', background: '#4f46e5', color: '#fff', cursor: 'pointer', fontSize: '0.95rem', fontWeight: 600 },
  form: { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  input: { padding: '0.7rem 1rem', border: '1px solid #ddd', borderRadius: 8, fontSize: '1rem', outline: 'none' },
  error: { color: '#e53e3e', fontSize: '0.875rem', margin: 0 },
  button: { padding: '0.75rem', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, fontSize: '1rem', cursor: 'pointer', fontWeight: 600 },
};
