"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 20_000 } } }));
  return <QueryClientProvider client={client}><Toaster richColors position="top-right" />{children}</QueryClientProvider>;
}
