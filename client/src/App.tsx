import { LoadingState } from "@/components/LoadingState";
import { AuthProvider, useAuth } from "@/auth/AuthContext";
import { AppShell } from "@/layout/AppShell";
import { AccountPage } from "@/pages/AccountPage";
import { ActionsPage } from "@/pages/ActionsPage";
import { AepPage } from "@/pages/AepPage";
import { AnnouncementDetailPage } from "@/pages/AnnouncementDetailPage";
import { AnnouncementsPage } from "@/pages/AnnouncementsPage";
import { ChangePasswordPage } from "@/pages/ChangePasswordPage";
import { ClimatePage } from "@/pages/ClimatePage";
import { ContractorsPage } from "@/pages/ContractorsPage";
import { ConvitePage } from "@/pages/ConvitePage";
import { DocumentsPage } from "@/pages/DocumentsPage";
import { EmergenciesPage } from "@/pages/EmergenciesPage";
import { EmployeesPage } from "@/pages/EmployeesPage";
import { EthicsPage } from "@/pages/EthicsPage";
import { EthicsReportPage } from "@/pages/EthicsReportPage";
import { GamificationPage } from "@/pages/GamificationPage";
import { HealthPage } from "@/pages/HealthPage";
import { HomePage } from "@/pages/HomePage";
import { HrDocumentsPage } from "@/pages/HrDocumentsPage";
import { IdeasPage } from "@/pages/IdeasPage";
import { InventoryPage } from "@/pages/InventoryPage";
import { LeavesPage } from "@/pages/LeavesPage";
import { LoginPage } from "@/pages/LoginPage";
import { MedicalCertificatesPage } from "@/pages/MedicalCertificatesPage";
import { OccurrenceDetailPage } from "@/pages/OccurrenceDetailPage";
import { OccurrencesPage } from "@/pages/OccurrencesPage";
import { OnboardingPage } from "@/pages/OnboardingPage";
import { OperationPage } from "@/pages/OperationPage";
import { ParticipationsPage } from "@/pages/ParticipationsPage";
import { PayslipDetailPage } from "@/pages/PayslipDetailPage";
import { PayslipsPage } from "@/pages/PayslipsPage";
import { ReferralsPage } from "@/pages/ReferralsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { SummonsPage } from "@/pages/SummonsPage";
import { TimeEntriesPage } from "@/pages/TimeEntriesPage";
import { TrainingsPage } from "@/pages/TrainingsPage";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";

function BootScreen() {
  return <LoadingState fullscreen />;
}

function RequireAuth() {
  const { user, booting } = useAuth();
  if (booting) return <BootScreen />;
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function RequirePasswordOk() {
  const { user } = useAuth();
  if (user?.must_change_password) {
    return <Navigate to="/trocar-senha" replace />;
  }
  return <Outlet />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/convite/:token" element={<ConvitePage />} />
      <Route element={<RequireAuth />}>
        <Route path="/trocar-senha" element={<ChangePasswordPage />} />
        <Route element={<RequirePasswordOk />}>
          <Route element={<AppShell />}>
            <Route index element={<HomePage />} />
            <Route path="operacao" element={<OperationPage />} />
            <Route path="aep" element={<AepPage />} />
            <Route path="inventario" element={<InventoryPage />} />
            <Route path="acoes" element={<ActionsPage />} />
            <Route path="ocorrencias" element={<OccurrencesPage />} />
            <Route path="ocorrencias/:id" element={<OccurrenceDetailPage />} />
            <Route path="emergencias" element={<EmergenciesPage />} />
            <Route path="documentos" element={<DocumentsPage />} />
            <Route path="terceiros" element={<ContractorsPage />} />
            <Route path="colaboradores" element={<EmployeesPage />} />
            <Route path="documentos-rh" element={<HrDocumentsPage />} />
            <Route path="holerites" element={<PayslipsPage />} />
            <Route path="holerites/:id" element={<PayslipDetailPage />} />
            <Route path="ferias" element={<LeavesPage />} />
            <Route path="ponto" element={<TimeEntriesPage />} />
            <Route path="onboarding" element={<OnboardingPage />} />
            <Route path="talentos" element={<ReferralsPage />} />
            <Route path="saude" element={<HealthPage />} />
            <Route path="atestados" element={<MedicalCertificatesPage />} />
            <Route path="treinamentos" element={<TrainingsPage />} />
            <Route path="participacao" element={<ParticipationsPage />} />
            <Route path="denuncia" element={<EthicsReportPage />} />
            <Route path="comite" element={<EthicsPage />} />
            <Route path="clima" element={<ClimatePage />} />
            <Route path="ideias" element={<IdeasPage />} />
            <Route path="mural" element={<AnnouncementsPage />} />
            <Route path="mural/:id" element={<AnnouncementDetailPage />} />
            <Route path="gamificacao" element={<GamificationPage />} />
            <Route path="convocacoes" element={<SummonsPage />} />
            <Route path="conta" element={<AccountPage />} />
            <Route path="configuracoes" element={<SettingsPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
