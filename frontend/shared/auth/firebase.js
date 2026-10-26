import { API_BASE_URL } from "../api/config.js";

let firebaseClientPromise = null;

const FIREBASE_ERROR_MESSAGES = {
  "auth/unauthorized-domain": "O login com o Google não está disponível neste endereço Acesse pelo localhost ou entre em contato com o suporte",
  "auth/popup-blocked": "O navegador bloqueou a janela de login Libere pop-ups e tente novamente",
  "auth/popup-closed-by-user": "O login com o Google foi cancelado antes da conclusão",
  "auth/cancelled-popup-request": "Já existe uma tentativa de login em andamento",
  "auth/network-request-failed": "Falha de conexão ao iniciar o login com o Google Verifique sua internet e tente novamente",
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
    throw new Error(payload.error || "Falha ao carregar a configuração do Firebase");
  }

  if (!payload.enabled) {
    throw new Error(payload.error || "Firebase não configurado");
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
      "Não foi possível concluir o login com o Google Tente novamente";

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
