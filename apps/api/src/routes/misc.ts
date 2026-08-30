/** Notifications (BRD 26) and the audit trail (BRD 28). */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, notFound } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { channels } from '../services/notifications.js';

export const notificationRouter = Router();
notificationRouter.use(authenticate, requirePermission('notification:read'));

notificationRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({
      notifications,
      unreadCount: notifications.filter((n) => !n.isRead).length,
      channels: channels.map((c) => ({ name: c.name, enabled: c.enabled })),
    });
  }),
);

notificationRouter.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const existing = await prisma.notification.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!existing) throw notFound('Notification not found');
    res.json(
      await prisma.notification.update({ where: { id: existing.id }, data: { isRead: true } }),
    );
  }),
);

notificationRouter.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    const result = await prisma.notification.updateMany({
      where: { userId: req.user!.id, isRead: false },
      data: { isRead: true },
    });
    res.json({ updated: result.count });
  }),
);

export const auditRouter = Router();
auditRouter.use(authenticate, requirePermission('audit:read'));

auditRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        entity: z.string().optional(),
        entityId: z.string().optional(),
        action: z.string().optional(),
        userId: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(req.query);

    const where = {
      ...(query.entity ? { entity: query.entity } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
    };

    const [total, entries] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    res.json({
      entries,
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    });
  }),
);
