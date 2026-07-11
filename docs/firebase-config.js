export const firebaseConfig = {
  apiKey: "AIzaSyBHR8l_u4sgfT8OI4or_-e9vpTJD0ph8CA",
  authDomain: "nanikiru-drill-haura900.firebaseapp.com",
  projectId: "nanikiru-drill-haura900",
  storageBucket: "nanikiru-drill-haura900.firebasestorage.app",
  messagingSenderId: "184978596740",
  appId: "1:184978596740:web:78e83ceb6023598c3ff3d1",
};

export function isFirebaseConfigured() {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId);
}
