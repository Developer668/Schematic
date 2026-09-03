import { adoptSession, authUrl } from "./session.ts";

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

/**
 * Firebase web config comes from build-time VITE_* values that are safe to
 * ship in client code (they identify the project; they are not secrets).
 * Paste them into frontend/.env from the Firebase console:
 * Project settings → General → Your apps → Web app config.
 */
export function firebaseWebConfig(): FirebaseWebConfig | null {
  const env = import.meta.env as Record<string, string | undefined>;
  const config = {
    apiKey: (env.VITE_FIREBASE_API_KEY ?? "").trim(),
    authDomain: (env.VITE_FIREBASE_AUTH_DOMAIN ?? "").trim(),
    projectId: (env.VITE_FIREBASE_PROJECT_ID ?? "").trim(),
    appId: (env.VITE_FIREBASE_APP_ID ?? "").trim(),
  };
  return config.apiKey && config.authDomain && config.projectId && config.appId ? config : null;
}

export function firebaseConfigured(): boolean {
  return firebaseWebConfig() !== null;
}

async function firebaseModules() {
  const [appModule, authModule] = await Promise.all([import("firebase/app"), import("firebase/auth")]);
  return { appModule, authModule };
}

async function firebaseAuth() {
  const config = firebaseWebConfig();
  if (!config) throw new Error("Firebase sign-in is not configured. Add VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID, and VITE_FIREBASE_APP_ID, then rebuild.");
  const { appModule, authModule } = await firebaseModules();
  const app = appModule.getApps().length ? appModule.getApps()[0]! : appModule.initializeApp(config);
  return authModule.getAuth(app);
}

/**
 * Google sign-in via Firebase, then exchange the Firebase ID token for a
 * short-lived Schematic session issued by the same-origin API. The Firebase
 * token itself is never stored; only the Schematic session is cached.
 */
export async function signInWithFirebase() {
  const { authModule } = await firebaseModules();
  const auth = await firebaseAuth();
  const provider = new authModule.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const credential = await authModule.signInWithPopup(auth, provider);
  const idToken = await credential.user.getIdToken();
  const response = await fetch(authUrl("/api/auth/session"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ firebaseIdToken: idToken }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload ? String((payload as Record<string, unknown>).error) : `Firebase exchange returned HTTP ${response.status}`;
    try {
      await authModule.signOut(auth);
    } catch {
      // The exchange already failed; a sign-out failure must not mask it.
    }
    throw new Error(message);
  }
  const session = adoptSession(payload);
  if (!session) throw new Error("The workspace rejected the Firebase sign-in. Check that FIREBASE_PROJECT_ID is set on the API deployment.");
  return session;
}

export async function signOutFirebase() {
  try {
    const auth = await firebaseAuth();
    const { authModule } = await firebaseModules();
    await authModule.signOut(auth);
  } catch {
    // Sign-out is best-effort when Firebase was never configured.
  }
}
