import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import "./index.css";
import { Toaster } from "sonner";

const queryClient = new QueryClient();

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  window.location.href = "/";
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster 
        position="bottom-right"
        richColors 
        closeButton
        gap={8}
        icons={{
          success: <span className="text-xl animate-heartbeat">✨</span>,
          error: <span className="text-xl animate-bounce-slow">😢</span>,
          info: <span className="text-xl animate-sparkle">💖</span>,
          warning: <span className="text-xl">⚠️</span>,
        }}
        toastOptions={{
          duration: 3500,
          classNames: {
            success: 'bg-gradient-to-r from-pink-50 via-fuchsia-50 to-purple-50 border-2 border-pink-200/70 shadow-xl shadow-pink-100/40 text-pink-800 backdrop-blur-sm',
            error: 'bg-gradient-to-r from-red-50 via-rose-50 to-pink-50 border-2 border-red-200/70 shadow-xl shadow-red-100/30 text-red-700 backdrop-blur-sm',
            info: 'bg-gradient-to-r from-purple-50 via-fuchsia-50 to-pink-50 border-2 border-purple-200/70 shadow-xl shadow-purple-100/30 text-purple-700 backdrop-blur-sm',
            warning: 'bg-gradient-to-r from-amber-50 via-orange-50 to-yellow-50 border-2 border-amber-200/70 shadow-xl shadow-amber-100/30 text-amber-700 backdrop-blur-sm',
            toast: 'max-w-md md:max-w-xl rounded-2xl font-medium',
            closeButton: 'bg-white/80 border-pink-200/50 hover:bg-pink-50',
          },
        }}
      />
    </QueryClientProvider>
  </trpc.Provider>
);
