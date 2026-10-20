import React from "react";
import { Slot } from "expo-router";
import { StoreProvider } from "../src/store";
import { VoiceProvider } from "../src/live/Voice";
import { NativeConnection } from "../src/live/Native";
import "../src/global.css";
import "../src/cabinet.css";
import "../src/jackpot.css";
export default function RootLayout() {
  return (
    <StoreProvider>
      <VoiceProvider>
        <NativeConnection />
        <Slot />
      </VoiceProvider>
    </StoreProvider>
  );
}
