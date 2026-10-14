import React from "react";
import { Slot } from "expo-router";
import { StoreProvider } from "../src/store";
import "../src/global.css";
import "../src/cabinet.css";
import "../src/jackpot.css";
export default function RootLayout() {
  return (
    <StoreProvider>
      <Slot />
    </StoreProvider>
  );
}
