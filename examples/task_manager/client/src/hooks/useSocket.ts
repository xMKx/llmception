import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { Task } from '../api/client.js';

interface SocketEvents {
  onTaskCreated?: (task: Task) => void;
  onTaskUpdated?: (task: Task) => void;
  onTaskDeleted?: (payload: { id: number }) => void;
  onUserJoined?: (payload: { username: string }) => void;
  onUserLeft?: (payload: { username: string }) => void;
}

export function useSocket(token: string | null, events: SocketEvents) {
  const socketRef = useRef<Socket | null>(null);
  const eventsRef = useRef(events);
  eventsRef.current = events;

  useEffect(() => {
    if (!token) return;

    const socket = io('http://localhost:3001', { auth: { token } });
    socketRef.current = socket;

    socket.on('task:created', (task: Task) => eventsRef.current.onTaskCreated?.(task));
    socket.on('task:updated', (task: Task) => eventsRef.current.onTaskUpdated?.(task));
    socket.on('task:deleted', (payload: { id: number }) => eventsRef.current.onTaskDeleted?.(payload));
    socket.on('user:joined', (payload: { username: string }) => eventsRef.current.onUserJoined?.(payload));
    socket.on('user:left', (payload: { username: string }) => eventsRef.current.onUserLeft?.(payload));

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token]);
}
