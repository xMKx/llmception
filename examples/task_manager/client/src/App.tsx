import { useAuth } from './hooks/useAuth.js';
import { AuthForm } from './components/AuthForm.js';
import { TaskBoard } from './components/TaskBoard.js';

export default function App() {
  const { user } = useAuth();
  return user ? <TaskBoard /> : <AuthForm />;
}
