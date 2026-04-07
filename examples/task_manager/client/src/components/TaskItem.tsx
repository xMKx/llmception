import { useState } from 'react';
import { api, type Task } from '../api/client.js';
import { useAuth } from '../hooks/useAuth.js';

const STATUS_LABELS: Record<Task['status'], string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
};

const STATUS_COLORS: Record<Task['status'], string> = {
  todo: '#718096',
  in_progress: '#d69e2e',
  done: '#38a169',
};

const NEXT_STATUS: Record<Task['status'], Task['status']> = {
  todo: 'in_progress',
  in_progress: 'done',
  done: 'todo',
};

interface Props {
  task: Task;
  onDeleted: (id: number) => void;
}

export function TaskItem({ task, onDeleted }: Props) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);

  const advanceStatus = async () => {
    setLoading(true);
    try {
      await api.tasks.update(task.id, { status: NEXT_STATUS[task.status] });
    } finally {
      setLoading(false);
    }
  };

  const del = async () => {
    if (!confirm(`Delete "${task.title}"?`)) return;
    setLoading(true);
    try {
      await api.tasks.delete(task.id);
      onDeleted(task.id);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <span style={{ ...styles.badge, background: STATUS_COLORS[task.status] }}>
          {STATUS_LABELS[task.status]}
        </span>
        <div style={styles.actions}>
          <button style={styles.advBtn} onClick={advanceStatus} disabled={loading} title="Advance status">
            {task.status === 'done' ? '↺' : '→'}
          </button>
          {user?.id === task.created_by && (
            <button style={styles.delBtn} onClick={del} disabled={loading} title="Delete">
              ✕
            </button>
          )}
        </div>
      </div>
      <h3 style={styles.title}>{task.title}</h3>
      {task.description && <p style={styles.desc}>{task.description}</p>}
      <div style={styles.meta}>
        <span>by {task.creator_username}</span>
        {task.assignee_username && <span> · assigned to {task.assignee_username}</span>}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: { background: '#fff', borderRadius: 10, padding: '1rem', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: '0.4rem' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  badge: { padding: '0.2rem 0.6rem', borderRadius: 12, color: '#fff', fontSize: '0.75rem', fontWeight: 600 },
  actions: { display: 'flex', gap: '0.3rem' },
  advBtn: { border: 'none', background: '#eef2ff', color: '#4f46e5', borderRadius: 6, padding: '0.25rem 0.5rem', cursor: 'pointer', fontWeight: 700 },
  delBtn: { border: 'none', background: '#fff5f5', color: '#e53e3e', borderRadius: 6, padding: '0.25rem 0.5rem', cursor: 'pointer', fontWeight: 700 },
  title: { margin: 0, fontSize: '1rem', color: '#1a1a2e' },
  desc: { margin: 0, fontSize: '0.875rem', color: '#718096' },
  meta: { fontSize: '0.75rem', color: '#a0aec0' },
};
