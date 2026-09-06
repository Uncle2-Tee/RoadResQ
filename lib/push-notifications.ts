import { prisma } from '@/lib/prisma';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const REQUEST_NOTIFICATION_CHANNEL_ID = 'requests';

type RequestNotificationType = 'service' | 'tow';

type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  priority: 'default' | 'normal' | 'high';
  channelId: string;
  data: {
    screen: string;
    requestId: string;
    type: RequestNotificationType;
  };
};

type ExpoPushTicket = {
  status?: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: {
    error?: string;
  };
};

type ExpoPushResponse = {
  data?: ExpoPushTicket | ExpoPushTicket[];
  errors?: unknown[];
};

export const isExpoPushToken = (token: string) =>
  /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token.trim());

const chunkMessages = <T,>(items: T[], size: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
};

async function pruneDeviceNotRegisteredTokens(
  sentMessages: ExpoPushMessage[],
  tickets: ExpoPushTicket[]
) {
  const staleTokens = tickets
    .map((ticket, index) =>
      ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered'
        ? sentMessages[index]?.to
        : null
    )
    .filter((token): token is string => Boolean(token));

  if (staleTokens.length === 0) {
    return;
  }

  await prisma.pushToken.deleteMany({
    where: {
      token: {
        in: staleTokens,
      },
    },
  });
}

async function sendExpoPushNotifications(messages: ExpoPushMessage[]) {
  for (const chunk of chunkMessages(messages, 100)) {
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(chunk),
    });

    const result = (await response.json().catch(() => ({}))) as ExpoPushResponse;

    if (!response.ok) {
      throw new Error(`Expo push failed with ${response.status}`);
    }

    if (result.errors?.length) {
      console.warn('[push] Expo returned push errors:', result.errors);
    }

    const tickets = Array.isArray(result.data)
      ? result.data
      : result.data
        ? [result.data]
        : [];
    await pruneDeviceNotRegisteredTokens(chunk, tickets);
  }
}

export async function notifyProviderAboutRequest({
  mechanicId,
  requestId,
  type,
  driverName,
  providerName,
}: {
  mechanicId?: string | null;
  requestId: string;
  type: RequestNotificationType;
  driverName: string;
  providerName: string;
}) {
  if (!mechanicId) {
    return;
  }

  const pushTokens = await prisma.pushToken.findMany({
    where: { userId: mechanicId },
    select: { token: true },
  });

  const validTokens = Array.from(
    new Set(pushTokens.map((pushToken) => pushToken.token.trim()).filter(isExpoPushToken))
  );

  if (validTokens.length === 0) {
    return;
  }

  const title = type === 'tow' ? 'New tow request' : 'New mechanic request';
  const body =
    type === 'tow'
      ? `${driverName} needs towing support from ${providerName}.`
      : `${driverName} needs mechanic assistance from ${providerName}.`;
  const screen = type === 'tow' ? 'request' : 'mechanic-inbox';

  await sendExpoPushNotifications(
    validTokens.map((token) => ({
      to: token,
      title,
      body: `${body} Tap to accept or decline.`,
      sound: 'default',
      priority: 'high',
      channelId: REQUEST_NOTIFICATION_CHANNEL_ID,
      data: {
        screen,
        requestId,
        type,
      },
    }))
  );
}
