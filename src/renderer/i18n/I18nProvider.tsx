import { createContext, useContext, useMemo, type PropsWithChildren } from "react";
import { messages, type MessageKey } from "./messages";
import { useAppStore } from "../store/useAppStore";

type I18nContextValue = {
  t: (key: MessageKey | string) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: PropsWithChildren): JSX.Element {
  const locale = useAppStore((state) => state.locale);

  const value = useMemo<I18nContextValue>(
    () => ({
      t: (key) => messages[locale][key as MessageKey] ?? key
    }),
    [locale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return context;
}
