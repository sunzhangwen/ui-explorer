export type CaptureCountdown = {
  remainingSeconds: number;
  ready: boolean;
};

export function getCaptureCountdown(dueAt: number | null, now: number): CaptureCountdown {
  if (dueAt === null) {
    return { remainingSeconds: 0, ready: false };
  }
  const remainingMilliseconds = dueAt - now;
  return {
    remainingSeconds: Math.max(0, Math.ceil(remainingMilliseconds / 1000)),
    ready: remainingMilliseconds <= 0
  };
}
