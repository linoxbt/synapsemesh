import { Buffer } from "buffer";
if (typeof window !== "undefined") {
  window.Buffer = window.Buffer || Buffer;
}

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
} from "@tanstack/react-router";
import { WagmiProvider } from "wagmi";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";

// CSS is loaded as side-effect imports (Vite handles bundling). This used to
// be wired via `links: [{ rel: "stylesheet", href: ... }]` in the route head,
// rendered by <HeadContent /> inside a TanStack Start `shellComponent`. That
// pattern only works under real SSR — this app mounts via plain
// `ReactDOM.createRoot(document.getElementById("root"))` in src/main.tsx, so
// the shell rendered `<html>` inside `<div id="root">` and broke hydration.
import "../styles.css";
import "@rainbow-me/rainbowkit/styles.css";
import { wagmiConfig } from "@/lib/wagmi";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

// Per-route head metadata (titles, OG tags, etc.) used to be rendered via
// <HeadContent /> inside a `shellComponent`. With the shell removed, those
// route-level meta values are no longer mounted into the document. The base
// title and description live in index.html; route-specific head management
// can be reintroduced later with a client-side head manager if needed.
export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: "oklch(0.78 0.16 65)",       // matches --accent
            accentColorForeground: "oklch(0.16 0.02 250)",
            borderRadius: "large",
            fontStack: "system",
          })}
          showRecentTransactions={false}
        >
          <Outlet />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
