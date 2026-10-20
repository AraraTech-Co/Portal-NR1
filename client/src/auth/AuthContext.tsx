import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  clearToken,
  fetchSession,
  getToken,
  login as apiLogin,
  logout as apiLogout,
  SessionUser,
} from "@/api/auth";
import { TOKEN_KEY } from "@/api/token";

type AuthState = {
  user: SessionUser | null;
  booting: boolean;
  login: (loginId: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: SessionUser | null) => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setBooting(false);
      return;
    }
    fetchSession()
      .then((data) => setUser(data.user))
      .catch(() => clearToken())
      .finally(() => setBooting(false));
  }, []);

  /*
    Num computador compartilhado, alguém entrava numa aba nova e a aba que já
    estava aberta continuava mostrando o nome da primeira pessoa — enquanto
    gravava em nome da segunda, porque o acesso fica no navegador e vale para
    todas as abas. A aba aberta passa a acompanhar a troca. [CB-25]
  */
  useEffect(() => {
    function trocou(e: StorageEvent) {
      if (e.key !== TOKEN_KEY) return;
      if (!e.newValue) {
        // Saiu em outra aba: esta também sai.
        setUser(null);
        return;
      }
      fetchSession()
        .then((data) => setUser(data.user))
        .catch(() => setUser(null));
    }
    window.addEventListener("storage", trocou);
    return () => window.removeEventListener("storage", trocou);
  }, []);

  const login = useCallback(async (loginId: string, password: string) => {
    const data = await apiLogin(loginId, password);
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, booting, login, logout, setUser }),
    [user, booting, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return ctx;
}
