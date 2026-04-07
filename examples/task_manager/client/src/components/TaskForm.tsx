import { useState, type FormEvent } from 'react';
import { api } from '../api/client.js';

interface Props {
  onCreated: () => void;
}

export function TaskForm({ onCreated }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setLoading(true);
    setError('');
    try {
      await api.tasks.create({ title: title.trim(), description: description.trim() || undefined });
      setTitle('');
      setDescription('');
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} style={styles.form}>
      <input
        style={styles.input}
        placeholder="Task title"
        value={title}
        onChange={e => setTitle(e.target.value)}
        required
      />
      <input
        style={styles.input}
        placeholder="Description (optional)"
        value={description}
        onChange={e => setDescription(e.target.value)}
      />
      {error && <p style={styles.error}>{error}</p>}
      <button style={styles.button} type="submit" disabled={loading || !title.trim()}>
        {loading ? 'Adding…' : '+ Add Task'}
      </button>
    </form>
  );
}

const styles: Record<string, React.CSSProperties> = {
  form: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.5rem' },
  input: { flex: 1, minWidth: 160, padding: '0.6rem 0.9rem', border: '1px solid #ddd', borderRadius: 8, fontSize: '0.95rem' },
  error: { color: '#e53e3e', fontSize: '0.875rem', margin: 0, width: '100%' },
  button: { padding: '0.6rem 1.2rem', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 },
};
