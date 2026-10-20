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
  AccessibleAccount,
  clearToken,
  fetchSession,
  getToken,
  login as apiLogin,
  logout as apiLogout,
  setToken,
  SessionUser,
  switchAccount as apiSwitchAccount,
} from "@/api/auth";
import { TOKEN_KEY } from "@/api/token";

type AuthState = {
  user: SessionUser | null;
  /** Contas que a pessoa alcança — a sessão já as trazia. [S1-K] */
  accounts: AccessibleAccount[];
  booting: boolean;
  login: (loginId: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: SessionUser | null) => void;
  /** Trocar a conta ativa de qualquer tela. [S1-K] */
  switchAccount: (accountId: string) => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [accounts, setAccounts] = useState<AccessibleAccount[]>([]);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setBooting(false);
      return;
    }
    fetchSession()
      .then((data) => {
        setUser(data.user);
        setAccounts(data.accounts ?? []);
      })
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
        setAccounts([]);
        return;
      }
      fetchSession()
        .then((data) => {
          setUser(data.user);
          setAccounts(data.accounts ?? []);
        })
        .catch(() => {
          setUser(null);
          setAccounts([]);
        });
    }
    window.addEventListener("storage", trocou);
    return () => window.removeEventListener("storage", trocou);
  }, []);

  const login = useCallback(async (loginId: string, password: string) => {
    const data = await apiLogin(loginId, password);
    setUser(data.user);
    setAccounts(data.accounts ?? []);
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
    setAccounts([]);
  }, []);

  const switchAccount = useCallback(async (accountId: string) => {
    const data = await apiSwitchAccount(accountId);
    setToken(data.token);
    setUser(data.user);
    setAccounts(data.accounts ?? []);
  }, []);

  const value = useMemo(
    () => ({ user, accounts, booting, login, logout, setUser, switchAccount }),
    [user, accounts, booting, login, logout, switchAccount],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return ctx;
}
