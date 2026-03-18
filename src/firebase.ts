import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyDHSny0bDEVnLY_mp_LHool7G5OXREvMIM",
  authDomain: "crm-dion.firebaseapp.com",
  projectId: "crm-dion",
  storageBucket: "crm-dion.firebasestorage.app",
  messagingSenderId: "596961417516",
  appId: "1:596961417516:web:b83ad0d9cb136f6d4c7489",
  measurementId: "G-TVK1G2G7HM"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
