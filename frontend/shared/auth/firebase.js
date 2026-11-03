import { API_BASE_URL } from "../api/config.js";

let firebaseClientPromise = null;

const FIREBASE_ERROR_MESSAGES = {
  "auth/unauthorized-domain": "Google sign-in is unavailable at this address Open the app through localhost or contact support",
  "auth/popup-blocked": "The browser blocked the sign-in window Allow pop-ups and try again",
  "auth/popup-closed-by-user": "Google sign-in was canceled before it finished",
  "auth/cancelled-popup-request": "A sign-in attempt is already in progress",
  "auth/network-request-failed": "Connection failed while starting Google sign-in Check your internet connection and try again",
};

const loadFirebaseModules = async () => {
  const [{ initializeApp }, authModule] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js"),
  ]);

  return {
    initializeApp,
    ...authModule,
  };
};

const loadFirebaseRuntimeConfig = async () => {
  const response = await fetch(`${API_BASE_URL}/auth/firebase/config`);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Could not load the Firebase configuration");
  }

  if (!payload.enabled) {
    throw new Error(payload.error || "Firebase is not configured");
  }

  return payload.config;
};

export const getFirebaseClient = async () => {
  if (firebaseClientPromise) return firebaseClientPromise;

  firebaseClientPromise = (async () => {
    const [config, sdk] = await Promise.all([
      loadFirebaseRuntimeConfig(),
      loadFirebaseModules(),
    ]);

    const app = sdk.initializeApp(config);
    const auth = sdk.getAuth(app);
    const provider = new sdk.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });

    return {
      auth,
      provider,
      signInWithPopup: sdk.signInWithPopup,
      signOut: sdk.signOut,
    };
  })();

  return firebaseClientPromise;
};

export const signInWithFirebaseGoogle = async () => {
  try {
    const client = await getFirebaseClient();
    const result = await client.signInWithPopup(client.auth, client.provider);

    return {
      idToken: await result.user.getIdToken(),
      user: result.user,
    };
  } catch (error) {
    const code = error?.code ? String(error.code) : "";
    const normalizedMessage =
      FIREBASE_ERROR_MESSAGES[code] ||
      "Could not complete Google sign-in Try again";

    throw new Error(normalizedMessage);
  }
};

export const signOutFirebaseSession = async () => {
  if (!firebaseClientPromise) return;

  try {
    const client = await firebaseClientPromise;
    await client.signOut(client.auth);
  } catch {
  }
};
