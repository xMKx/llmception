import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { verifyToken } from './auth.js';
import authRouter from './routes/auth.js';
import { createTasksRouter } from './routes/tasks.js';

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: 'http://localhost:5173', credentials: true },
});

app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(express.json());

app.use('/api/auth', authRouter);
app.use('/api/tasks', createTasksRouter(io));

// Socket.io auth middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token as string | undefined;
  if (!token) { next(new Error('No token')); return; }
  try {
    const user = verifyToken(token);
    socket.data.user = user;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  const user = socket.data.user as { userId: number; username: string };
  console.log(`[ws] ${user.username} connected`);

  io.emit('user:joined', { username: user.username });

  socket.on('disconnect', () => {
    io.emit('user:left', { username: user.username });
    console.log(`[ws] ${user.username} disconnected`);
  });
});

const PORT = process.env.PORT ?? 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
