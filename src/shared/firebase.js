import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

/**
 * Firebase configuration sourced from environment variables (Vite VITE_* prefix).
 * Copy .env.example to .env and fill in your project values before running.
 */
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_API_KEY,
  authDomain:        import.meta.env.VITE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_APP_ID,
};

// Initialize Firebase app singleton
const app = initializeApp(firebaseConfig);

// Export service singletons — import these throughout the app
export const auth    = getAuth(app);
export const db      = getFirestore(app);
export const storage = getStorage(app);

export default app;
