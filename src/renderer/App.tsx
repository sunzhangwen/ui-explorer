import { useEffect } from "react";
import { WorkbenchLayout } from "./components/WorkbenchLayout";
import { I18nProvider } from "./i18n/I18nProvider";
import { useAppStore } from "./store/useAppStore";

export function App(): JSX.Element {
  const { theme, initialize } = useAppStore();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  return (
    <I18nProvider>
      <WorkbenchLayout />
    </I18nProvider>
  );
}
