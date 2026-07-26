/**
 * Firebase initialization module.
 * Loaded as type="module" so imports work directly from CDN.
 * Exposes Firebase services to the global window for use by app.js.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  addDoc,
  query,
  orderBy,
  getDocs,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAyRHwHI1R44PSeno-2GyVpUWMBYU9Pvqk",
  authDomain: "cert-companion.firebaseapp.com",
  projectId: "cert-companion",
  storageBucket: "cert-companion.firebasestorage.app",
  messagingSenderId: "730427525626",
  appId: "1:730427525626:web:74b303ef962a239990fc43",
  measurementId: "G-HHH3XR8VK1",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Expose Firebase services to window for app.js
window.firebaseAuth = auth;
window.firebaseDb = db;

// Expose auth functions
window.firebaseSignIn = (email, password) =>
  signInWithEmailAndPassword(auth, email, password);
window.firebaseSignUp = (email, password) =>
  createUserWithEmailAndPassword(auth, email, password);
window.firebaseSignOut = () => signOut(auth);
window.firebaseResetPassword = (email) => sendPasswordResetEmail(auth, email);

// Expose Firestore functions
window.firestoreDoc = doc;
window.firestoreGetDoc = getDoc;
window.firestoreSetDoc = setDoc;
window.firestoreDeleteDoc = deleteDoc;
window.firestoreCollection = collection;
window.firestoreAddDoc = addDoc;
window.firestoreQuery = query;
window.firestoreOrderBy = orderBy;
window.firestoreGetDocs = getDocs;

// Auth state listener — notify app.js when auth state changes
onAuthStateChanged(auth, (user) => {
  if (window.onFirebaseAuthStateChanged) {
    window.onFirebaseAuthStateChanged(user);
  }
});
