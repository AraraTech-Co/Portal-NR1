import { Navigate, useParams } from "react-router-dom";

/** Links antigos /mural/:id abrem o mural com a linha expandida. */
export function AnnouncementDetailPage() {
  const { id = "" } = useParams();
  if (!id) return <Navigate to="/mural" replace />;
  return <Navigate to={`/mural?open=${encodeURIComponent(id)}`} replace />;
}
