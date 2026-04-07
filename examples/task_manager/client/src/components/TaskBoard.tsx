import { useState, useEffect, useCallback } from 'react';
import { api, type Task } from '../api/client.js';
import { useAuth } from '../hooks/useAuth.js';
import { useSocket } from '../hooks/useSocket.js';
import { TaskForm } from './TaskForm.js';
import { TaskItem } from './TaskItem.js';

export function TaskBoard() {
  const { user, token, logout } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notifications, setNotifications] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const notify = (msg: string) => {
    setNotifications(prev => [msg, ...prev].slice(0, 5));
    setTimeout(() => setNotifications(prev => prev.filter(n => n !== msg)), 4000);
  };

  const loadTasks = useCallback(async () => {
    try {
      const data = await api.tasks.list();
      setTasks(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadTasks(); }, [loadTasks]);

  useSocket(token, {
    onTaskCreated: (task) => {
      setTasks(prev => [task, ...prev.filter(t => t.id !== task.id)]);
      if (task.created_by !== user?.id) notify(`${task.creator_username} created "${task.title}"`);
    },
    onTaskUpdated: (task) => {
      setTasks(prev => prev.map(t => t.id === task.id ? task : t));
    },
    onTaskDeleted: ({ id }) => {
      setTasks(prev => prev.filter(t => t.id !== id));
    },
    onUserJoined: ({ username }) => {
      if (username !== user?.username) notify(`${username} joined`);
    },
    onUserLeft: ({ username }) => {
      if (username !== user?.username) notify(`${username} left`);
    },
  });

  const columns: Task['status'][] = ['todo', 'in_progress', 'done'];
  const colLabels: Record<Task['status'], string> = { todo: 'To Do', in_progress: 'In Progress', done: 'Done' };

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.logo}>Task Manager</h1>
        <div style={styles.userBar}>
          <span style={styles.username}>{user?.username}</span>
          <button style={styles.logoutBtn} onClick={logout}>Logout</button>
        </div>
      </header>

      {notifications.length > 0 && (
        <div style={styles.notifications}>
          {notifications.map((n, i) => <div key={i} style={styles.notification}>{n}</div>)}
        </div>
      )}

      <main style={styles.main}>
        <TaskForm onCreated={loadTasks} />

        {loading ? (
          <p style={{ color: '#718096' }}>Loading tasks…</p>
        ) : (
          <div style={styles.board}>
            {columns.map(col => (
              <div key={col} style={styles.column}>
                <h2 style={styles.colHeader}>{colLabels[col]} ({tasks.filter(t => t.status === col).length})</h2>
                <div style={styles.cards}>
                  {tasks.filter(t => t.status === col).map(task => (
                    <TaskItem
                      key={task.id}
                      task={task}
                      onDeleted={id => setTasks(prev => prev.filter(t => t.id !== id))}
                    />
                  ))}
                  {tasks.filter(t => t.status === col).length === 0 && (
                    <p style={styles.empty}>No tasks</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f0f2f5', fontFamily: 'system-ui, sans-serif' },
  header: { background: '#fff', padding: '0.75rem 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' },
  logo: { margin: 0, fontSize: '1.25rem', color: '#1a1a2e' },
  userBar: { display: 'flex', alignItems: 'center', gap: '1rem' },
  username: { color: '#4a5568', fontWeight: 500 },
  logoutBtn: { border: 'none', background: '#eef2ff', color: '#4f46e5', padding: '0.4rem 0.9rem', borderRadius: 8, cursor: 'pointer', fontWeight: 600 },
  notifications: { position: 'fixed', top: 70, right: 20, display: 'flex', flexDirection: 'column', gap: '0.5rem', zIndex: 100 },
  notification: { background: '#1a1a2e', color: '#fff', padding: '0.5rem 1rem', borderRadius: 8, fontSize: '0.875rem', boxShadow: '0 2px 8px rgba(0,0,0,0.2)' },
  main: { padding: '1.5rem 2rem', maxWidth: 1200, margin: '0 auto' },
  board: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' },
  column: { background: '#e8ecf0', borderRadius: 12, padding: '1rem' },
  colHeader: { margin: '0 0 1rem', fontSize: '0.95rem', fontWeight: 700, color: '#4a5568', textTransform: 'uppercase', letterSpacing: '0.05em' },
  cards: { display: 'flex', flexDirection: 'column', gap: '0.75rem', minHeight: 80 },
  empty: { color: '#a0aec0', fontSize: '0.875rem', textAlign: 'center', margin: '1rem 0' },
};
