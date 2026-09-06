import * as Haptics from 'expo-haptics';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const notificationSound = require('../assets/sounds/mechanic-request.wav');

let player: AudioPlayer | null = null;
let audioModeReady = false;
let lastPlayedAt = 0;
let ringStopTimeout: ReturnType<typeof setTimeout> | null = null;

const MIN_PLAY_INTERVAL_MS = 1200;
const RING_DURATION_MS = 30000;

export const stopMechanicRequestSound = async () => {
  if (ringStopTimeout) {
    clearTimeout(ringStopTimeout);
    ringStopTimeout = null;
  }

  if (!player) {
    return;
  }

  try {
    player.pause();
    player.loop = false;
    await player.seekTo(0);
  } catch (error) {
    console.warn('Unable to stop mechanic request notification sound:', error);
  }
};

const getPlayer = async () => {
  if (!audioModeReady) {
    await setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'mixWithOthers',
    });
    audioModeReady = true;
  }

  if (!player) {
    player = createAudioPlayer(notificationSound, {
      downloadFirst: true,
      keepAudioSessionActive: false,
      updateInterval: 100,
    });
    player.volume = 1;
  }

  return player;
};

export async function playMechanicRequestSound() {
  const now = Date.now();
  if (now - lastPlayedAt < MIN_PLAY_INTERVAL_MS) {
    return;
  }
  lastPlayedAt = now;

  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

  try {
    const soundPlayer = await getPlayer();
    if (ringStopTimeout) {
      clearTimeout(ringStopTimeout);
      ringStopTimeout = null;
    }

    soundPlayer.loop = true;
    await soundPlayer.seekTo(0);
    soundPlayer.play();

    ringStopTimeout = setTimeout(() => {
      stopMechanicRequestSound().catch(() => {});
    }, RING_DURATION_MS);
  } catch (error) {
    console.warn('Unable to play mechanic request notification sound:', error);
  }
}
