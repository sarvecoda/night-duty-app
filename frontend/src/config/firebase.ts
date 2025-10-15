import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getAuth } from 'firebase/auth'

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyC4CCzDH6mvJkaMwDzX_JPmoG8CBJphRxw",
  authDomain: "night-duty-app.firebaseapp.com",
  projectId: "night-duty-app",
  storageBucket: "night-duty-app.firebasestorage.app",
  messagingSenderId: "985584803181",
  appId: "1:985584803181:web:d920730c99f37a892c0e64",
  measurementId: "G-BENW92MWJQ"
}

// Initialize Firebase
const app = initializeApp(firebaseConfig)

// Initialize services
export const db = getFirestore(app)
export const auth = getAuth(app)

