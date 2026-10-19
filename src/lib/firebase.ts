import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { firebaseConfig } from "../../shared/config";

const emulator = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST;

const app = initializeApp({
  ...firebaseConfig,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || firebaseConfig.projectId,
});

export const auth = getAuth(app);
auth.useDeviceLanguage();
if (emulator) connectAuthEmulator(auth, `http://${emulator}`, { disableWarnings: true });
