// Layout shell for /agents/* routes.
// Must render <Outlet /> so child routes (/agents/register, /agents/:agentId) can mount.
// The actual /agents index page lives in agents.index.tsx.

import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/agents")({
  component: () => <Outlet />,
});
