import { createFileRoute } from "@tanstack/react-router";
import { MonitoringPage } from "../pages/monitoring-page";

export const Route = createFileRoute("/monitoring")({
  component: MonitoringRouteComponent
});

function MonitoringRouteComponent() {
  return <MonitoringPage />;
}
