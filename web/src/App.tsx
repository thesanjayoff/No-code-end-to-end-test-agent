import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { TestDetail } from "./pages/TestDetail";
import { FailureDetail } from "./pages/FailureDetail";

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/tests/:id" element={<TestDetail />} />
        <Route path="/runs/:id" element={<FailureDetail />} />
        <Route path="*" element={<p>Not found. <a href="/">Back to dashboard</a></p>} />
      </Routes>
    </Layout>
  );
}
