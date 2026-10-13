let context: AudioContext | undefined;
export type Cue = "tap" | "success" | "spin" | "win" | "notify";
export function playCue(cue: Cue, enabled: boolean) {
  if (!enabled || typeof window === "undefined") return;
  try {
    context ??= new AudioContext();
    void context.resume();
    const notes =
      cue === "win"
        ? [523, 659, 784, 1047, 1319]
        : cue === "success"
          ? [523, 784, 1047]
          : cue === "spin"
            ? [180, 240, 320, 480]
            : cue === "notify"
              ? [880, 1175]
              : [700];
    notes.forEach((frequency, index) => {
      const oscillator = context!.createOscillator();
      const gain = context!.createGain();
      const start = context!.currentTime + index * 0.085;
      oscillator.type = cue === "spin" ? "triangle" : "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.055, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.18);
      oscillator.connect(gain);
      gain.connect(context!.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.2);
    });
  } catch {
    /* Audio may be unavailable on this device. UI actions still work. */
  }
}
