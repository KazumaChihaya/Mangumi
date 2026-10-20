export function wallTimeToISO(date: string, time: string, zone = "Asia/Tokyo") {
  const wanted = `${date}T${time}:00`;
  const utc = Date.parse(wanted + "Z");
  if (!Number.isFinite(utc)) throw new Error("日時を確認してください");
  const format = new Intl.DateTimeFormat("sv-SE", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  let result = utc;
  for (let i = 0; i < 3; i++)
    result += utc - Date.parse(format.format(result).replace(" ", "T") + "Z");
  if (format.format(result).replace(" ", "T") !== wanted)
    throw new Error(
      "このタイムゾーンには存在しない時刻です。夏時間の切替を確認してください",
    );
  return new Date(result).toISOString();
}
export function scheduleStart(schedule: {
  startsAt?: string;
  date: string;
  time: string;
  timezone?: string;
}) {
  return Date.parse(
    schedule.startsAt ??
      wallTimeToISO(schedule.date, schedule.time, schedule.timezone),
  );
}
export function datetimeInput(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function localSchedule<
  T extends {
    startsAt?: string;
    date: string;
    time: string;
    timezone?: string;
  },
>(schedule: T) {
  const date = new Date(scheduleStart(schedule));
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    ...schedule,
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}
