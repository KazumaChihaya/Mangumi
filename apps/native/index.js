import { registerRootComponent } from "expo";
import { registerGlobals } from "@livekit/react-native";
import App from "./App";
import notifee from "@notifee/react-native";
notifee.registerForegroundService(() => new Promise(() => {}));
registerGlobals();
registerRootComponent(App);
