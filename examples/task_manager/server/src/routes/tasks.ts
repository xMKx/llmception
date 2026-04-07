import { Router } from 'express';
import db from '../db.js';
import { requireAuth, type AuthRequest } from '../auth.js';
import type { Server } from 'socket.io';

interface Task {
  id: number;
  title: string;
  description: string | null;
  status: 'todo' | 'in_progress' | 'done';
  assignee_id: number | null;
  assignee_username: string | null;
  created_by: number;
  creator_username: string;
  created_at: string;
  updated_at: string;
}

export function createTasksRouter(io: Server) {
  const router = Router();
  router.use(requireAuth);

  const taskQuery = `
    SELECT t.*, u1.username AS creator_username, u2.username AS assignee_username
    FROM tasks t
    JOIN users u1 ON t.created_by = u1.id
    LEFT JOIN users u2 ON t.assignee_id = u2.id
  `;

  router.get('/', (_req, res) => {
    const tasks = db.prepare(`${taskQuery} ORDER BY t.created_at DESC`).all() as Task[];
    res.json(tasks);
  });

  router.get('/:id', (req, res) => {
    const task = db.prepare(`${taskQuery} WHERE t.id = ?`).get(req.params.id) as Task | undefined;
    if (!task) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(task);
  });

  router.post('/', (req: AuthRequest, res) => {
    const { title, description, assignee_id } = req.body as {
      title?: string;
      description?: string;
      assignee_id?: number;
    };
    if (!title?.trim()) { res.status(400).json({ error: 'title required' }); return; }

    const result = db.prepare(
      'INSERT INTO tasks (title, description, assignee_id, created_by) VALUES (?, ?, ?, ?)'
    ).run(title.trim(), description ?? null, assignee_id ?? null, req.user!.userId);

    const task = db.prepare(`${taskQuery} WHERE t.id = ?`).get(result.lastInsertRowid) as Task;
    io.emit('task:created', task);
    res.status(201).json(task);
  });

  router.patch('/:id', (req: AuthRequest, res) => {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id) as Task | undefined;
    if (!task) { res.status(404).json({ error: 'Not found' }); return; }

    const { title, description, status, assignee_id } = req.body as Partial<Task>;
    const allowedStatuses = ['todo', 'in_progress', 'done'];
    if (status && !allowedStatuses.includes(status)) {
      res.status(400).json({ error: 'Invalid status' }); return;
    }

    db.prepare(`
      UPDATE tasks SET
        title = COALESCE(?, title),
        description = COALESCE(?, description),
        status = COALESCE(?, status),
        assignee_id = CASE WHEN ? = 1 THEN ? ELSE assignee_id END,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      title ?? null,
      description ?? null,
      status ?? null,
      assignee_id !== undefined ? 1 : 0,
      assignee_id ?? null,
      req.params.id
    );

    const updated = db.prepare(`${taskQuery} WHERE t.id = ?`).get(req.params.id) as Task;
    io.emit('task:updated', updated);
    res.json(updated);
  });

  router.delete('/:id', (req: AuthRequest, res) => {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id) as Task | undefined;
    if (!task) { res.status(404).json({ error: 'Not found' }); return; }

    db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
    io.emit('task:deleted', { id: Number(req.params.id) });
    res.status(204).end();
  });

  return router;
}
