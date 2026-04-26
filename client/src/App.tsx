import { ThemeProvider } from "next-themes";
import { Route, Switch } from "wouter";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/Dashboard";
import Home from "@/pages/Home";
import MetaDebug from "@/pages/MetaDebug";
import NotFound from "@/pages/NotFound";

export default function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <TooltipProvider>
        <Toaster />
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/dashboard/meta-debug" component={MetaDebug} />
          <Route path="/dashboard" component={Dashboard} />
          <Route component={NotFound} />
        </Switch>
      </TooltipProvider>
    </ThemeProvider>
  );
}
