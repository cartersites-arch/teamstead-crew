import { createRoot } from 'react-dom/client';
import ChatApp from '../app/chat-app';
import '../app/globals.css';

const root = document.getElementById('root');
if (!root) throw new Error('The app could not open.');
createRoot(root).render(<ChatApp />);
