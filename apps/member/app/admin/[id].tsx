import React from "react";
import { useLocalSearchParams } from "expo-router";
import ScreenPage from "../../src/Screen";
import { screens } from "../../src/registry";
export function generateStaticParams() {
  return screens.filter((s) => s.area === "admin").map((s) => ({ id: s.id }));
}
export default function Page() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ScreenPage id={id} />;
}
