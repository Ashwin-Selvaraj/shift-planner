/**
 * Notifications (BRD section 26).
 *
 * In-app delivery is implemented and persisted. Email, mobile push and
 * Microsoft Teams are defined as channel adapters behind one interface: the
 * dispatch path and the notification records are real, and wiring a provider
 * means implementing `NotificationChannel` and registering it below rather than
 * changing any caller. Nothing here pretends to send mail it cannot send — the
 * unimplemented channels log their intent and are reported as such.
 */
import { prisma } from '../lib/prisma.js';

export type NotificationType =
  | 'LEAVE_REQUEST'
  | 'LEAVE_DECISION'
  | 'SHIFT_CHANGE'
  | 'ROSTER_PUBLISHED'
  | 'MISSING_COVERAGE'
  | 'VALIDATION_FAILURE';

export interface NotificationPayload {
  userIds: string[];
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
}

export interface NotificationChannel {
  readonly name: string;
  readonly enabled: boolean;
  send(payload: NotificationPayload): Promise<void>;
}

const inAppChannel: NotificationChannel = {
  name: 'in-app',
  enabled: true,
  async send(payload) {
    if (payload.userIds.length === 0) return;
    await prisma.notification.createMany({
      data: payload.userIds.map((userId) => ({
        userId,
        type: payload.type,
        title: payload.title,
        body: payload.body,
        link: payload.link ?? null,
      })),
    });
  },
};

/**
 * Placeholder adapters. They are deliberately disabled rather than silently
 * swallowing messages, so the system never reports a delivery that did not
 * happen. See docs/integrations.md for what each one needs.
 */
function pendingChannel(name: string): NotificationChannel {
  return {
    name,
    enabled: false,
    async send(payload) {
      console.info(
        `[notifications] ${name} channel is not configured; ` +
          `"${payload.title}" was delivered in-app only.`,
      );
    },
  };
}

export const channels: NotificationChannel[] = [
  inAppChannel,
  pendingChannel('email'),
  pendingChannel('mobile-push'),
  pendingChannel('microsoft-teams'),
];

export async function notify(payload: NotificationPayload): Promise<void> {
  await Promise.all(
    channels.filter((channel) => channel.enabled).map((channel) => channel.send(payload)),
  );
  for (const channel of channels.filter((c) => !c.enabled)) {
    await channel.send(payload);
  }
}

/** Resolves the user accounts behind a set of employees, skipping those without a login. */
export async function userIdsForEmployees(employeeIds: string[]): Promise<string[]> {
  if (employeeIds.length === 0) return [];
  const employees = await prisma.employee.findMany({
    where: { id: { in: employeeIds }, userId: { not: null } },
    select: { userId: true },
  });
  return employees.map((e) => e.userId).filter((id): id is string => Boolean(id));
}
