import { Link, Navigate, Route, Routes, useParams } from "react-router-dom";
import { ComparePage } from "./pages/ComparePage";
import { HomePage } from "./pages/HomePage";
import { RunPage } from "./pages/RunPage";
import { StormPage } from "./pages/StormPage";

function Header() {
  const { projectId, runId, sid } = useParams();
  return (
    <header className="app-header">
      <Link to="/" className="brand">
        Tropical cyclone runs
      </Link>
      {projectId && (
        <>
          <span className="crumb">/</span>
          <Link to="/">{projectId}</Link>
        </>
      )}
      {runId && (
        <>
          <span className="crumb">/</span>
          <Link to={`/p/${projectId}/run/${runId}`}>{runId}</Link>
        </>
      )}
      {sid && (
        <>
          <span className="crumb">/</span>
          <span>{sid}</span>
        </>
      )}
    </header>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      {children}
    </>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Shell><HomePage /></Shell>} />
      <Route path="/p/:projectId/run/:runId" element={<Shell><RunPage /></Shell>} />
      <Route path="/p/:projectId/run/:runId/storm/:sid" element={<Shell><StormPage /></Shell>} />
      <Route path="/p/:projectId/compare/:sid" element={<Shell><ComparePage /></Shell>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
