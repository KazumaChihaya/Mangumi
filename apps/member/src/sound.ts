let context: AudioContext | undefined;
export type Cue = "tap" | "success" | "spin" | "win" | "notify";
export function playCue(cue: Cue, enabled: boolean) {
  if (!enabled || typeof window === "undefined") return;
  try {
    context ??= new AudioContext();
    void context.resume();
    const notes =
      cue === "win"
        ? [523, 659, 784, 1047, 784, 1047, 1319, 1568]
        : cue === "success"
          ? [523, 784, 1047]
          : cue === "spin"
            ? [180, 240, 320, 480, 640, 880]
            : cue === "notify"
              ? [880, 1175]
              : [700];
    const beat = cue === "win" ? 0.11 : cue === "spin" ? 0.055 : 0.085;
    const tone = (
      frequency: number,
      start: number,
      length: number,
      volume: number,
      type: OscillatorType,
    ) => {
      const oscillator = context!.createOscillator();
      const gain = context!.createGain();
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(volume, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, start + length);
      oscillator.connect(gain);
      gain.connect(context!.destination);
      oscillator.start(start);
      oscillator.stop(start + length + 0.02);
    };
    notes.forEach((frequency, index) => {
      const start = context!.currentTime + index * beat;
      tone(
        frequency,
        start,
        cue === "win" ? 0.32 : 0.16,
        0.04,
        cue === "tap" ? "sine" : "triangle",
      );
      if (cue === "win" || cue === "success") {
        tone(frequency * 1.5, start, 0.23, 0.014, "square");
        tone(frequency / 2, start, 0.26, 0.035, "sine");
      }
    });
    if (cue === "spin") {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime;
      oscillator.type = "sawtooth";
      oscillator.frequency.setValueAtTime(70, start);
      oscillator.frequency.exponentialRampToValueAtTime(700, start + 0.38);
      gain.gain.setValueAtTime(0.012, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.42);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.43);
    }
  } catch {
    /* Audio may be unavailable on this device. UI actions still work. */
  }
}
